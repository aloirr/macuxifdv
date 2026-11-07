/**
 * Devolução de pedido ao ERP e retorno do ERP (RF-INT-02/04, RN-INT-08).
 * Hub → Conector: `GET /integracao/v1/pedidos/pendentes` (só pedidos `aprovado`).
 * Conector → Hub: `POST /integracao/v1/pedidos/{pedido_uuid}/retorno`.
 */
import { z } from 'zod';
import { CentavosNaoNegativos, DataHoraUtc, ExternalId, Quantidade, Texto, TextoOpcional, Uuid, VERSAO_CONTRATO } from './base';

export const ESTADOS_PEDIDO_ERP = ['pendente', 'enviado', 'integrado', 'rejeitado_erp', 'faturado_parcial', 'faturado_total', 'cancelado'] as const;
export const EstadoPedidoErp = z.enum(ESTADOS_PEDIDO_ERP);
export type EstadoPedidoErp = z.infer<typeof EstadoPedidoErp>;

const PercentualOpcional = z.number().min(0).max(100).nullish();

export const ItemPedidoErp = z.object({
  sequencia: z.number().int().positive(),
  produto_external_id: ExternalId,
  /** SEMPRE na unidade base (ADR 0016): `quantidade = quantidade_venda x fator` quando a venda é por embalagem. */
  quantidade: Quantidade.refine((q) => q > 0, 'quantidade deve ser maior que zero'),
  preco_unitario_cents: CentavosNaoNegativos,
  desconto_cents: CentavosNaoNegativos.default(0),
  total_cents: CentavosNaoNegativos,
  // ---- ADR 0016 (opcionais; o Conector 1.2.x ignora): medida de venda, desconto/acréscimo
  /** Sigla da medida vendida (RN-CORE-19), ex.: CX. */
  unidade: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,6}$/).nullish(),
  /** Unidades base de uma unidade vendida (1 na medida da unidade). */
  fator: z.number().int().positive().nullish(),
  /** Quantidade na medida vendida. */
  quantidade_venda: Quantidade.refine((q) => q > 0, 'quantidade deve ser maior que zero').nullish(),
  preco_tabela_cents: CentavosNaoNegativos.nullish(),
  preco_unitario_venda_cents: CentavosNaoNegativos.nullish(),
  desconto_pct: PercentualOpcional,
  acrescimo_pct: PercentualOpcional,
  acrescimo_cents: CentavosNaoNegativos.nullish(),
  /** T-0084 (RN-VEN-19; aditivo na v1): retrato da aplicação do produto no pedido (vendedor.pedido_item.aplicacao); nulo/ausente = sem aplicação. O Conector que não o mapeia ignora. */
  aplicacao: TextoOpcional(1000),
});
export type ItemPedidoErp = z.infer<typeof ItemPedidoErp>;

/** Transportadora do frete FOB (ADR 0016, emenda 1; formato do doc 06). Cadastrada leva o retrato do aceite; digitada exige nome e CNPJ. */
export const TransportadoraPedido = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.literal('cadastrada'),
    id: Uuid,
    external_id: z.string().nullish(),
    nome: Texto(120),
    cnpj: z.string().trim().regex(/^\d{14}$/, 'CNPJ deve ter 14 dígitos').nullish(),
    telefone: TextoOpcional(30),
  }),
  z.object({
    tipo: z.literal('digitada'),
    nome: Texto(120),
    cnpj: z.string().trim().regex(/^\d{14}$/, 'CNPJ deve ter 14 dígitos'),
    telefone: TextoOpcional(30),
  }),
]);
export type TransportadoraPedido = z.infer<typeof TransportadoraPedido>;

/** CIF = a empresa paga (sem transportadora); FOB = o cliente paga, transportadora obrigatória. Sem valor de frete (RN-VEN-16). */
export const FreteErp = z.discriminatedUnion('modalidade', [
  z.object({ modalidade: z.literal('CIF') }),
  z.object({ modalidade: z.literal('FOB'), transportadora: TransportadoraPedido }),
]);
export type FreteErp = z.infer<typeof FreteErp>;

export const EnderecoEntregaErp = z.object({
  external_id: z.string().nullish(),
  logradouro: Texto(160),
  numero: TextoOpcional(20),
  complemento: TextoOpcional(80),
  bairro: TextoOpcional(80),
  cidade: Texto(80),
  uf: z.string().trim().length(2).toUpperCase(),
  cep: TextoOpcional(9),
  /** O endereço principal do cadastro do cliente; o ERP já o assume, então não exige Conector novo. */
  principal: z.boolean().nullish(),
});
export type EnderecoEntregaErp = z.infer<typeof EnderecoEntregaErp>;

/**
 * T-0089 (RN-VEN-24, aditivo no v1): forma, prazo e prazo médio do pedido novo. Ausente/nulo nos pedidos antigos (o Conector 1.2.x ignora).
 * Os `*_external_id` são as chaves do ERP das linhas do próprio Vendedor (podem faltar quando a forma/prazo não veio do ERP).
 */
export const PagamentoErp = z.object({
  forma_codigo: Texto(20),
  forma_external_id: ExternalId.nullish(),
  prazo_codigo: Texto(20),
  prazo_external_id: ExternalId.nullish(),
  parcelas_dias: z.array(z.number().int().min(0).max(365)).min(1).max(24),
  prazo_medio_dias: z.number().int().min(0).max(365),
});
export type PagamentoErp = z.infer<typeof PagamentoErp>;

/** Campos opcionais do pedido (ADR 0016), comuns ao que o Vendedor publica e ao que o Conector recebe. */
const CamposPedidoAmpliado = {
  desconto_pct: PercentualOpcional,
  acrescimo_pct: PercentualOpcional,
  acrescimo_total_cents: CentavosNaoNegativos.nullish(),
  frete: FreteErp.nullish(),
  endereco_entrega: EnderecoEntregaErp.nullish(),
  pagamento: PagamentoErp.nullish(),
};

/** Pedido aprovado entregue ao Conector; idempotente pelo `pedido_uuid` (RN-INT-08). */
export const PedidoParaErp = z.object({
  versao_contrato: z.literal(VERSAO_CONTRATO),
  pedido_uuid: Uuid,
  cliente_external_id: ExternalId,
  vendedor_external_id: ExternalId,
  /** Código da condição no ERP, já traduzido pelo mapeamento de-para. */
  condicao_pagamento_erp: TextoOpcional(60),
  criado_em: DataHoraUtc,
  aprovado_em: DataHoraUtc,
  observacao: TextoOpcional(500),
  itens: z.array(ItemPedidoErp).min(1, 'pedido sem itens'),
  desconto_total_cents: CentavosNaoNegativos.default(0),
  total_cents: CentavosNaoNegativos,
  /** Quantas vezes já foi entregue ao Conector (reenvio por timeout). */
  tentativa: z.number().int().positive().default(1),
  ...CamposPedidoAmpliado,
});
export type PedidoParaErp = z.infer<typeof PedidoParaErp>;

export const PedidosPendentes = z.object({
  pedidos: z.array(PedidoParaErp),
});
export type PedidosPendentes = z.infer<typeof PedidosPendentes>;

/** Estados que o ERP pode informar (`pendente` e `enviado` são do Hub). `cancelado` vem só do ERP; o Macuxi nunca escreve cancelamento no ERP (RN-INT-08). `motivo` é opcional nele. */
export const StatusRetornoErp = z.enum(['integrado', 'rejeitado_erp', 'faturado_parcial', 'faturado_total', 'cancelado']);
export type StatusRetornoErp = z.infer<typeof StatusRetornoErp>;

/**
 * Item faturado NESTA nota (RN-INT-08; pedido do engenheiro na T-0009/T-0011). A `sequencia` é a do `PedidoParaErp.itens`:
 * o Hub resolve o `produto_id` interno por ela (o Conector só conhece o `external_id` do produto no ERP). O que foi faturado
 * antes não se repete: o consumidor soma os retornos. `valor_cents` é o valor faturado do item (centavos inteiros).
 * `produto_external_id` e `valor_cents` são OBRIGATÓRIOS (decisão do Alexandre, T-0023): o item leva produto e valor em centavos.
 */
export const ItemFaturado = z.object({
  sequencia: z.number().int().positive(),
  /**
   * Obrigatório. É o "produto_id" da decisão do Alexandre, na chave do ERP (`external_id` do produto): o Hub resolve o
   * `produto_id` interno pela `sequencia` do pedido enviado e confere pelo `external_id`.
   */
  produto_external_id: ExternalId,
  quantidade: z.number().int('quantidade faturada deve ser inteira').positive('quantidade faturada deve ser maior que zero'),
  /** Obrigatório: valor faturado do item nesta nota, em centavos inteiros. */
  valor_cents: CentavosNaoNegativos,
});
export type ItemFaturado = z.infer<typeof ItemFaturado>;

export const NotaRetorno = z.object({
  numero: Texto(40),
  serie: TextoOpcional(10),
  emitida_em: DataHoraUtc,
  total_cents: CentavosNaoNegativos,
});
export type NotaRetorno = z.infer<typeof NotaRetorno>;

const RetornoErpBase = z.object({
  versao_contrato: z.literal(VERSAO_CONTRATO),
  pedido_uuid: Uuid,
  status: StatusRetornoErp,
  numero_erp: TextoOpcional(40),
  motivo: TextoOpcional(300),
  nota: NotaRetorno.nullish(),
  /** Itens faturados nesta nota; só em `faturado_parcial`/`faturado_total`. Campo novo opcional: continua `v1` (RN-INT-09). */
  itens_faturados: z.array(ItemFaturado).min(1, 'itens_faturados não pode ser uma lista vazia').nullish(),
  ocorrido_em: DataHoraUtc,
});

export const RetornoErp = RetornoErpBase.superRefine((r, ctx) => {
  const falta = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if ((r.status === 'integrado' || r.status === 'faturado_parcial' || r.status === 'faturado_total') && !r.numero_erp) {
    falta('numero_erp', 'informe o número do pedido no ERP');
  }
  if (r.status === 'rejeitado_erp' && !r.motivo) falta('motivo', 'informe o motivo da rejeição');
  if ((r.status === 'faturado_parcial' || r.status === 'faturado_total') && !r.nota) falta('nota', 'informe a nota fiscal do faturamento');
  if (r.itens_faturados && r.status !== 'faturado_parcial' && r.status !== 'faturado_total') {
    falta('itens_faturados', 'itens_faturados só vale em retorno faturado_parcial ou faturado_total');
  }
});
export type RetornoErp = z.infer<typeof RetornoErp>;

/**
 * P-4 (T-0031): item de `itens_faturados` que não bate com o pedido enviado (sequência inexistente, produto divergente, acima
 * do saldo ou sequência repetida no próprio retorno: nesse caso TODAS as linhas da sequência são descartadas — decisão do gerente). O retorno é aceito sem ele e o Hub registra o erro no monitor.
 */
export const CODIGOS_ITEM_DESCARTADO = ['sequencia_inexistente', 'produto_divergente', 'quantidade_acima_do_saldo', 'sequencia_repetida'] as const;
export const ItemFaturadoDescartado = z.object({
  indice: z.number().int().nonnegative(),
  sequencia: z.number().int().positive(),
  produto_external_id: ExternalId,
  quantidade: z.number().int().positive(),
  codigo: z.enum(CODIGOS_ITEM_DESCARTADO),
  codigos: z.array(z.enum(CODIGOS_ITEM_DESCARTADO)).min(1),
  campo: z.string().min(1),
  motivo: z.string().min(1),
});
export type ItemFaturadoDescartado = z.infer<typeof ItemFaturadoDescartado>;

/** Resposta do Hub ao retorno (idempotente: repetir o mesmo retorno não é erro). */
export const RetornoAceito = z.object({
  pedido_uuid: Uuid,
  status: EstadoPedidoErp,
  repetido: z.boolean(),
  /**
   * P-4 (T-0031): itens faturados que ficaram de fora deste retorno (o status valeu). Campo novo opcional (RN-INT-09): o
   * Conector 1.2.0 ignora; versões futuras podem registrar no log local. Ausente ou vazio = todos os itens valeram.
   */
  itens_descartados: z.array(ItemFaturadoDescartado).optional(),
});
export type RetornoAceito = z.infer<typeof RetornoAceito>;

/**
 * Pedido aprovado como o Hub o recebe do Vendedor para entrar na fila de exportação (RN-INT-08, T-0025). É o `PedidoParaErp`
 * antes do de-para: traz o código da condição de pagamento do Macuxi (`condicao_pagamento_codigo`), que o Hub traduz pelo
 * mapeamento (`tipo: condicao_pagamento`) em `condicao_pagamento_erp`. O Vendedor preenche os `*_external_id` (chaves do ERP)
 * porque o Hub não conhece os ids internos do Core. O evento que carrega este payload é pedido ao `modulo-vendedor`.
 */
export const PedidoAprovadoParaFila = z.object({
  pedido_uuid: Uuid,
  cliente_external_id: ExternalId,
  vendedor_external_id: ExternalId,
  condicao_pagamento_codigo: TextoOpcional(60),
  criado_em: DataHoraUtc,
  aprovado_em: DataHoraUtc,
  observacao: TextoOpcional(500),
  itens: z.array(ItemPedidoErp).min(1, 'pedido sem itens'),
  desconto_total_cents: CentavosNaoNegativos.default(0),
  total_cents: CentavosNaoNegativos,
  ...CamposPedidoAmpliado,
});
export type PedidoAprovadoParaFila = z.infer<typeof PedidoAprovadoParaFila>;
