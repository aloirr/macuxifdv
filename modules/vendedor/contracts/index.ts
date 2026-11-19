/**
 * Contratos públicos do módulo Vendedor (pedidos, alçadas, painel de pedidos, push de sync).
 * O que é do core (Id, Cents, cliente, visita, cadastro base de produto) vem de `@macuxi/core/contracts`;
 * produto com preço e estoque, consulta de produtos e sugestão de mix vêm de `@macuxi/catalogo/contracts`
 * (ADR-0005, T-0007). O Vendedor não define tipo de produto: o pedido só referencia `product_id`.
 */
import { z } from 'zod';
import {
  Cents,
  CheckoutVisitRequest,
  CreateVisitRequest,
  CustomerSummary,
  FilialDadosFiscaisSchema,
  Id,
  IsoDate,
  IsoDateTime,
  Pct,
  Receivable,
} from '@macuxi/core/contracts';

import { ESTADOS_APROVACAO_MOTIVO, type DecisaoAprovador, MOTIVO_REJEICAO_MIN, MOTIVOS_APROVACAO, NIVEIS_APROVACAO } from '../domain/aprovacao';
import { SITUACOES_ORCAMENTO, TIPOS_DOCUMENTO } from '../domain/orcamento';
import { ORDER_STATUSES } from '../domain/order';
import { PercentualAjuste } from '@macuxi/integracao/contracts';
import { EnderecoEditadoPedido, EnderecoEntregaPedido, Frete, FreteDoPedido, ItemPush } from './frete';
export * from './formas-pagamento';
export * from './prazo-ajuste';

/** T-0054 (RN-VEN-37, proposta): situação da devolução do pedido. */
export const SITUACOES_DEVOLUCAO = ['nenhuma', 'parcial', 'total'] as const;

export { ORDER_STATUSES, ORDER_STATUS_LABEL } from '../domain/order';
export type { DecisaoAprovador, EstadoAprovacaoMotivo } from '../domain/aprovacao';
export { DECISOES_APROVADOR, ESTADOS_APROVACAO_MOTIVO, maiorNivel, MOTIVOS_APROVACAO, MOTIVO_REJEICAO_MIN, NIVEIS_APROVACAO, ROTULO_MOTIVO_APROVACAO, STATUS_CONTRATO } from '../domain/aprovacao';
export { SITUACAO_ORCAMENTO_LABEL, SITUACOES_ORCAMENTO, TIPOS_DOCUMENTO } from '../domain/orcamento';
// T-0077 (RF-VEN-05): busca e período da lista de Pedidos, reusados pelo Gestão (filtro de vendedor fica no Gestor)
export {
  JANELA_DIAS,
  ROTULO_SITUACAO,
  casaComBusca,
  contarPorSituacao,
  deslocarPeriodo,
  destacarTrecho,
  diasComPedido,
  filtrarLista,
  itemNaSituacao,
  itemNoPeriodo,
  mesesDoPeriodo,
  nomeDoMes,
  normalizarTexto,
  numeroSemZeros,
  periodoDe,
  periodoForaDaJanela,
  resumoDaLista,
  rotuloDoPeriodo,
  situacaoDoItem,
} from '../domain/busca-periodo';
export type { ContagemPorSituacao, ItemDaBusca, Periodo, SituacaoDaLista, TipoPeriodo, TrechoDoTexto } from '../domain/busca-periodo';
export * from './eventos';
export * from './sync';
export * from './pre-venda';
export * from './frete';

// ---------- pedidos ----------
/** Inclui os status do retorno do ERP (EstadoPedidoErp): enviado=sent_to_erp, integrado=integrated, faturado_parcial=invoiced_partial, faturado_total=invoiced, cancelado=cancelled. */
export const OrderStatus = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const OrderItem = z.object({
  id: Id,
  product_id: Id,
  erp_code: z.string(),
  description: z.string(),
  quantity: z.number().int(),
  unit_price_cents: Cents,
  discount_pct: Pct,
  total_cents: Cents,
  /** T-0054: unidades já faturadas pelo ERP (soma dos retornos), na UNIDADE BASE; ausente = sem retorno de faturamento */
  quantity_invoiced: z.number().int().nonnegative().optional(),
  /** 0013 (desenho T-0061 §2.1): quantidade na unidade base (quantidade x fator); compara com `quantity_invoiced` */
  quantity_base: z.number().int().nonnegative().optional(),
  // --- T-0061 (RN-VEN-15, RN-CORE-19): medida vendida e acréscimo do item; opcionais (pedido antigo = UN) ---
  /** sigla da medida vendida (UN, CX) */
  unit: z.string().optional(),
  /** unidades base por unidade vendida (UN = 1) */
  factor: z.number().int().positive().optional(),
  /** igual a `quantity_base` (nome do desenho T-0061): quantidade em unidades base */
  base_quantity: z.number().int().nonnegative().optional(),
  /** coluna Medida do PDF e do detalhe: "UN" / "CX c/ 12" */
  unit_label: z.string().optional(),
  /** acréscimo do item (RN-VEN-02); `discount_pct` passa a ser o desconto do item */
  surcharge_pct: Pct.optional(),
  // --- T-0071 (RN-VEN-02): R$ por unidade da medida vendida e modo digitado; opcionais ---
  unit_discount_cents: z.number().int().nonnegative().optional(),
  unit_surcharge_cents: z.number().int().nonnegative().optional(),
  adjust_mode: z.enum(['pct', 'valor']).optional(),
  /** T-0084 (RN-VEN-19): retrato da aplicação do produto no momento do pedido (até 1.000); ausente/nulo = desmarcada ou sem aplicação */
  application: z.string().max(1000).nullable().optional(),
  /** T-0159: retrato da marca do produto (coluna Marca do PDF); ausente = pedido anterior */
  brand: z.string().max(100).nullable().optional(),
});
export type OrderItem = z.infer<typeof OrderItem>;

export const OrderEvent = z.object({ at: IsoDateTime, status: z.string(), by: z.string(), note: z.string() });
export type OrderEvent = z.infer<typeof OrderEvent>;

/** T-0184: o estado de UMA aprovação do pedido (uma por motivo, P3 B). `texto_pendencia` é o que o aprovador lê; `decidida_*` só depois da decisão. */
export const AprovacaoMotivo = z.object({
  motivo: z.enum(MOTIVOS_APROVACAO),
  nivel: z.enum(NIVEIS_APROVACAO),
  estado: z.enum(ESTADOS_APROVACAO_MOTIVO),
  texto_pendencia: z.string(),
  decidida_por_id: Id.nullable(),
  decidida_em: IsoDateTime.nullable(),
  texto_decisao: z.string().nullable(),
});
export type AprovacaoMotivo = z.infer<typeof AprovacaoMotivo>;

export const Order = z.object({
  id: Id,
  number: z.string(),
  idempotency_key: z.string(),
  seller_id: Id,
  seller_name: z.string(),
  customer_id: Id,
  customer_name: z.string(),
  /** legado da Fase M; null no pedido da plataforma nova (T-0029 §3.3) */
  branch_id: Id.nullable(),
  branch_name: z.string().nullable(),
  /** T-0159 (T-0149): dados fiscais da filial de faturamento no retrato do pedido (CNPJ, endereço, telefone); ausente = pedido anterior */
  filial: FilialDadosFiscaisSchema.extend({ nome: z.string().nullish(), cidade: z.string().nullish(), uf: z.string().nullish() }).nullable().optional(),
  price_table_id: Id.nullable(),
  discount_pct: Pct,
  subtotal_cents: Cents,
  discount_cents: Cents,
  total_cents: Cents,
  payment_terms: z.string(),
  status: OrderStatus,
  /** motivo de estar aguardando aprovação (alçada ou crédito) */
  pending_reason: z.string(),
  rejection_reason: z.string(),
  erp_order_code: z.string(),
  created_offline_at: IsoDateTime.nullable(),
  received_at: IsoDateTime,
  updated_at: IsoDateTime,
  /** T-0077 D1: data da última mudança de status (pedido_evento); ausente = usar updated_at */
  status_changed_at: IsoDateTime.nullable().optional(),
  items_count: z.number().int(),
  units: z.number().int(),
  /** T-0029: nível que decide o pedido pendente e se QUEM CONSULTA pode decidir agora (a lista do BKO mostra os botões só a quem pode) */
  nivel_aprovacao: z.enum(NIVEIS_APROVACAO).nullable().optional(),
  pode_decidir: z.boolean().optional(),
  // --- T-0054: retorno do ERP (faturamento e devolução), opcionais (compatíveis com o app e o BKO anteriores) ---
  /** valor faturado pelo ERP (soma das notas do pedido) */
  faturado_cents: z.number().int().nonnegative().optional(),
  /** soma das notas de devolução do pedido (RN-VEN-37, proposta) */
  devolvido_cents: z.number().int().nonnegative().optional(),
  devolucao: z.enum(SITUACOES_DEVOLUCAO).optional(),
  /** número da última NF de faturamento */
  ultima_nota: z.string().nullable().optional(),
  /** linhas curtas prontas para a tela ("Faturado R$ … (NF …)", "Devolvido R$ … (parcial)") */
  situacao_faturamento: z.array(z.string()).optional(),
  /** T-0053 (RF-VEN-03): pedido ou orçamento; ausente = pedido (linhas e APKs anteriores). */
  tipo: z.enum(TIPOS_DOCUMENTO).optional(),
  /** T-0053 (RN-VEN-32): orçamento — validade e situação calculada no servidor para quem consulta. */
  validade_ate: IsoDateTime.nullable().optional(),
  situacao_orcamento: z.enum(SITUACOES_ORCAMENTO).nullable().optional(),
  /** T-0053: pedido nascido de orçamento / pedido em que o orçamento virou. */
  orcamento_origem_id: Id.nullable().optional(),
  convertido_pedido_id: Id.nullable().optional(),
  /** R-20261118-214740 (tabela de Pedidos do BKO): do retrato do cliente no pedido, da observação e dos motivos de aprovação; ausente = pedido anterior. */
  customer_code: z.string().optional(),
  customer_uf: z.string().optional(),
  customer_city: z.string().optional(),
  order_note: z.string().optional(),
  approval_reasons: z.array(z.enum(MOTIVOS_APROVACAO)).optional(),
  /** T-0184: uma aprovação por motivo, só as do ciclo atual; vazio se o pedido nunca foi para aprovação; ausente = servidor anterior */
  aprovacoes: z.array(AprovacaoMotivo).optional(),
  /** Supervisor do vendedor (cadastro do Core). Ausente até o Core expor o nome numa consulta (pendência). */
  supervisor_name: z.string().optional(),
  /** T-0138 (RN-VEN-31, T-0114): o conector aceita cancelar este pedido já enviado (vem no pull); ausente = não aceita. */
  erp_aceita_cancelamento: z.boolean().optional(),
  // --- T-0061: acréscimo do pedido, desconto efetivo (RN-VEN-03, sem frete), frete CIF/FOB e endereço de entrega ---
  /** acréscimo do pedido (RN-VEN-02); `discount_pct` é o desconto do pedido; os dois são excludentes */
  surcharge_pct: Pct.optional(),
  /** 1 − total dos itens ÷ total pela tabela; negativo = acréscimo; é o que a alçada olha (RN-VEN-10) */
  effective_discount_pct: z.number().optional(),
  freight: FreteDoPedido.nullable().optional(),
  delivery_address: EnderecoEntregaPedido.nullable().optional(),
  /** nome da tabela de preço (o PDF interno mostra o nome, não o id) */
  price_table_name: z.string().nullable().optional(),
  // --- T-0071: validade por data civil e ajuste do pedido em R$ (sobre o total dos itens); opcionais ---
  /** RN-VEN-18: "até 10/11" sem conta de fuso no app (AAAA-MM-DD) */
  validade_data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  order_adjust_mode: z.enum(['pct', 'valor']).optional(),
  order_discount_value_cents: z.number().int().nonnegative().optional(),
  order_surcharge_value_cents: z.number().int().nonnegative().optional(),
  // --- T-0089 (RN-VEN-24): retrato da forma e do prazo; opcionais (pedido anterior mostra `payment_terms`) ---
  forma_pagamento_id: Id.nullable().optional(),
  forma_pagamento_nome: z.string().nullable().optional(),
  prazo_pagamento_id: Id.nullable().optional(),
  prazo_descricao: z.string().nullable().optional(),
  prazo_parcelas_dias: z.array(z.number().int().min(0).max(365)).nullable().optional(),
  prazo_medio_dias: z.number().int().min(0).max(365).nullable().optional(),
});
export type Order = z.infer<typeof Order>;

// ---------- aprovação (T-0029, ADR 0011) ----------
export const NivelAprovacao = z.enum(NIVEIS_APROVACAO);
export type NivelAprovacao = z.infer<typeof NivelAprovacao>;
export const MotivoAprovacao = z.enum(MOTIVOS_APROVACAO);
export type MotivoAprovacao = z.infer<typeof MotivoAprovacao>;

/** Retrato do cliente no momento do pedido (D-6): é o que o PDF imprime. */
export const ClienteDoPedido = z.object({
  razao_social: z.string(),
  nome_fantasia: z.string(),
  documento: z.string(),
  endereco: z.string(),
  bairro: z.string(),
  cidade: z.string(),
  uf: z.string(),
  codigo_erp: z.string(),
});
export type ClienteDoPedido = z.infer<typeof ClienteDoPedido>;

export const AprovacaoDoPedido = z.object({
  nivel: NivelAprovacao,
  motivos: z.array(MotivoAprovacao),
  desconto_efetivo_pct: Pct,
  limite_vendedor_pct: Pct,
  /** calculado para quem consulta (matriz §2, RN-GES-04, P-3) */
  pode_decidir: z.boolean(),
  /** o gerente decidindo um pedido do nível supervisor */
  acima_do_nivel: z.boolean(),
});
export type AprovacaoDoPedido = z.infer<typeof AprovacaoDoPedido>;

/** T-0054: notas de faturamento e de devolução do pedido (detalhe do BKO e da Gestão online). */
export const FaturamentoDoPedido = z.object({
  faturado_cents: z.number().int().nonnegative(),
  devolvido_cents: z.number().int().nonnegative(),
  devolucao: z.enum(SITUACOES_DEVOLUCAO),
  notas: z.array(
    z.object({
      numero: z.string().nullable(),
      serie: z.string().nullable(),
      faturado_em: IsoDateTime,
      parcial: z.boolean(),
      total_cents: z.number().int().nonnegative().nullable(),
      unidades: z.number().int().nonnegative(),
    }),
  ),
  devolucoes: z.array(z.object({ numero: z.string(), serie: z.string().nullable(), emitida_em: IsoDateTime, total_cents: z.number().int().nonnegative() })),
});
export type FaturamentoDoPedido = z.infer<typeof FaturamentoDoPedido>;

export const OrderDetail = Order.extend({
  items: z.array(OrderItem),
  history: z.array(OrderEvent),
  cliente: ClienteDoPedido.nullable().optional(),
  aprovacao: AprovacaoDoPedido.nullable().optional(),
  faturamento: FaturamentoDoPedido.nullable().optional(),
  /** T-0064/T-0061: nome da tabela de preço (PDF e detalhe nunca mostram o id) */
  price_table_name: z.string().nullable().optional(),
  /** T-0064/T-0061 (RN-VEN-13): frete sem valor, CIF ou FOB com transportadora */
  freight: z
    .object({
      modality: z.enum(['CIF', 'FOB']),
      carrier_name: z.string().nullable().optional(),
      carrier_document: z.string().nullable().optional(),
      carrier_phone: z.string().nullable().optional(),
      carrier_typed: z.boolean().optional(),
    })
    .nullable()
    .optional(),
});
export type OrderDetail = z.infer<typeof OrderDetail>;

export const CreateOrderRequest = z.object({
  /** UUID gerado no aparelho */
  id: z.string().uuid(),
  customer_id: Id,
  branch_id: Id.optional(),
  discount_pct: Pct.min(0).max(100),
  payment_terms: z.string().default('28/56 dias'),
  created_offline_at: IsoDateTime.nullable().optional(),
  route_stop_id: Id.nullable().optional(),
  /**
   * Total calculado no aparelho (centavos). Só informativo: o core lê para mostrar o total do pedido na
   * visita enquanto ele está na fila. A API NUNCA confia nele: recalcula tudo (RN-VEN preço/alçada).
   */
  total_cents: z.number().int().nonnegative().optional(),
  items: z.array(z.object({ product_id: Id, quantity: z.number().int().positive() })).min(1),
});
export type CreateOrderRequest = z.infer<typeof CreateOrderRequest>;

/**
 * Push da entidade pedido (receber, T-0029 §3.1): o CreateOrderRequest com campos novos OPCIONAIS (a fila dos APKs já
 * instalados continua válida). O servidor recalcula tudo; total_cents é só informativo (RN-VEN-02).
 */
export const PedidoPush = CreateOrderRequest.extend({
  items: z.array(ItemPush).min(1).max(200),
  condicao_pagamento_id: z.string().uuid().nullable().optional(),
  /**
   * T-0089 (RN-VEN-24/25, aditivo): forma e prazo do pedido. Vêm os dois ou nenhum (só um = 422 `RN-VEN-24`, conferido na API).
   * Sem nenhum dos dois vale o caminho legado do `condicao_pagamento_id` (APK anterior).
   */
  forma_pagamento_id: z.string().uuid().nullable().optional(),
  prazo_pagamento_id: z.string().uuid().nullable().optional(),
  /**
   * RN-VEN-45 (v1.0.13, aditivo): "Desc./Acrésc. (%)" do prazo no momento do pedido (congelado). A API recalcula os preços por ele
   * e o revalida (aceita o vigente, ou o antigo se o cadastro mudou depois do `created_offline_at`). Ausente = 0.
   */
  prazo_percentual_ajuste: PercentualAjuste.optional(),
  observacao: z.string().max(500).nullable().optional(),
  visita_id: z.string().uuid().nullable().optional(),
  /**
   * T-0053 (RF-VEN-03): `orcamento` = pré-venda (não vai para aprovação nem para o ERP, RN-VEN-32). Ausente = `pedido`
   * (a fila dos APKs já instalados continua válida).
   */
  /**
   * RN-VEN-35 (pedido em nome): dono do pedido, quando o supervisor/gerente digita pelo vendedor. Ausente ou igual ao autor =
   * pedido comum. O `autor_id` NUNCA vem do aparelho: é o usuário do token. A API revalida equipe/área e a alçada do gestor.
   */
  vendedor_id: z.string().uuid().nullable().optional(),
  tipo: z.enum(TIPOS_DOCUMENTO).optional(),
  /** T-0053: pedido que nasce da conversão de um orçamento (UUID do orçamento). Só em `tipo` pedido. */
  orcamento_origem_id: z.string().uuid().nullable().optional(),
  /** T-0061 (RN-VEN-02): acréscimo do pedido; excludente com `discount_pct` > 0. */
  acrescimo_pct: Pct.min(0).max(100).optional(),
  /** T-0071 (RN-VEN-02): R$ sobre o TOTAL DOS ITENS; excludente com `discount_pct`/`acrescimo_pct` > 0 e entre si. */
  desconto_valor_cents: z.number().int().nonnegative().optional(),
  acrescimo_valor_cents: z.number().int().nonnegative().optional(),
  /** T-0071 (RN-VEN-02): o que o vendedor digitou, para Editar e Duplicar reabrirem no mesmo modo. */
  ajuste_em: z.enum(['pct', 'valor']).optional(),
  /** T-0061 (RN-VEN-16): ausente = padrão do tenant (`frete.modalidade_padrao`, CIF). */
  frete: Frete.nullable().optional(),
  /** T-0061 (RN-VEN-17): ausente = endereço principal do cliente. */
  endereco_entrega_id: z.string().uuid().nullable().optional(),
  /** T-0141 (RN-VEN-17): endereço digitado SÓ para este pedido; com ele o `endereco_entrega_id` é ignorado. Ausente/nulo = comportamento anterior. */
  endereco_entrega_editado: EnderecoEditadoPedido.nullable().optional(),
});
export type PedidoPush = z.infer<typeof PedidoPush>;

/** Códigos que o receber devolve em item rejeitado (T-0029 §4; T-0053: pré-venda). */
export const CODIGOS_RECUSA_PEDIDO = [
  'RN-PRO-01', 'PERFIL_SEM_ACESSO', 'PAYLOAD_INVALIDO', 'ID_EM_USO', 'FORA_DA_CARTEIRA', 'RN-VEN-01', 'RN-VEN-10', 'RN-VEN-13', 'RN-VEN-14', 'RN-VEN-31', 'RN-CAT-06',
  'RN-VEN-32', 'ORCAMENTO_NAO_ENCONTRADO', 'ORCAMENTO_JA_CONVERTIDO', 'PRE_VENDA_INDISPONIVEL',
  // T-0061: unidade, endereço de entrega, frete FOB e desconto/acréscimo (desenho §4.3)
  'unidade_invalida', 'endereco_invalido', 'transportadora_obrigatoria', 'transportadora_invalida', 'desconto_e_acrescimo', 'preco_abaixo_minimo',
  // T-0071: orçamento vencido/convertido/cancelado (RN-VEN-18), ajuste em % e R$ juntos ou acima do limite, edição concorrente
  'RN-VEN-18', 'ajuste_invalido', 'ORCAMENTO_ALTERADO',
  // T-0089: forma/prazo inexistente, inativo ou de outra forma (RN-VEN-24); forma não permitida ou prazo acima do prazo médio do cliente (RN-VEN-25)
  'RN-VEN-24', 'RN-VEN-25',
  // T-0168 (RN-VEN-11a): desconto efetivo do pedido acima do limite do usuário
  'desconto_pedido_acima_limite',
] as const;

/**
 * T-0071 (desenho §2.1): edição do orçamento já recebido (precisa de sinal, ação `pedido.criar`). `atualizado_em` é a
 * concorrência otimista: diferente do `updated_at` atual = 409 ORCAMENTO_ALTERADO. Vencido/convertido/cancelado = 422 RN-VEN-18.
 */
export const EditarOrcamentoRequest = PedidoPush.omit({ id: true, tipo: true, orcamento_origem_id: true, created_offline_at: true, vendedor_id: true })
  .extend({ atualizado_em: z.string() })
  .strict();
export type EditarOrcamentoRequest = z.infer<typeof EditarOrcamentoRequest>;

/** Edição: mesmo corpo da criação, sem o id (o pedido mantém id e número). */
export const UpdateOrderRequest = z.object({
  customer_id: Id,
  branch_id: Id.optional(),
  discount_pct: Pct.min(0).max(100),
  payment_terms: z.string().default('28/56 dias'),
  items: z.array(z.object({ product_id: Id, quantity: z.number().int().positive() })).min(1),
});
export type UpdateOrderRequest = z.infer<typeof UpdateOrderRequest>;
export const CancelOrderRequest = z.object({ reason: z.string().max(500).optional() });

export const OrderListQuery = z.object({
  status: z.string().optional(),
  seller_id: Id.optional(),
  customer_id: Id.optional(),
  branch_id: Id.optional(),
  team_id: Id.optional(),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  limit: z.coerce.number().int().optional(),
  /** busca por cliente ou número (T-0029 §3.3) */
  q: z.string().max(100).optional(),
  cursor: z.string().optional(),
  limite: z.coerce.number().int().min(1).max(200).optional(),
  /** T-0071 (§1.4 g): ausente = só pedidos; `orcamento` traz os orçamentos; `todos` os dois. */
  tipo: z.enum(['pedido', 'orcamento', 'todos']).optional(),
  /** só com `tipo=orcamento` */
  situacao: z.enum(SITUACOES_ORCAMENTO).optional(),
  /** T-0077 item 6: `1` = o período (`from`/`to`) traz também o que mudou de status nele (`updated_at`), além do emitido nele */
  por_status: z.enum(['0', '1']).optional(),
  /** BKO (revisão §P6): `1` = a primeira página traz também `total_filtro` (quantidade e soma do filtro inteiro). */
  totais: z.enum(['0', '1']).optional(),
  /** BKO (revisão §P6, regra 6): `1` = a lista não traz os pedidos aguardando aprovação (eles ficam no quadro de pendências). */
  sem_pendentes: z.enum(['0', '1']).optional(),
});

/** Aprovar: 1 toque, comentário opcional (RN-GES-08). Sem `motivo_aprovacao`, vale para todas as pendentes que o usuário decide (T-0184 §3, ADR 0062). */
export const AprovarPedidoRequest = z.object({ comentario: z.string().max(500).optional(), motivo_aprovacao: MotivoAprovacao.optional() });
export type AprovarPedidoRequest = z.infer<typeof AprovarPedidoRequest>;
/**
 * Rejeitar = DEVOLVER ao vendedor (`rejected`; P6 A). `motivo` é o texto livre do aprovador, de `MOTIVO_REJEICAO_MIN`+ caracteres
 * (RN-GES-08; o app Gestão v1.0.13 já manda assim); o motivo da aprovação é `motivo_aprovacao`, nunca `motivo`. O domínio revalida depois do trim.
 */
export const RejeitarPedidoRequest = z.object({ motivo: z.string().min(MOTIVO_REJEICAO_MIN).max(500), motivo_aprovacao: MotivoAprovacao.optional() });
export type RejeitarPedidoRequest = z.infer<typeof RejeitarPedidoRequest>;
/** Recusar = rejeitar de vez (`cancelled`, final; P6 A): o mesmo corpo de `rejeitar`. */
export const RecusarPedidoRequest = RejeitarPedidoRequest;
export type RecusarPedidoRequest = RejeitarPedidoRequest;

/** Decisão do aprovador → rota do Vendedor (`pedidos/:id/<rota>`): devolver usa a `rejeitar` de sempre; recusar é a rota nova. Gestor e BKO leem daqui. */
export const ROTA_DA_DECISAO = { aprovar: 'aprovar', devolver: 'rejeitar', recusar: 'recusar' } as const satisfies Record<DecisaoAprovador, string>;
/** Decisão → schema do corpo da rota. */
export const CORPO_DA_DECISAO = { aprovar: AprovarPedidoRequest, devolver: RejeitarPedidoRequest, recusar: RecusarPedidoRequest } as const;

/**
 * Monta o corpo da rota da decisão (RN-GES-08): aprovar leva o comentário opcional; devolver e recusar levam o texto em `motivo`.
 * `motivo_aprovacao` ausente = vale para todas as pendentes que o usuário decide.
 */
export function corpoDaDecisao(decisao: DecisaoAprovador, texto: string, motivoAprovacao?: MotivoAprovacao): AprovarPedidoRequest | RejeitarPedidoRequest {
  const t = texto.trim();
  const motivo = motivoAprovacao ? { motivo_aprovacao: motivoAprovacao } : {};
  return decisao === 'aprovar' ? { ...(t ? { comentario: t } : {}), ...motivo } : { motivo: t, ...motivo };
}
/** Resposta das três rotas de decisão: o status do pedido e as aprovações do ciclo atual (T-0184). */
export const DecisaoAprovacaoResposta = z.object({ status: OrderStatus, aprovacoes: z.array(AprovacaoMotivo) });
export type DecisaoAprovacaoResposta = z.infer<typeof DecisaoAprovacaoResposta>;

export const DecisionRequest = z.object({ reason: z.string().max(500).optional() });
export const RejectRequest = z.object({ reason: z.string().min(3, 'Informe o motivo da recusa.').max(500) });

export const CustomerDetail = CustomerSummary.extend({
  receivables: z.array(Receivable),
  recent_orders: z.array(Order),
  lines_bought_90d: z.array(z.string()),
});
export type CustomerDetail = z.infer<typeof CustomerDetail>;


// ---------- alçadas ----------
export const DiscountPolicy = z.object({
  seller_pct: Pct,
  supervisor_pct: Pct,
  manager_pct: Pct,
  above_manager: z.enum(['block', 'director']),
  exceptions: z.array(z.object({ seller_id: Id, seller_name: z.string(), max_discount_pct: Pct })),
  /** T-0184 (P2 B, P5 B): quem aprova crédito e inadimplência; padrão gerente; ausente = servidor anterior */
  aprovador_credito: z.enum(NIVEIS_APROVACAO).optional(),
  aprovador_inadimplencia: z.enum(NIVEIS_APROVACAO).optional(),
});
export type DiscountPolicy = z.infer<typeof DiscountPolicy>;
/** T-0184 (P2 B): quem aprova crédito e quem aprova inadimplência (Parâmetros › Pedidos). */
export const PutAprovadoresRequest = z.object({ aprovador_credito: z.enum(NIVEIS_APROVACAO), aprovador_inadimplencia: z.enum(NIVEIS_APROVACAO) });
export type PutAprovadoresRequest = z.infer<typeof PutAprovadoresRequest>;
export const PutDiscountPolicyRequest = z.object({
  seller_pct: Pct.min(0).max(100),
  supervisor_pct: Pct.min(0).max(100),
  manager_pct: Pct.min(0).max(100),
  above_manager: z.enum(['block', 'director']),
  exceptions: z.array(z.object({ seller_id: Id, max_discount_pct: Pct.min(0).max(100) })),
});



// ---------- faróis (dashboards) ----------
export const OrdersDashboard = z.object({
  generated_at: IsoDateTime,
  erp: z.object({ name: z.string(), status: z.enum(['connected', 'degraded', 'offline']), last_load_at: IsoDateTime.nullable() }),
  kpis: z.object({
    orders_count: z.number().int(),
    orders_total_cents: Cents,
    sellers_count: z.number().int(),
    pending_approval: z.number().int(),
    oldest_pending_minutes: z.number().int().nullable(),
    rejected: z.number().int(),
    rejected_by_reason: z.string(),
    queued_on_devices: z.number().int(),
    devices_offline: z.number().int(),
    integrated_without_touch_pct: z.number(),
    integrated_target_pct: z.number(),
  }),
  approvals: z.array(Order),
  orders: z.array(Order),
});
export type OrdersDashboard = z.infer<typeof OrdersDashboard>;

// ---------- sincronização (app) ----------
export const SyncPushItem = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('order'), idempotency_key: z.string(), payload: CreateOrderRequest }),
  z.object({ kind: z.literal('visit'), idempotency_key: z.string(), payload: CreateVisitRequest }),
  z.object({ kind: z.literal('checkout'), idempotency_key: z.string(), visit_id: Id, payload: CheckoutVisitRequest }),
]);
export type SyncPushItem = z.infer<typeof SyncPushItem>;
export const SyncPushRequest = z.object({ items: z.array(SyncPushItem) });
export const SyncPushResult = z.object({
  results: z.array(
    z.object({ idempotency_key: z.string(), status: z.enum(['accepted', 'rejected', 'retry']), message: z.string(), entity_id: z.string().nullable() }),
  ),
});
export type SyncPushResult = z.infer<typeof SyncPushResult>;


/** `GET /v1/vendedor/pedidos`: página com cursor `(created_at desc, id)` (T-0029 §6). */
/** Quantidade e soma (centavos, sem cancelados e rejeitados, RN-VEN-05) do filtro inteiro, não das linhas carregadas. */
export const TotalDoFiltro = z.object({ quantidade: z.number().int().nonnegative(), soma_cents: z.number().int() });
export type TotalDoFiltro = z.infer<typeof TotalDoFiltro>;
export const PedidosPage = z.object({ itens: z.array(Order), proximo_cursor: z.string().nullable(), total_filtro: TotalDoFiltro.optional() });
export type PedidosPage = z.infer<typeof PedidosPage>;
export * from './pedidos-da-meta';
export * from './extensoes';
