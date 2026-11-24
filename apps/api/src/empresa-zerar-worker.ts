/**
 * ADR 0068 (desenho docs/desenho/empresa-zerar.md §3 e §5; RN-PLA-12): o lado do WORKER do "Zerar dados", no processo do
 * despachante (`worker.ts`), com o papel `macuxi_worker` e um pool PRÓPRIO de 2 conexões, uma para o zerar e uma para a prévia
 * (o `poolWorker` tem `statement_timeout` de 30 s; aqui cada transação ganha 15 min e `lock_timeout` de 5 s por `set local`).
 *
 * Prévia (a cada 2 s, o mesmo ritmo da tela): `pegar_previa_zerar()` reserva uma prévia `em_andamento` (concessão de 2 min) e,
 * numa transação, `executar_previa_zerar(id)` conta a `limpar_cadastros` no modo simular numa subtransação desfeita (sem a
 * trava do Hub), grava a contagem e fecha `pronta`; o bloqueio é calculado na leitura. Erro na contagem: o banco fecha `falhou`
 * `ZERAR_FALHOU` (empresa que saiu: `TENANT_NAO_ENCONTRADO`). Erro na chamada = ROLLBACK e log; a prévia volta quando a
 * concessão vence, e o banco fecha `falhou` `ZERAR_FALHOU` no teto de 3 tentativas.
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
 * Contrato assumido das funções da 0100 (banco-dados): `pegar_zerar()` e `pegar_previa_zerar()` → (id, empresa_id) ou nenhuma
 * linha/linha nula; `executar_zerar(uuid)` → jsonb `ZerarEmpresa`; `executar_previa_zerar(uuid)` → jsonb `PreviaZerar`;
 * `fechar_zerar(uuid, text)` com o `erro_codigo`; `expurgar_zerar(integer)` → quantos zerar tiveram a cópia descartada.
 *
 * Subida: a conferência da 0100 roda no primeiro ciclo de cada laço. Banco fora (erro na conferência) = o laço registra e tenta
 * de novo no ciclo seguinte; só a função ausente desliga o zerar (até a próxima subida do processo).
 *
 * Log: `tipo: zerar`, `zerar_id`, `tenant_alvo_id`, `erro_codigo`, SQLSTATE, tentativas e contagens. Nunca código digitado,
 * senha, nome nem documento.
 */
import {
  CODIGOS_ZERAR_EMPRESA,
  CONSULTA_PREVIA_ZERAR_MS,
  ERROS_WORKER_ZERAR,
  PreviaZerarSchema,
  TENTATIVAS_ZERAR,
  ZerarEmpresaSchema,
  type LogRota,
} from '@macuxi/platform-sdk';
import pg from 'pg';
import { iniciarLaco } from './laco';
import { mensagemSegura } from './log-seguro';

export const SQL_EXISTE_0100 =
  "select to_regprocedure('plataforma.pegar_zerar()') is not null and to_regprocedure('plataforma.executar_zerar(uuid)') is not null and to_regprocedure('plataforma.expurgar_zerar(integer)') is not null and to_regprocedure('plataforma.pegar_previa_zerar()') is not null and to_regprocedure('plataforma.executar_previa_zerar(uuid)') is not null as ok";
export const SQL_PEGAR_ZERAR = 'select id, empresa_id from plataforma.pegar_zerar()';
export const SQL_EXECUTAR_ZERAR = 'select plataforma.executar_zerar($1) as r';
export const SQL_FECHAR_ZERAR = 'select plataforma.fechar_zerar($1, $2)';
export const SQL_EXPURGAR_ZERAR = 'select plataforma.expurgar_zerar($1) as n';
export const SQL_PEGAR_PREVIA_ZERAR = 'select id, empresa_id from plataforma.pegar_previa_zerar()';
export const SQL_EXECUTAR_PREVIA_ZERAR = 'select plataforma.executar_previa_zerar($1) as r';

/** Esperas antes da 2ª e da 3ª tentativa (desenho §3). */
export const ESPERAS_ZERAR_MS = [2_000, 5_000] as const;
/** SQLSTATE de escrita concorrente: FK, serialização, deadlock e `lock_timeout`. */
export const SQLSTATE_CONCORRENCIA = new Set(['23503', '40001', '40P01', '55P03']);
/** Recusas da `executar_zerar` (código no `hint`) que fecham o pedido com o próprio código, sem nova tentativa. */
export const RECUSAS_EXECUTAR_ZERAR: ReadonlySet<string> = new Set([CODIGOS_ZERAR_EMPRESA.hubProcessando, CODIGOS_ZERAR_EMPRESA.volumeAlto]);
export const INTERVALO_ZERAR_MS = 10_000;
/** O mesmo ritmo da tela. */
export const INTERVALO_PREVIA_ZERAR_MS = CONSULTA_PREVIA_ZERAR_MS;
/** Prévias por ciclo, no máximo (uma que falha só volta depois da concessão; o teto evita girar no mesmo pedido). */
export const LOTE_PREVIA_ZERAR = 10;
export const INTERVALO_EXPURGO_ZERAR_MS = 60 * 60_000;
/** Zerar vencidos por chamada da `expurgar_zerar`. */
export const LOTE_EXPURGO_ZERAR = 20;

export interface OpcoesWorkerZerar {
  /** Pool próprio (`macuxi_worker`, 2 conexões: zerar e prévia). */
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

  /** Uma chamada numa transação com prazo de 15 min e `lock_timeout` de 5 s; devolve o jsonb da função. */
  async function emTransacao(sql: string, id: string): Promise<unknown> {
    const c = await op.pool.connect();
    try {
      await c.query('begin');
      await c.query("set local statement_timeout = '15min'");
      await c.query("set local lock_timeout = '5s'");
      const r = (await c.query<{ r: unknown }>(sql, [id])).rows[0]?.r ?? null;
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
        const r = ZerarEmpresaSchema.safeParse(await emTransacao(SQL_EXECUTAR_ZERAR, job.id));
        if (!r.success) {
          // a transação confirmou; só a resposta não bate com o contrato (desvio da 0100): o portal mostra pelo sa_ler_zerar
          log.warn({ ...base, tentativa }, 'zerar dados: resposta da executar_zerar fora do contrato');
          return 'concluido';
        }
        const z = r.data;
        if (z.situacao === 'falhou') {
          // a executar_zerar conferiu de novo e recusou (exclusão, outro zerar, backup ou Hub): fechou com o código, nada mudou
          log.warn({ ...base, tentativa, situacao: z.situacao, erro_codigo: z.erro_codigo }, 'zerar dados recusado; nada foi apagado');
          return 'falhou';
        }
        log.info(
          {
            ...base,
            tentativa,
            situacao: z.situacao,
            entidades: z.entidades,
            entidades_afetadas: z.entidades_afetadas,
            linhas_apagadas: z.linhas_apagadas,
            tabelas: z.contagem?.length ?? null,
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
          await esperar(ESPERAS_ZERAR_MS[Math.min(tentativa, ESPERAS_ZERAR_MS.length) - 1]!);
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

  /**
   * Uma prévia reservada: conta numa transação e devolve a situação gravada. `null` = não havia prévia; `falhou` também quando
   * a chamada deu erro (a prévia volta depois da concessão; o banco fecha `falhou` no teto de tentativas).
   */
  async function cicloPrevia(): Promise<'pronta' | 'falhou' | 'em_andamento' | null> {
    const job = (await op.pool.query<{ id: string | null; empresa_id: string | null }>(SQL_PEGAR_PREVIA_ZERAR)).rows[0];
    if (!job?.id) return null;
    const base = { tipo: 'zerar_previa', previa_id: job.id, tenant_alvo_id: job.empresa_id };
    try {
      const r = PreviaZerarSchema.safeParse(await emTransacao(SQL_EXECUTAR_PREVIA_ZERAR, job.id));
      if (!r.success) {
        log.warn(base, 'prévia do zerar: resposta da executar_previa_zerar fora do contrato');
        return 'falhou';
      }
      const p = r.data;
      log.info(
        { ...base, situacao: p.situacao, total: p.total, tabelas: p.linhas?.length ?? null, bloqueio: p.bloqueio, erro_codigo: p.erro_codigo },
        'prévia do zerar calculada',
      );
      return p.situacao;
    } catch (e) {
      const estado = campo(e, 'code');
      log.error({ ...base, sqlstate: estado || null, ...(estado ? {} : { erro: mensagemSegura(e) }) }, 'prévia do zerar falhou; volta depois da concessão');
      return 'falhou';
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
    cicloPrevia,
    expurgar,
    /**
     * Laços do processo: zerar a cada `intervaloMs` (padrão 10 s), prévia a cada `intervaloPreviaMs` (2 s) e descarte a cada
     * hora. Erro é logado e o laço segue. `ativo` (padrão: sempre) roda antes de cada ciclo: `false` pula o ciclo, e um erro
     * nele é logado como os outros (o ciclo seguinte tenta de novo).
     */
    iniciar(
      o: { intervaloMs?: number; intervaloPreviaMs?: number; intervaloExpurgoMs?: number; ativo?: () => Promise<boolean> } = {},
    ): { parar(): Promise<void> } {
      const ativo = o.ativo ?? (async () => true);
      const zerar = iniciarLaco({
        ciclo: async () => {
          if (!(await ativo())) return;
          while ((await ciclo()) !== null) {
            /* esvazia a fila antes de esperar */
          }
        },
        intervaloMs: o.intervaloMs ?? INTERVALO_ZERAR_MS,
        aoFalhar: (e) => log.error({ tipo: 'zerar', erro: mensagemSegura(e) }, 'ciclo do zerar falhou'),
      });
      const previa = iniciarLaco({
        ciclo: async () => {
          if (!(await ativo())) return;
          for (let i = 0; i < LOTE_PREVIA_ZERAR && (await cicloPrevia()) !== null; i++) {
            /* esvazia a fila antes de esperar, com teto */
          }
        },
        intervaloMs: o.intervaloPreviaMs ?? INTERVALO_PREVIA_ZERAR_MS,
        aoFalhar: (e) => log.error({ tipo: 'zerar_previa', erro: mensagemSegura(e) }, 'ciclo da prévia do zerar falhou'),
      });
      const expurgo = iniciarLaco({
        ciclo: async () => {
          if (!(await ativo())) return;
          while ((await expurgar()) >= LOTE_EXPURGO_ZERAR) {
            /* esvazia os vencidos antes de esperar */
          }
        },
        intervaloMs: o.intervaloExpurgoMs ?? INTERVALO_EXPURGO_ZERAR_MS,
        aoFalhar: (e) => log.error({ tipo: 'zerar', etapa: 'expurgo', erro: mensagemSegura(e) }, 'descarte das cópias do zerar falhou'),
      });
      return {
        async parar() {
          await Promise.all([zerar.parar(), previa.parar(), expurgo.parar()]);
        },
      };
    },
  };
}

/**
 * Conferência da 0100, uma vez por processo: `true` = ligado; `false` = a função não existe (desligado, com um log); erro de
 * conexão sobe, e o laço tenta de novo no ciclo seguinte (o banco fora na subida não desliga o zerar).
 */
export function criarConferenciaMigracao(pool: Pick<pg.Pool, 'query'>, log: LogRota): () => Promise<boolean> {
  let estado: boolean | undefined;
  let emCurso: Promise<boolean> | undefined;
  return async () => {
    if (estado !== undefined) return estado;
    emCurso ??= pool
      .query<{ ok: boolean }>(SQL_EXISTE_0100)
      .then((r) => {
        estado = r.rows[0]?.ok === true;
        if (estado) log.info({ tipo: 'zerar' }, 'zerar dados no ar');
        else log.info({ tipo: 'zerar' }, 'zerar dados desligado: falta a migração 0100 no banco');
        return estado;
      })
      .finally(() => {
        emCurso = undefined;
      });
    return emCurso;
  };
}

/** Entrada do `worker.ts`: pool próprio de 2 conexões do `macuxi_worker`; os laços sobem já e conferem a 0100 no primeiro ciclo. */
export function iniciarZerarEmpresa(
  urlWorker: string,
  log: LogRota,
  env: NodeJS.ProcessEnv = process.env,
): { parar(): Promise<void> } {
  const pool = new pg.Pool({ connectionString: urlWorker, max: 2, options: '-c statement_timeout=30000' });
  pool.on('error', (e) => log.error({ tipo: 'zerar', erro: mensagemSegura(e) }, 'conexão do zerar caiu'));
  const w = criarWorkerZerar({ pool, log });
  const execucao = w.iniciar({
    intervaloMs: Number(env.MACUXI_ZERAR_INTERVALO_MS ?? INTERVALO_ZERAR_MS),
    ativo: criarConferenciaMigracao(pool, log),
  });
  return {
    async parar() {
      await execucao.parar();
      await pool.end();
    },
  };
}
