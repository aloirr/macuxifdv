/**
 * Fila de aprovação do gestor (RF-GES-04). A ALÇADA (quem aprova qual desconto/crédito) é do Vendedor
 * (RN-VEN-10..13): o Gestor lê o `nivel` já decidido em `vendedor.pedido.aprovacao_solicitada@1` e só organiza prazos.
 * A decisão é executada pela API pública do Vendedor (ação `pedido.aprovar`); aqui só o formato e a validação do comentário.
 */
import { z } from 'zod';
import { CentsNaoNeg, EstadoAprovacaoMotivo, InstanteUtc, MotivoAprovacao, NivelAprovacao, PctNumero, Uuid } from './base';

/** RN-GES-08: devolver e rejeitar exigem motivo (mínimo 3 caracteres); aprovar continua em 1 toque, sem comentário. */
export const MENSAGEM_MOTIVO_REJEICAO = 'RN-GES-08: informe o motivo da rejeição (mínimo 3 caracteres).';
const motivoValido = (d: { decisao: string; comentario: string | null }) => d.decisao === 'aprovar' || (d.comentario ?? '').trim().length >= 3;
import { CreditoClienteEvento, HistoricoClienteEvento } from '../../vendedor/contracts';

export const SITUACOES_PRAZO = ['no_prazo', 'vencendo', 'vencido'] as const;
export const SituacaoPrazo = z.enum(SITUACOES_PRAZO);
export type SituacaoPrazo = z.infer<typeof SituacaoPrazo>;

/** T-0184 (P3 B): inadimplência do cliente que levou o pedido à aprovação (RN-VEN-13). */
export const InadimplenciaFila = z.object({ maior_atraso_dias: z.number().int().nonnegative(), vencidos_cents: CentsNaoNeg }).strict();
export type InadimplenciaFila = z.infer<typeof InadimplenciaFila>;

/** Uma aprovação do pedido, por motivo; `pode_decidir` vale para quem consulta (RN-GES-04). */
export const AprovacaoDoItem = z.object({ motivo: MotivoAprovacao, nivel: NivelAprovacao, estado: EstadoAprovacaoMotivo, pode_decidir: z.boolean() }).strict();
export type AprovacaoDoItem = z.infer<typeof AprovacaoDoItem>;

export const ItemFilaAprovacao = z
  .object({
    pedido_id: Uuid,
    vendedor_id: Uuid,
    cliente_id: Uuid,
    solicitada_em: InstanteUtc,
    nivel: NivelAprovacao,
    /** Motivos pendentes que quem consulta vê (cada aprovador vê só os dele, P3 B). */
    motivos: z.array(MotivoAprovacao).min(1),
    /** Uma entrada por motivo pendente visível; a tela mostra um cartão por entrada. */
    aprovacoes: z.array(AprovacaoDoItem).min(1),
    inadimplencia: InadimplenciaFila.nullable(),
    /** Número do pedido para o cartão (`Nº 000021`); vem do evento, `null` quando o Vendedor não informa. */
    pedido_numero: z.string().nullable().default(null),
    total_cents: CentsNaoNeg,
    desconto_efetivo_pct: PctNumero.nonnegative(),
    credito: CreditoClienteEvento.nullable(),
    historico: HistoricoClienteEvento.nullable(),
    /** RN-GES-03: prazo em dias úteis — mesmo horário local do N-ésimo dia útil depois do início da contagem. */
    prazo_em: InstanteUtc,
    /** Horas ÚTEIS até o prazo (negativo = vencido há N horas úteis), 2 casas. */
    horas_restantes: z.number(),
    situacao: SituacaoPrazo,
    /** Quem consulta decide pelo menos uma das aprovações (RN-GES-04: o gerente também decide o nível supervisor); senão é leitura. */
    pode_decidir: z.boolean(),
    /** RN-GES-04: a decisão seria acima do nível pedido (gerente num item do supervisor) e avisaria o supervisor. */
    acima_do_nivel: z.boolean(),
  })
  .strict();
export type ItemFilaAprovacao = z.infer<typeof ItemFilaAprovacao>;

/** `devolver` chama a rota `rejeitar` do Vendedor (volta ao vendedor); `rejeitar` chama a rota `recusar` (cancela, P6 A). */
export const DECISOES_APROVACAO = ['aprovar', 'devolver', 'rejeitar'] as const;
export const DecisaoAprovacao = z
  .object({
    pedido_id: Uuid,
    decisao: z.enum(DECISOES_APROVACAO),
    /** Sem motivo, a decisão vale para todas as aprovações que o usuário pode decidir. */
    motivo: MotivoAprovacao.optional(),
    comentario: z.string().trim().max(500).nullable().default(null),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (!motivoValido(d)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['comentario'], message: MENSAGEM_MOTIVO_REJEICAO });
  });
export type DecisaoAprovacao = z.infer<typeof DecisaoAprovacao>;

/** Perfis que decidem na fila do Gestor (analista e admin só leem, RN-GES-07). */
export const PERFIS_QUE_DECIDEM = ['supervisor', 'gerente'] as const;

/**
 * RN-GES-04: registro (auditoria) da decisão tomada na fila: quem decidiu, com que perfil, em que nível o pedido
 * estava e se foi acima do nível. A API grava junto da chamada a `pedido.aprovar` do Vendedor.
 */
export const RegistroDecisaoAprovacao = z
  .object({
    pedido_id: Uuid,
    vendedor_id: Uuid,
    decisao: z.enum(DECISOES_APROVACAO),
    motivo: MotivoAprovacao.nullable(),
    comentario: z.string().max(500).nullable(),
    nivel_pedido: NivelAprovacao,
    decidido_por_id: Uuid,
    decidido_por_perfil: z.enum(PERFIS_QUE_DECIDEM),
    acima_do_nivel: z.boolean(),
    decidido_em: InstanteUtc,
  })
  .strict()
  .refine(motivoValido, { path: ['comentario'], message: MENSAGEM_MOTIVO_REJEICAO });
export type RegistroDecisaoAprovacao = z.infer<typeof RegistroDecisaoAprovacao>;

/**
 * RN-GES-04: item de notificação para o supervisor do vendedor quando o gerente decide um item do nível dele.
 * O Gestor não publica evento: a API entrega este item à notificação do Core (`core.notificacao.criada@1` é do Core).
 */
export const AvisoDecisaoAoSupervisor = z
  .object({
    tipo: z.literal('aprovacao_decidida_pelo_gerente'),
    destinatario_id: Uuid,
    pedido_id: Uuid,
    vendedor_id: Uuid,
    decisao: z.enum(DECISOES_APROVACAO),
    motivo: MotivoAprovacao.nullable(),
    decidido_por_id: Uuid,
    decidido_em: InstanteUtc,
  })
  .strict();
export type AvisoDecisaoAoSupervisor = z.infer<typeof AvisoDecisaoAoSupervisor>;

export const CODIGOS_RECUSA_DECISAO = ['DECISAO_INVALIDA', 'NAO_PENDENTE', 'FORA_DO_ESCOPO', 'FORA_DA_ALCADA', 'SOMENTE_LEITURA'] as const;
export type CodigoRecusaDecisao = (typeof CODIGOS_RECUSA_DECISAO)[number];

export const ResumoFila = z
  .object({ total: z.number().int().nonnegative(), vencidos: z.number().int().nonnegative(), vencendo: z.number().int().nonnegative(), para_mim: z.number().int().nonnegative() })
  .strict();
export type ResumoFila = z.infer<typeof ResumoFila>;
