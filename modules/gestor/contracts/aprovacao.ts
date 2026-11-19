/**
 * Fila de aprovação do gestor (RF-GES-04). A ALÇADA (quem aprova qual desconto/crédito) é do Vendedor
 * (RN-VEN-10..13): o Gestor lê o `nivel` já decidido em `vendedor.pedido.aprovacao_solicitada@1` e só organiza prazos.
 * A decisão é uma chamada às rotas do Vendedor (`aprovar`, `rejeitar`, `recusar`), que revalida alçada e motivo (RN-GES-08); aqui só a fila.
 */
import { z } from 'zod';
import { CentsNaoNeg, EstadoAprovacaoMotivo, InstanteUtc, MotivoAprovacao, NivelAprovacao, PctNumero, Uuid } from './base';
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
    /** Nome do cliente para o cartão (nome fantasia, senão razão social, do cadastro do Core); `null` quando o cadastro não o tem. */
    cliente_nome: z.string().nullable().default(null),
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

export const ResumoFila = z
  .object({ total: z.number().int().nonnegative(), vencidos: z.number().int().nonnegative(), vencendo: z.number().int().nonnegative(), para_mim: z.number().int().nonnegative() })
  .strict();
export type ResumoFila = z.infer<typeof ResumoFila>;
