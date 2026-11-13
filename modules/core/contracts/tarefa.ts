/**
 * Tarefas do consultor (RF-CORE-18 proposto; RN-CORE-TAR-01..12; T-0170; desenho `docs/desenho/tarefas-consultor.md` §4.1).
 * A tarefa fica no Core: `core.tarefa` (como foi cadastrada) e `core.tarefa_destinatario` (uma linha por consultor, a que vai
 * ao aparelho). O aviso ao consultor é uma `core.notificacao` com `tipo = 'sistema'` e `subtipo = 'tarefa'` (§2.2): o APK
 * v1.0.5 lê como "Aviso do sistema" e não quebra. Sync: pull `tarefa` (escopo `proprio`) e push `tarefa_conclusao` (comando,
 * ADR 0009, `somente_insercao`). Rotas BKO em `/v1/core/tarefas`. As regras ficam no domain (`domain/tarefas/`).
 */
import { ehDataCivil } from '@macuxi/comum/calendar';
import { z } from 'zod';
import { PerfilSchema } from './auth';
import { ClienteSyncSchema, type TIPOS_NOTIFICACAO } from './sync';

const Base = ClienteSyncSchema.pick({ id: true, updated_at: true, deleted_at: true, external_id: true }).shape;
const DataCivil = z.string().refine(ehDataCivil, 'Data inexistente no calendário. Informe uma data válida (AAAA-MM-DD).');

export const TIPOS_TAREFA = ['simples', 'foto', 'pesquisa'] as const;
export type TipoTarefa = (typeof TIPOS_TAREFA)[number];

export const TAREFA_TITULO_MAX = 120;
export const TAREFA_DESCRICAO_MAX = 1000;
export const TAREFA_OBSERVACAO_MAX = 500;
export const TAREFA_MOTIVO_CANCELAMENTO_MAX = 300;
/** Mesmo limite do recado (§5): cada criação vai a no máximo 500 consultores. */
export const TAREFA_DESTINATARIOS_MAX = 500;
/** RN-CORE-TAR-05: de 1 a 5 fotos no tipo `foto`. */
export const TAREFA_FOTOS_MAX = 5;

/**
 * RN-CORE-TAR-07: o aviso da tarefa usa um `tipo` que o APK v1.0.5 já conhece. Valor novo no enum `TIPOS_NOTIFICACAO`
 * derrubaria o pull da notificação nos aparelhos antigos (vocabulário novo = @2 + ADR). O teste de contrato trava isso.
 */
export const TIPO_NOTIFICACAO_TAREFA = 'sistema' as const satisfies (typeof TIPOS_NOTIFICACAO)[number];
export const SUBTIPO_NOTIFICACAO_TAREFA = 'tarefa';

/** Situação de uma linha (destinatário) calculada no aparelho e no servidor (RN-CORE-TAR-02, 08, 10 e 11). */
export const SITUACOES_TAREFA = ['aberta', 'atrasada', 'feita_no_prazo', 'feita_com_atraso', 'cancelada', 'sem_modulo', 'sem_consultor_ativo'] as const;
export type SituacaoTarefa = (typeof SITUACOES_TAREFA)[number];

/** Códigos de erro das rotas e do `receber` (a API devolve `ErroRegraNegocio` com estes códigos). */
export const ERROS_TAREFA = {
  foraDoEscopo: 'FORA_DO_ESCOPO',
  naoEncontrada: 'TAREFA_NAO_ENCONTRADA',
  destinatarioVazio: 'DESTINATARIO_VAZIO',
  destinatarios: 'RN-CORE-TAR-01',
  prazo: 'RN-CORE-TAR-02',
  pesquisa: 'RN-CORE-TAR-03',
  cliente: 'RN-CORE-TAR-04',
  foto: 'RN-CORE-TAR-05',
  inativo: 'RN-CORE-TAR-10',
  promotor: 'RN-PRO-01',
} as const;

export const DestinoTarefaSchema = z.discriminatedUnion('alvo', [
  z.object({ alvo: z.literal('usuarios'), usuario_ids: z.array(z.string().uuid()).min(1).max(TAREFA_DESTINATARIOS_MAX) }).strict(),
  z.object({ alvo: z.literal('equipe'), equipe_id: z.string().uuid() }).strict(),
  z.object({ alvo: z.literal('todos') }).strict(),
]);
export type DestinoTarefa = z.infer<typeof DestinoTarefaSchema>;

/** BKO → `POST /v1/core/tarefas`. Mesmo `id` = mesma tarefa (idempotência). A API revalida o prazo (≥ hoje no fuso do tenant). */
export const CriarTarefaSchema = z
  .object({
    id: z.string().uuid(),
    titulo: z.string().trim().min(1).max(TAREFA_TITULO_MAX),
    descricao: z.string().trim().max(TAREFA_DESCRICAO_MAX).nullable().default(null),
    prazo: DataCivil,
    cliente_id: z.string().uuid().nullable().default(null),
    tipo: z.enum(TIPOS_TAREFA),
    questionario_id: z.string().uuid().nullable().default(null),
    destino: DestinoTarefaSchema,
  })
  .strict()
  .refine((v) => (v.tipo === 'pesquisa') === (v.questionario_id !== null), {
    message: 'Escolha o questionário só na tarefa de pesquisa.',
    path: ['questionario_id'],
  });
export type CriarTarefa = z.infer<typeof CriarTarefaSchema>;

export const CriarTarefaRespostaSchema = z
  .object({ tarefa_id: z.string().uuid(), destinatarios: z.number().int(), ja_existia: z.boolean() })
  .strict();
export type CriarTarefaResposta = z.infer<typeof CriarTarefaRespostaSchema>;

/** BKO → `PATCH /v1/core/tarefas/:id`: só prazo e descrição (RN-CORE-TAR-09). */
export const EditarTarefaSchema = z
  .object({ prazo: DataCivil.optional(), descricao: z.string().trim().max(TAREFA_DESCRICAO_MAX).nullable().optional() })
  .strict();
export type EditarTarefa = z.infer<typeof EditarTarefaSchema>;

/** BKO → `POST /v1/core/tarefas/:id/cancelar` (RN-CORE-TAR-08). */
export const CancelarTarefaSchema = z.object({ motivo: z.string().trim().min(1).max(TAREFA_MOTIVO_CANCELAMENTO_MAX) }).strict();
export type CancelarTarefa = z.infer<typeof CancelarTarefaSchema>;

/** Pull `tarefa` (escopo `proprio`): uma linha por destinatário; `id` = `tarefa_destinatario.id`. */
export const TarefaSyncSchema = z
  .object({
    ...Base,
    tarefa_id: z.string().uuid(),
    usuario_id: z.string().uuid(),
    titulo: z.string().max(TAREFA_TITULO_MAX),
    descricao: z.string().max(TAREFA_DESCRICAO_MAX).nullable(),
    prazo: DataCivil,
    tipo: z.enum(TIPOS_TAREFA),
    cliente_id: z.string().uuid().nullable(),
    /** Instantâneo do nome, para o caso de o cliente sair da carteira (RN-CORE-TAR-04). */
    cliente_nome: z.string().nullable(),
    questionario_id: z.string().uuid().nullable(),
    autor_nome: z.string().nullable(),
    autor_perfil: PerfilSchema.nullable(),
    concluida_em: z.string().nullable(),
    cancelada_em: z.string().nullable(),
  })
  .strict();
export type TarefaSync = z.infer<typeof TarefaSyncSchema>;

/** Push `tarefa_conclusao` (comando, ADR 0009; `somente_insercao`). Só nos tipos `simples` e `foto` (a pesquisa conclui pelo evento). */
export const ConclusaoTarefaSchema = z
  .object({
    id: z.string().uuid(),
    tarefa_destinatario_id: z.string().uuid(),
    /** Hora do aparelho (RN-CORE-TAR-06). */
    concluida_em: z.string().datetime(),
    /** 1 a 5 no tipo `foto`; vazio no `simples` (o domain revalida). */
    foto_ids: z.array(z.string().uuid()).max(TAREFA_FOTOS_MAX).default([]),
    observacao: z.string().trim().max(TAREFA_OBSERVACAO_MAX).nullable().default(null),
  })
  .strict();
export type ConclusaoTarefa = z.infer<typeof ConclusaoTarefaSchema>;

/** `GET /v1/core/tarefas` (BKO). */
export const TarefaListaQuerySchema = z
  .object({
    situacao: z.enum(['abertas', 'atrasadas', 'concluidas', 'canceladas']).optional(),
    usuario_id: z.string().uuid().optional(),
    equipe_id: z.string().uuid().optional(),
    de: DataCivil.optional(),
    ate: DataCivil.optional(),
    limite: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type TarefaListaQuery = z.infer<typeof TarefaListaQuerySchema>;
