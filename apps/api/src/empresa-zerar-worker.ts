/**
 * ADR 0068 (desenho docs/desenho/empresa-zerar.md §3 e §5; RN-PLA-12): o lado do WORKER do "Zerar dados", no processo do
 * despachante (`worker.ts`), com o papel `macuxi_worker` e um pool PRÓPRIO de 1 conexão (o `poolWorker` tem `statement_timeout`
 * de 30 s; aqui a transação do zerar ganha 15 min por `set local`).
 *
 * Zerar (a cada 10 s): `pegar_zerar()` reserva um pedido `em_andamento` (skip locked, concessão de 10 min) e, numa transação,
 * `executar_zerar(id)` confere de novo (exclusão, outro zerar, backup e lote do Hub: fecha `falhou` com o código e devolve o
 * zerar, sem erro e sem mudar nada) e roda a `plataforma.limpar_cadastros(tenant, lote, entidades)` (a mesma do workflow
 * `producao-limpar-cadastros.yml`: soft delete no domínio, físico no Hub, cópia em `plataforma.limpeza_copia`) e fecha
 * `concluido` com a contagem e as `entidades_afetadas`. Escrita concorrente (23503, 40001, 40P01, 55P03) = ROLLBACK e nova tentativa (2 s, 5 s); na `TENTATIVAS_ZERAR`ª,
 * `fechar_zerar(id, 'ZERAR_CONCORRENCIA')`. Recusa com código do contrato no `hint` (lote do Hub em processamento, volume alto)
 * no meio da limpeza (55000 `ZERAR_HUB_PROCESSANDO`, 22023 `ZERAR_VOLUME_ALTO`) = `fechar_zerar(id, <código>)` sem nova
 * tentativa. Outro erro (23505 lote repetido, por exemplo) = `fechar_zerar(id, 'ZERAR_FALHOU')`. Falha = nada mudou.
 *
 * Descarte (de hora em hora): `expurgar_zerar(limite)` apaga a cópia dos zerar do portal vencidos (7 dias) e marca
 * `expurgado_em`. Não há bytes a remover: o zerar é soft delete (as fotos e os pacotes ficam no armazenamento, como em
 * qualquer linha apagada).
 *
 * Contrato assumido das funções da 0100 (banco-dados): `pegar_zerar()` → (id, empresa_id) ou nenhuma linha/linha nula;
 * `executar_zerar(uuid)` → jsonb `ZerarEmpresa`; `fechar_zerar(uuid, text)` com o `erro_codigo`; `expurgar_zerar(integer)` →
 * quantos zerar tiveram a cópia descartada.
 *
 * Log: `tipo: zerar`, `zerar_id`, `tenant_alvo_id`, `erro_codigo`, SQLSTATE, tentativas e contagens. Nunca código digitado,
 * senha, nome nem documento.
 */
import { CODIGOS_ZERAR_EMPRESA, ERROS_WORKER_ZERAR, TENTATIVAS_ZERAR, ZerarEmpresaSchema, type LogRota } from '@macuxi/platform-sdk';
import pg from 'pg';
import { iniciarLaco } from './laco';
import { mensagemSegura } from './log-seguro';

export const SQL_EXISTE_0100 =
  "select to_regprocedure('plataforma.pegar_zerar()') is not null and to_regprocedure('plataforma.executar_zerar(uuid)') is not null and to_regprocedure('plataforma.expurgar_zerar(integer)') is not null as ok";
export const SQL_PEGAR_ZERAR = 'select id, empresa_id from plataforma.pegar_zerar()';
export const SQL_EXECUTAR_ZERAR = 'select plataforma.executar_zerar($1) as r';
export const SQL_FECHAR_ZERAR = 'select plataforma.fechar_zerar($1, $2)';
export const SQL_EXPURGAR_ZERAR = 'select plataforma.expurgar_zerar($1) as n';

/** Esperas antes da 2ª e da 3ª tentativa (desenho §3). */
export const ESPERAS_ZERAR_MS = [2_000, 5_000] as const;
/** SQLSTATE de escrita concorrente: FK, serialização, deadlock e `lock_timeout`. */
export const SQLSTATE_CONCORRENCIA = new Set(['23503', '40001', '40P01', '55P03']);
/** Recusas da `executar_zerar` (código no `hint`) que fecham o pedido com o próprio código, sem nova tentativa. */
export const RECUSAS_EXECUTAR_ZERAR: ReadonlySet<string> = new Set([CODIGOS_ZERAR_EMPRESA.hubProcessando, CODIGOS_ZERAR_EMPRESA.volumeAlto]);
export const INTERVALO_ZERAR_MS = 10_000;
export const INTERVALO_EXPURGO_ZERAR_MS = 60 * 60_000;
/** Zerar vencidos por chamada da `expurgar_zerar`. */
export const LOTE_EXPURGO_ZERAR = 20;

export interface OpcoesWorkerZerar {
  /** Pool próprio (`macuxi_worker`, 1 conexão). */
  pool: Pick<pg.Pool, 'connect' | 'query'>;
  log?: LogRota;
  /** Testes trocam a espera entre tentativas. */
  esperar?: (ms: number) => Promise<void>;
}

const semLog: LogRota = { info: () => undefined, warn: () => undefined, error: () => undefined };
const campo = (e: unknown, nome: 'code' | 'hint'): string => {
  const c = (e as Record<string, unknown> | null)?.[nome];
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

  /** Um pedido reservado: executa com as tentativas e fecha. `null` = não havia pedido; `falhou` também quando a `executar_zerar` recusou. */
  async function ciclo(): Promise<'concluido' | 'falhou' | null> {
    const job = (await op.pool.query<{ id: string | null; empresa_id: string | null }>(SQL_PEGAR_ZERAR)).rows[0];
    if (!job?.id) return null;
    const base = { tipo: 'zerar', zerar_id: job.id, tenant_alvo_id: job.empresa_id };
    for (let tentativa = 1; ; tentativa++) {
      try {
        const r = ZerarEmpresaSchema.safeParse(await tentar(job.id));
        const z = r.success ? r.data : null;
        if (z?.situacao === 'falhou') {
          // a executar_zerar conferiu de novo e recusou (exclusão, outro zerar, backup ou Hub): fechou com o código, nada mudou
          log.warn({ ...base, tentativa, situacao: z.situacao, erro_codigo: z.erro_codigo }, 'zerar dados recusado; nada foi apagado');
          return 'falhou';
        }
        log.info(
          {
            ...base,
            tentativa,
            situacao: z?.situacao ?? null,
            entidades: z?.entidades ?? null,
            entidades_afetadas: z?.entidades_afetadas ?? null,
            linhas_apagadas: z?.linhas_apagadas ?? null,
            tabelas: z?.contagem?.length ?? null,
          },
          'zerar dados concluído',
        );
        return 'concluido';
      } catch (e) {
        const estado = campo(e, 'code');
        const hint = campo(e, 'hint');
        const concorrencia = SQLSTATE_CONCORRENCIA.has(estado);
        if (concorrencia && tentativa < TENTATIVAS_ZERAR) {
          log.warn({ ...base, tentativa, sqlstate: estado }, 'zerar dados: escrita concorrente, nova tentativa');
          await esperar(ESPERAS_ZERAR_MS[Math.min(tentativa, ESPERAS_ZERAR_MS.length) - 1] ?? 5_000);
          continue;
        }
        const erroCodigo = RECUSAS_EXECUTAR_ZERAR.has(hint)
          ? hint
          : concorrencia
            ? ERROS_WORKER_ZERAR.concorrencia
            : ERROS_WORKER_ZERAR.falhou;
        try {
          await op.pool.query(SQL_FECHAR_ZERAR, [job.id, erroCodigo]);
        } catch (f) {
          // a concessão de 10 min vence e outro ciclo pega o pedido de novo
          log.error({ ...base, erro: mensagemSegura(f) }, 'zerar dados: não foi possível fechar como falhou');
        }
        log.error(
          { ...base, tentativa, sqlstate: estado || null, erro_codigo: erroCodigo, ...(estado ? {} : { erro: mensagemSegura(e) }) },
          'zerar dados falhou; nada foi apagado',
        );
        return 'falhou';
      }
    }
  }

  /** Descarte das cópias vencidas (7 dias); devolve quantos zerar tiveram a cópia descartada. */
  async function expurgar(): Promise<number> {
    const n = Number((await op.pool.query<{ n: number | null }>(SQL_EXPURGAR_ZERAR, [LOTE_EXPURGO_ZERAR])).rows[0]?.n ?? 0);
    if (n > 0) log.info({ tipo: 'zerar', etapa: 'expurgo', expurgados: n }, 'cópias do zerar descartadas');
    return n;
  }

  return {
    ciclo,
    expurgar,
    /** Laços do processo: zerar a cada `intervaloMs` (padrão 10 s) e descarte a cada hora. Erro é logado e o laço segue. */
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
        ciclo: async () => {
          while ((await expurgar()) >= LOTE_EXPURGO_ZERAR) {
            /* esvazia os vencidos antes de esperar */
          }
        },
        intervaloMs: o.intervaloExpurgoMs ?? INTERVALO_EXPURGO_ZERAR_MS,
        aoFalhar: (e) => log.error({ tipo: 'zerar', etapa: 'expurgo', erro: mensagemSegura(e) }, 'descarte das cópias do zerar falhou'),
      });
      return {
        async parar() {
          await Promise.all([zerar.parar(), expurgo.parar()]);
        },
      };
    },
  };
}

/** Entrada do `worker.ts`: pool próprio de 1 conexão do `macuxi_worker`. Desligado (sem erro) enquanto a 0100 não estiver no banco. */
export async function iniciarZerarEmpresa(
  urlWorker: string,
  log: LogRota,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ parar(): Promise<void> } | undefined> {
  const pool = new pg.Pool({ connectionString: urlWorker, max: 1, options: '-c statement_timeout=30000' });
  const existe = await pool.query<{ ok: boolean }>(SQL_EXISTE_0100).catch(() => null);
  if (!existe?.rows[0]?.ok) {
    await pool.end();
    log.info({ tipo: 'zerar' }, 'zerar dados desligado: falta a migração 0100 no banco');
    return undefined;
  }
  const w = criarWorkerZerar({ pool, log });
  const execucao = w.iniciar({ intervaloMs: Number(env.MACUXI_ZERAR_INTERVALO_MS ?? INTERVALO_ZERAR_MS) });
  log.info({ tipo: 'zerar' }, 'zerar dados no ar');
  return {
    async parar() {
      await execucao.parar();
      await pool.end();
    },
  };
}
