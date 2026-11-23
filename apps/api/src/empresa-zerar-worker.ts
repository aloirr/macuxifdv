/**
 * ADR 0068 (desenho docs/desenho/empresa-zerar.md §3 e §6; RN-PLA-12): o lado do WORKER do "Zerar dados", no processo do
 * despachante (`worker.ts`), com o papel `macuxi_worker` e um pool PRÓPRIO de 1 conexão (o `poolWorker` tem `statement_timeout`
 * de 30 s; aqui a transação do zerar ganha 15 min por `set local`).
 *
 * Zerar (a cada 10 s): `pegar_zerar()` reserva um pedido `em_andamento` (skip locked, concessão de 10 min) e, numa transação,
 * `executar_zerar(id)` confere de novo, apaga com cópia (`zerar_tenant`), semeia o pagamento, gira a geração e fecha `concluido`.
 * Escrita concorrente (23503, 40001, 40P01, 55P03) = ROLLBACK e nova tentativa (2 s, 5 s); na `TENTATIVAS_ZERAR`ª,
 * `fechar_zerar(id, 'ZERAR_CONCORRENCIA')`. Outro erro = `fechar_zerar(id, 'ZERAR_FALHOU')`. Falha = nada mudou (uma transação).
 *
 * Expurgo (de hora em hora): `objetos_do_expurgo_zerar(limite)` lista os objetos dos zerar com a cópia vencida (7 dias); o worker
 * remove os bytes (original, miniatura e partes `.pNNN.zip` das fotos; pacotes de sync) e, com TODOS removidos, chama
 * `fechar_expurgo_zerar(id)`, que apaga a cópia e os objetos e marca `expurgado_em`. Sem o armazenamento daquele tipo, o zerar
 * fica para o ciclo seguinte (a cópia não some antes dos bytes).
 *
 * Contrato assumido das funções da 0099 (banco-dados): `pegar_zerar()` → (id, empresa_id) ou nenhuma linha/linha nula;
 * `executar_zerar(uuid)` → jsonb `ZerarEmpresa`; `fechar_zerar(uuid, text)` com o `erro_codigo`; `objetos_do_expurgo_zerar(integer)`
 * → (zerar_id, armazenamento, chave) de até `limite` zerar vencidos, todos os objetos de cada um e uma linha com `chave` nula
 * para o zerar sem objeto; `fechar_expurgo_zerar(uuid)`.
 *
 * Log: `tipo: zerar`, `zerar_id`, `tenant_alvo_id`, `erro_codigo`, SQLSTATE, tentativas e contagens. Nunca código digitado,
 * senha, nome, documento nem chave de arquivo.
 */
import { ERROS_WORKER_ZERAR, PARTES_ENVIO_MAX, TENTATIVAS_ZERAR, ZerarEmpresaSchema, type LogRota } from '@macuxi/platform-sdk';
import pg from 'pg';
import { chaveDaParte, type ArmazenamentoArquivos } from './arquivos';
import { lerArmazenamentoDoAmbiente } from './armazenamento-s3';
import { iniciarLaco } from './laco';
import { mensagemSegura } from './log-seguro';
import { chaveDaMiniatura } from './miniatura';
import { armazenamentoPacotesSyncDoAmbiente, type ArmazenamentoPacotesSync } from './sync-pacotes';

export const SQL_EXISTE_0099 =
  "select to_regprocedure('plataforma.pegar_zerar()') is not null and to_regprocedure('plataforma.executar_zerar(uuid)') is not null and to_regprocedure('plataforma.objetos_do_expurgo_zerar(integer)') is not null as ok";
export const SQL_PEGAR_ZERAR = 'select id, empresa_id from plataforma.pegar_zerar()';
export const SQL_EXECUTAR_ZERAR = 'select plataforma.executar_zerar($1) as r';
export const SQL_FECHAR_ZERAR = 'select plataforma.fechar_zerar($1, $2)';
export const SQL_OBJETOS_EXPURGO_ZERAR = 'select zerar_id, armazenamento, chave from plataforma.objetos_do_expurgo_zerar($1)';
export const SQL_FECHAR_EXPURGO_ZERAR = 'select plataforma.fechar_expurgo_zerar($1)';

/** Esperas antes da 2ª e da 3ª tentativa (desenho §3). */
export const ESPERAS_ZERAR_MS = [2_000, 5_000] as const;
/** SQLSTATE de escrita concorrente: FK, serialização, deadlock e `lock_timeout`. */
export const SQLSTATE_CONCORRENCIA = new Set(['23503', '40001', '40P01', '55P03']);
export const INTERVALO_ZERAR_MS = 10_000;
export const INTERVALO_EXPURGO_ZERAR_MS = 60 * 60_000;
/** Zerar vencidos por chamada da `objetos_do_expurgo_zerar`. */
export const LOTE_EXPURGO_ZERAR = 20;

export interface OpcoesWorkerZerar {
  /** Pool próprio (`macuxi_worker`, 1 conexão). */
  pool: Pick<pg.Pool, 'connect' | 'query'>;
  /** Bytes das fotos e anexos; `null` = sem armazenamento (o expurgo dos zerar com fotos espera). */
  arquivos: ArmazenamentoArquivos | null;
  /** Bytes dos pacotes de sync; `null` = sem armazenamento. */
  pacotes: Pick<ArmazenamentoPacotesSync, 'remover'> | null;
  log?: LogRota;
  /** Testes trocam a espera entre tentativas. */
  esperar?: (ms: number) => Promise<void>;
}

const semLog: LogRota = { info: () => undefined, warn: () => undefined, error: () => undefined };
const sqlstate = (e: unknown): string => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : '';
};

export function criarWorkerZerar(op: OpcoesWorkerZerar) {
  const log = op.log ?? semLog;
  const esperar = op.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  /** Uma tentativa numa transação com prazo de 15 min; devolve o jsonb do `executar_zerar`. */
  async function tentar(id: string): Promise<unknown> {
    const c = await op.pool.connect();
    try {
      await c.query('begin');
      await c.query("set local statement_timeout = '15min'");
      await c.query("set local lock_timeout = '5s'");
      const r = (await c.query<{ r: unknown }>(SQL_EXECUTAR_ZERAR, [id])).rows[0]?.r ?? null;
      await c.query('commit');
      return r;
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  /** Um pedido reservado: executa com as tentativas e fecha. `null` = não havia pedido. */
  async function ciclo(): Promise<'concluido' | 'falhou' | null> {
    const job = (await op.pool.query<{ id: string | null; empresa_id: string | null }>(SQL_PEGAR_ZERAR)).rows[0];
    if (!job?.id) return null;
    const base = { tipo: 'zerar', zerar_id: job.id, tenant_alvo_id: job.empresa_id };
    for (let tentativa = 1; ; tentativa++) {
      try {
        const r = ZerarEmpresaSchema.safeParse(await tentar(job.id));
        const z = r.success ? r.data : null;
        log.info(
          { ...base, tentativa, situacao: z?.situacao ?? null, linhas_apagadas: z?.linhas_apagadas ?? null, tabelas: z?.contagem ? Object.keys(z.contagem).length : null },
          'zerar dados concluído',
        );
        return 'concluido';
      } catch (e) {
        const estado = sqlstate(e);
        const concorrencia = SQLSTATE_CONCORRENCIA.has(estado);
        if (concorrencia && tentativa < TENTATIVAS_ZERAR) {
          log.warn({ ...base, tentativa, sqlstate: estado }, 'zerar dados: escrita concorrente, nova tentativa');
          await esperar(ESPERAS_ZERAR_MS[Math.min(tentativa, ESPERAS_ZERAR_MS.length) - 1] ?? 5_000);
          continue;
        }
        const erroCodigo = concorrencia ? ERROS_WORKER_ZERAR.concorrencia : ERROS_WORKER_ZERAR.falhou;
        try {
          await op.pool.query(SQL_FECHAR_ZERAR, [job.id, erroCodigo]);
        } catch (f) {
          // a concessão de 10 min vence e outro ciclo pega o pedido de novo
          log.error({ ...base, erro: mensagemSegura(f) }, 'zerar dados: não foi possível fechar como falhou');
        }
        log.error({ ...base, tentativa, sqlstate: estado || null, erro_codigo: erroCodigo, ...(estado ? {} : { erro: mensagemSegura(e) }) }, 'zerar dados falhou; nada foi apagado');
        return 'falhou';
      }
    }
  }

  /** Bytes de um objeto da cópia; idempotente (remover o que não existe = ok). */
  async function removerObjeto(armazenamento: string, chave: string): Promise<void> {
    if (armazenamento === 'sync_pacotes') {
      if (!op.pacotes) throw new Error('sem armazenamento dos pacotes de sync');
      await op.pacotes.remover(chave);
      return;
    }
    if (armazenamento !== 'arquivos') throw new Error('armazenamento desconhecido');
    const a = op.arquivos;
    if (!a) throw new Error('sem armazenamento de arquivos');
    await a.remover(chave);
    if (/\.p001\.zip$/.test(chave)) {
      for (let n = 2; n <= PARTES_ENVIO_MAX; n++) {
        const parte = chaveDaParte(chave, n);
        if ((await a.tamanho(parte)) === null) break;
        await a.remover(parte);
      }
    } else if (/\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(chave)) {
      await a.remover(chaveDaMiniatura(chave));
    }
  }

  /** Expurgo das cópias vencidas: remove os bytes e, com todos removidos, fecha o zerar (apaga a cópia). */
  async function expurgar(): Promise<{ expurgados: number; objetos: number; pendentes: number }> {
    const total = { expurgados: 0, objetos: 0, pendentes: 0 };
    const linhas = (await op.pool.query<{ zerar_id: string; armazenamento: string | null; chave: string | null }>(SQL_OBJETOS_EXPURGO_ZERAR, [LOTE_EXPURGO_ZERAR])).rows;
    const porZerar = new Map<string, { armazenamento: string; chave: string }[]>();
    for (const l of linhas) {
      const lista = porZerar.get(l.zerar_id) ?? [];
      if (l.chave && l.armazenamento) lista.push({ armazenamento: l.armazenamento, chave: l.chave });
      porZerar.set(l.zerar_id, lista);
    }
    for (const [id, objetos] of porZerar) {
      let falhas = 0;
      let ultimoErro = '';
      for (const o of objetos) {
        try {
          await removerObjeto(o.armazenamento, o.chave);
          total.objetos += 1;
        } catch (e) {
          falhas += 1;
          ultimoErro = mensagemSegura(e);
        }
      }
      if (falhas) {
        total.pendentes += 1;
        log.warn({ tipo: 'zerar', etapa: 'expurgo', zerar_id: id, falhas, erro: ultimoErro }, 'expurgo do zerar: bytes não removidos; tenta na próxima hora');
        continue;
      }
      await op.pool.query(SQL_FECHAR_EXPURGO_ZERAR, [id]);
      total.expurgados += 1;
      log.info({ tipo: 'zerar', etapa: 'expurgo', zerar_id: id, objetos: objetos.length }, 'cópia do zerar expurgada');
    }
    return total;
  }

  return {
    ciclo,
    expurgar,
    /** Laços do processo: zerar a cada `intervaloMs` (padrão 10 s) e expurgo a cada hora. Erro é logado e o laço segue. */
    iniciar(o: { intervaloMs?: number; intervaloExpurgoMs?: number } = {}): { parar(): Promise<void> } {
      const zerar = iniciarLaco({
        ciclo: async () => {
          while ((await ciclo()) !== null) {
            /* esvazia a fila antes de esperar */
          }
        },
        intervaloMs: o.intervaloMs ?? INTERVALO_ZERAR_MS,
        aoFalhar: (e) => log.error({ tipo: 'zerar', erro: mensagemSegura(e) }, 'ciclo do zerar falhou'),
      });
      const expurgo = iniciarLaco({
        ciclo: async () => void (await expurgar()),
        intervaloMs: o.intervaloExpurgoMs ?? INTERVALO_EXPURGO_ZERAR_MS,
        aoFalhar: (e) => log.error({ tipo: 'zerar', etapa: 'expurgo', erro: mensagemSegura(e) }, 'expurgo do zerar falhou'),
      });
      return {
        async parar() {
          await Promise.all([zerar.parar(), expurgo.parar()]);
        },
      };
    },
  };
}

/**
 * Entrada do `worker.ts`: pool próprio de 1 conexão do `macuxi_worker` e os armazenamentos do ambiente. Desligado (sem erro)
 * enquanto a 0099 não estiver no banco. Armazenamento inválido não derruba o worker: o expurgo daquele tipo espera.
 */
export async function iniciarZerarEmpresa(urlWorker: string, log: LogRota, env: NodeJS.ProcessEnv = process.env): Promise<{ parar(): Promise<void> } | undefined> {
  const pool = new pg.Pool({ connectionString: urlWorker, max: 1, options: '-c statement_timeout=30000' });
  const existe = await pool.query<{ ok: boolean }>(SQL_EXISTE_0099).catch(() => null);
  if (!existe?.rows[0]?.ok) {
    await pool.end();
    log.info({ tipo: 'zerar' }, 'zerar dados desligado: falta a migração 0099 no banco');
    return undefined;
  }
  let arquivos: ArmazenamentoArquivos | null = null;
  let pacotes: ArmazenamentoPacotesSync | null = null;
  try {
    arquivos = lerArmazenamentoDoAmbiente(env).armazenamento;
    pacotes = armazenamentoPacotesSyncDoAmbiente(env).armazenamento;
  } catch (e) {
    log.warn({ tipo: 'zerar', erro: mensagemSegura(e) }, 'zerar dados sem armazenamento: o expurgo não remove os bytes (a cópia fica)');
  }
  const w = criarWorkerZerar({ pool, arquivos, pacotes, log });
  const execucao = w.iniciar({ intervaloMs: Number(env.MACUXI_ZERAR_INTERVALO_MS ?? INTERVALO_ZERAR_MS) });
  log.info({ tipo: 'zerar' }, 'zerar dados no ar');
  return {
    async parar() {
      await execucao.parar();
      await pool.end();
    },
  };
}
