/** Montagem do ambiente de teste: Hub falso + ERP em memória + fila em arquivo temporário + relógio controlável. */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Armazenamento } from '../../src/armazenamento/armazenamento';
import { ConfigConector } from '../../src/config/esquema';
import type { Contexto } from '../../src/contexto';
import type { ConexaoErp, ExecutorSql, Linha, Parametros } from '../../src/erp/driver';
import { ClienteHub } from '../../src/hub/cliente';
import { criarLogger, type Logger } from '../../src/log/logger';
import { HubFalso } from './hub-falso';

export class RelogioFalso {
  constructor(public t = Date.parse('2026-03-10T12:00:00Z')) {}
  agora = () => this.t;
  avancar(ms: number) {
    this.t += ms;
  }
}

/** ERP em memória: aplica o filtro de cursor (alterado_em, external_id) e o limite, como as consultas reais fazem. */
export class ErpEmMemoria implements ConexaoErp {
  readonly tipo = 'postgres' as const;
  linhas: Record<string, Linha[]> = {};
  /** Consultas especiais (pedidos): recebe o SQL e os parâmetros. */
  onConsulta?: (sql: string, p: Parametros) => Linha[] | undefined;
  onExecucao?: (sql: string, p: Parametros) => void;
  erroNaProximaConsulta: Error | null = null;
  /** Simula precisão de alterado_em maior que a do filtro: devolve também as linhas com o mesmo instante do cursor. */
  devolverIgualAoCursor = false;
  consultas: { sql: string; params: Parametros }[] = [];

  definir(tag: string, linhas: Linha[]): void {
    this.linhas[tag] = linhas;
  }
  /** A consulta de teste traz um comentário com o nome da fonte (ex.: cliente) para o ERP em memória saber de onde ler. */
  async consultar(sql: string, params: Parametros = {}): Promise<Linha[]> {
    this.consultas.push({ sql, params });
    if (this.erroNaProximaConsulta) {
      const e = this.erroNaProximaConsulta;
      this.erroNaProximaConsulta = null;
      throw e;
    }
    if (params.limite !== undefined) {
      const tag = /\/\*(\w+)\*\//.exec(sql)?.[1] ?? '';
      const ms = Number(params.cursor_alterado_em_ms);
      const id = String(params.cursor_external_id);
      const todos = (this.linhas[tag] ?? [])
        .filter((l) => {
          const t = new Date(l.alterado_em as string | Date).getTime();
          return this.devolverIgualAoCursor ? t >= ms : t > ms || (t === ms && String(l.external_id) > id);
        })
        .sort((a, b) => {
          const d = new Date(a.alterado_em as string).getTime() - new Date(b.alterado_em as string).getTime();
          return d !== 0 ? d : String(a.external_id) < String(b.external_id) ? -1 : 1;
        });
      return todos.slice(0, Number(params.limite));
    }
    return this.onConsulta?.(sql, params) ?? [];
  }
  async executar(sql: string, params: Parametros = {}): Promise<{ linhasAfetadas: number }> {
    this.onExecucao?.(sql, params);
    return { linhasAfetadas: 1 };
  }
  async testar() {
    return { versao: 'em-memoria' };
  }
  async transacao<T>(fn: (tx: ExecutorSql) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async fechar() {}
}

export const CAMPOS_CLIENTE = { external_id: 'external_id', alterado_em: 'alterado_em', razao_social: 'razao_social', bloqueado: 'bloqueado' };
export const CAMPOS_PRODUTO = { external_id: 'external_id', alterado_em: 'alterado_em', sku: 'sku', nome: 'nome', unidade: 'unidade' };

const SQL_PADRAO = (tag: string) =>
  `/*${tag}*/ SELECT * FROM t WHERE alterado_em > :cursor_alterado_em OR (alterado_em = :cursor_alterado_em AND external_id > :cursor_external_id) ORDER BY alterado_em, external_id LIMIT :limite`;

export function configDeTeste(hubUrl: string, dadosDir: string, extra: Record<string, unknown> = {}): ConfigConector {
  return ConfigConector.parse({
    dadosDir,
    hub: { url: hubUrl, retry: { tentativas: 3, baseMs: 1, maxMs: 2 } },
    erp: { tipo: 'postgres', host: 'localhost', banco: 'erp', usuario: 'leitura', criptografar: false },
    lote: { maxLinhas: 3 },
    fila: { backoffBaseSegundos: 1, backoffMaxSegundos: 10, consultaResultadoSegundos: 1 },
    margemDeltaSegundos: 0,
    entidades: {
      cliente: { consulta: SQL_PADRAO('cliente'), campos: CAMPOS_CLIENTE },
      produto: { consulta: SQL_PADRAO('produto'), campos: CAMPOS_PRODUTO },
    },
    ...extra,
  });
}

export interface Ambiente {
  hub: HubFalso;
  erp: ErpEmMemoria;
  relogio: RelogioFalso;
  dir: string;
  caminhoFila: string;
  ctx: Contexto;
  logs: string[];
  /** Fecha a fila e reabre o arquivo: simula reinício do serviço. */
  reiniciar(): void;
  encerrar(): Promise<void>;
}

export async function criarAmbiente(extraConfig: Record<string, unknown> = {}, hubExistente?: HubFalso): Promise<Ambiente> {
  const hub = hubExistente ?? (await HubFalso.iniciar());
  const dir = mkdtempSync(join(tmpdir(), 'conector-teste-'));
  mkdirSync(dir, { recursive: true });
  const caminhoFila = join(dir, 'fila.sqlite');
  const logs: string[] = [];
  const log: Logger = criarLogger({ nivel: 'debug', escrever: (l) => logs.push(l) });
  const relogio = new RelogioFalso();
  const erp = new ErpEmMemoria();
  let n = 0;
  const config = configDeTeste(hub.url, dir, extraConfig);
  const montar = (): Contexto => ({
    config,
    erp,
    hub: new ClienteHub({ url: hub.url, token: async () => hub.token, retry: { tentativas: 3, baseMs: 1, maxMs: 2, dormir: async () => undefined, aleatorio: () => 0.5 } }),
    store: Armazenamento.abrir(caminhoFila),
    log,
    relogio,
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    aleatorio: () => 0.5,
  });
  const amb: Ambiente = {
    hub, erp, relogio, dir, caminhoFila, logs, ctx: montar(),
    reiniciar() {
      amb.ctx.store.fechar();
      amb.ctx = montar();
    },
    async encerrar() {
      amb.ctx.store.fechar();
      if (!hubExistente) await hub.parar();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return amb;
}

export const ts = (iso: string) => new Date(iso);
export const cliente = (id: string, iso: string, razao = `Cliente ${id}`): Linha => ({ external_id: id, alterado_em: new Date(iso), razao_social: razao, bloqueado: false });
