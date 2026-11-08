/**
 * Fila do e-mail transacional (T-0094, RN-CORE-34): a rota só enfileira; o worker entrega com nova tentativa.
 *
 * - `criarFilaPgBoss(boss)`: adaptador para pg-boss v10 por TIPO ESTRUTURAL (`PgBossLike`), sem importar o pacote (a
 *   dependência entra depois, pendência (a) do desenho). `id` do job = `idEnvio` (idempotência: o mesmo id não gera 2º
 *   job); retryLimit 5, retryDelay 30 s com backoff. O handler lança ⇒ o pg-boss tenta de novo; a mensagem lançada é sempre
 *   a de um `ErroEmail` (segura: vai para a coluna `output` do job).
 * - `criarFilaMemoria()`: mesma semântica em memória (testes e demo sem pg-boss). Não sobrevive a reinicialização.
 *
 * O job só carrega `idEnvio`, `modelo`, `tenantId` e a carga CIFRADA (`cifra.ts`): nada de e-mail, nome ou senha em claro.
 */
import { CODIGOS_EMAIL, ModeloEmailSchema, type LogRota } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { comoErroEmail } from './erros';

export const NOME_FILA_EMAIL = 'macuxi-email';

/** Política de nova tentativa (pg-boss: segundos). 1 tentativa + 5 novas, 30 s com backoff exponencial. */
export const POLITICA_TENTATIVAS_EMAIL = { retryLimit: 5, retryDelay: 30, retryBackoff: true, expireInSeconds: 120 } as const;

export const JobEmailSchema = z
  .object({
    v: z.literal(1),
    idEnvio: z.string().uuid(),
    modelo: ModeloEmailSchema,
    tenantId: z.string().uuid().optional(),
    /** Pedido cifrado (`v1.<iv>.<tag>.<dados>`). */
    carga: z.string().min(1).max(32_768),
  })
  .strict();
export type JobEmail = z.infer<typeof JobEmailSchema>;

export interface ContextoJobEmail {
  /** 1 na primeira execução. */
  tentativa: number;
  /** Última tentativa: se falhar agora, o e-mail não sai. */
  ultima: boolean;
}

/** Processa um job. Lançar = tentar de novo (se ainda houver tentativa). */
export type ProcessarJobEmail = (job: JobEmail, ctx: ContextoJobEmail) => Promise<void>;

export interface FilaEmail {
  readonly nome: string;
  enfileirar(job: JobEmail): Promise<void>;
  /** Liga o consumo (worker). */
  processar(handler: ProcessarJobEmail): Promise<void>;
  parar(): Promise<void>;
}

const logMudo: LogRota = { info: () => undefined, warn: () => undefined, error: () => undefined };

// ---------------------------------------------------------------------------------------------------------------------
// pg-boss (estrutural)

export interface OpcoesSendPgBoss {
  id: string;
  retryLimit: number;
  retryDelay: number;
  retryBackoff: boolean;
  expireInSeconds: number;
}

export interface JobPgBossLike {
  id: string;
  data: unknown;
  /** Com `includeMetadata: true` (pg-boss v10). */
  retryCount?: number;
  retryLimit?: number;
}

/** O pedaço do pg-boss v10 que a fila usa. */
export interface PgBossLike {
  createQueue(nome: string, opcoes?: Record<string, unknown>): Promise<unknown>;
  getQueue?(nome: string): Promise<unknown>;
  send(nome: string, dados: object, opcoes: OpcoesSendPgBoss): Promise<string | null>;
  work(
    nome: string,
    opcoes: { batchSize?: number; includeMetadata?: boolean; pollingIntervalSeconds?: number },
    handler: (jobs: JobPgBossLike[]) => Promise<unknown>,
  ): Promise<string>;
  offWork?(nome: string): Promise<unknown>;
}

export function criarFilaPgBoss(boss: PgBossLike, opcoes: { nome?: string; log?: LogRota; pollingIntervalSeconds?: number } = {}): FilaEmail {
  const nome = opcoes.nome ?? NOME_FILA_EMAIL;
  const log = opcoes.log ?? logMudo;
  let pronta: Promise<void> | null = null;
  const garantirFila = () =>
    (pronta ??= (async () => {
      if (boss.getQueue && (await boss.getQueue(nome))) return;
      await boss.createQueue(nome, { ...POLITICA_TENTATIVAS_EMAIL });
    })().catch((e: unknown) => {
      pronta = null;
      throw e;
    }));

  return {
    nome,
    async enfileirar(job) {
      const j = JobEmailSchema.parse(job);
      await garantirFila();
      // `null` = já existe job com esse id: idempotente (o mesmo idEnvio não gera 2º e-mail)
      await boss.send(nome, j, { id: j.idEnvio, ...POLITICA_TENTATIVAS_EMAIL });
    },
    async processar(handler) {
      await garantirFila();
      await boss.work(
        nome,
        { batchSize: 1, includeMetadata: true, ...(opcoes.pollingIntervalSeconds ? { pollingIntervalSeconds: opcoes.pollingIntervalSeconds } : {}) },
        async (jobs) => {
          for (const j of jobs) {
            const job = JobEmailSchema.safeParse(j.data);
            if (!job.success) {
              // job malformado: tentar de novo não resolve; conclui e registra só o código
              log.warn({ tipo: 'email', evento: 'job_invalido', id_job: j.id, codigo: CODIGOS_EMAIL.PROTOCOLO }, 'job de e-mail inválido descartado');
              continue;
            }
            const limite = j.retryLimit ?? POLITICA_TENTATIVAS_EMAIL.retryLimit;
            const tentativa = (j.retryCount ?? 0) + 1;
            try {
              await handler(job.data, { tentativa, ultima: tentativa > limite });
            } catch (e) {
              throw comoErroEmail(e); // mensagem segura na coluna `output` do pg-boss
            }
          }
        },
      );
    },
    async parar() {
      await boss.offWork?.(nome);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// memória

export type AgendarEmail = (fn: () => void, ms: number) => () => void;

export interface FilaEmailMemoria extends FilaEmail {
  /** Resolve quando não houver job pendente nem em execução. */
  ocioso(): Promise<void>;
  situacao(idEnvio: string): { estado: 'pendente' | 'processando' | 'concluido' | 'falhou'; tentativas: number } | undefined;
}

const agendarPadrao: AgendarEmail = (fn, ms) => {
  const t = setTimeout(fn, ms);
  t.unref?.();
  return () => clearTimeout(t);
};

/** Atraso padrão: 30 s, 60 s, 120 s… (mesma política do pg-boss com backoff). */
export const atrasoPadraoEmail = (tentativa: number): number => POLITICA_TENTATIVAS_EMAIL.retryDelay * 1000 * 2 ** (tentativa - 1);

export function criarFilaMemoria(
  opcoes: { maxTentativas?: number; atrasoMs?: (tentativa: number) => number; agendar?: AgendarEmail; nome?: string } = {},
): FilaEmailMemoria {
  const maxTentativas = opcoes.maxTentativas ?? POLITICA_TENTATIVAS_EMAIL.retryLimit + 1;
  const atrasoMs = opcoes.atrasoMs ?? atrasoPadraoEmail;
  const agendar = opcoes.agendar ?? agendarPadrao;
  type Item = { job: JobEmail; estado: 'pendente' | 'processando' | 'concluido' | 'falhou'; tentativas: number; cancelar?: () => void };
  const itens = new Map<string, Item>();
  let handler: ProcessarJobEmail | null = null;
  let esperas: (() => void)[] = [];

  const ativos = () => [...itens.values()].some((i) => i.estado === 'pendente' || i.estado === 'processando');
  const avisarSeOcioso = () => {
    if (ativos()) return;
    const w = esperas;
    esperas = [];
    for (const f of w) f();
  };

  const programar = (item: Item, ms: number) => {
    item.cancelar = agendar(() => void executar(item), ms);
  };

  async function executar(item: Item): Promise<void> {
    item.cancelar = undefined;
    if (!handler || item.estado !== 'pendente') return;
    item.estado = 'processando';
    item.tentativas += 1;
    try {
      await handler(item.job, { tentativa: item.tentativas, ultima: item.tentativas >= maxTentativas });
      item.estado = 'concluido';
    } catch {
      if (item.tentativas < maxTentativas) {
        item.estado = 'pendente';
        programar(item, atrasoMs(item.tentativas));
      } else {
        item.estado = 'falhou';
      }
    }
    avisarSeOcioso();
  }

  return {
    nome: opcoes.nome ?? NOME_FILA_EMAIL,
    async enfileirar(job) {
      const j = JobEmailSchema.parse(job);
      if (itens.has(j.idEnvio)) return; // idempotente
      const item: Item = { job: j, estado: 'pendente', tentativas: 0 };
      itens.set(j.idEnvio, item);
      if (handler) programar(item, 0);
    },
    async processar(h) {
      handler = h;
      for (const item of itens.values()) if (item.estado === 'pendente' && !item.cancelar) programar(item, 0);
    },
    async parar() {
      handler = null;
      for (const item of itens.values()) {
        item.cancelar?.();
        item.cancelar = undefined;
      }
    },
    ocioso() {
      if (!ativos()) return Promise.resolve();
      return new Promise<void>((resolve) => esperas.push(resolve));
    },
    situacao(idEnvio) {
      const i = itens.get(idEnvio);
      return i ? { estado: i.estado, tentativas: i.tentativas } : undefined;
    },
  };
}
