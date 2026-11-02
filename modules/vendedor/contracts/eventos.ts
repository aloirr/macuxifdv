/**
 * Schemas dos eventos publicados pelo Vendedor (`<modulo>.<entidade>.<fato>@vN`).
 * Registro: `.coord/contratos/eventos.md`. Mudança incompatível = nova versão + ADR.
 */
import { z } from 'zod';
import { definirEvento } from '@macuxi/platform-sdk';
import { Id, IsoDateTime } from '@macuxi/core/contracts';
import { MOTIVOS_APROVACAO, NIVEIS_APROVACAO, STATUS_CONTRATO } from '../domain/aprovacao';

/**
 * `vendedor.pedido.faturado@1` — um por retorno do ERP aceito com status faturado_parcial/faturado_total
 * (`integracao.pedido.retorno_erp@1`). `itens` = o que foi faturado NESTE retorno (o consumidor soma; unidade de
 * venda; sem valores). O consumidor (Treinamento, RN-TRE-08) é idempotente por `evento_id`; sem estorno.
 */
export const PedidoFaturadoEvento = z.object({
  pedido_id: Id,
  vendedor_id: Id,
  faturado_em: IsoDateTime,
  parcial: z.boolean(),
  itens: z.array(z.object({ produto_id: Id, quantidade: z.number().int().positive() })).min(1),
});
export type PedidoFaturadoEvento = z.infer<typeof PedidoFaturadoEvento>;

// ---------- pedido no servidor (T-0029, ADR 0011) ----------
// Status SEMPRE no vocabulário do doc 03 (RN-VEN-30), mapeado por `statusDoContrato`. Nenhum nome, documento ou
// endereço no payload: só ids e códigos do ERP.
const StatusEvento = z.enum(STATUS_CONTRATO);
const NivelEvento = z.enum(NIVEIS_APROVACAO);
const MotivoEvento = z.enum(MOTIVOS_APROVACAO);
const CentsNaoNeg = z.number().int().nonnegative();

/** `vendedor.pedido.criado@1` — pedido aceito pela 1a vez. Espelho do `PedidoCriadoV1` do Gestor + `status`. */
export const PedidoCriadoEvento = z.object({
  pedido_id: Id,
  vendedor_id: Id,
  /** RN-VEN-35: quem digitou (o gestor, no pedido em nome) */
  autor_id: Id,
  cliente_id: Id,
  visita_id: Id.nullable(),
  tipo: z.literal('pedido'),
  total_cents: CentsNaoNeg,
  total_tabela_cents: CentsNaoNeg,
  criado_em: IsoDateTime,
  itens: z.array(z.object({ produto_id: Id, quantidade: z.number().int().positive(), total_cents: CentsNaoNeg })),
  status: StatusEvento,
});
export type PedidoCriadoEvento = z.infer<typeof PedidoCriadoEvento>;

/** `vendedor.pedido.status_alterado@1` — cada transição (RN-VEN-30); `de` null na criação. */
export const PedidoStatusAlteradoEvento = z.object({
  pedido_id: Id,
  vendedor_id: Id,
  de: StatusEvento.nullable(),
  para: StatusEvento,
  alterado_em: IsoDateTime,
  autor_id: Id.nullable(),
  motivo: z.string().max(500).nullable(),
});
export type PedidoStatusAlteradoEvento = z.infer<typeof PedidoStatusAlteradoEvento>;

/** `vendedor.pedido.aprovacao_solicitada@1` — entrou em `em_aprovacao`. Espelho do `AprovacaoSolicitadaV1`. */
export const AprovacaoSolicitadaEvento = z.object({
  pedido_id: Id,
  vendedor_id: Id,
  cliente_id: Id,
  solicitada_em: IsoDateTime,
  nivel: NivelEvento,
  motivos: z.array(MotivoEvento).min(1),
  desconto_efetivo_pct: z.number().nonnegative(),
  total_cents: CentsNaoNeg,
  /** crédito e histórico fora da fatia (T-0029 §14): sempre null */
  credito: z.null(),
  historico: z.null(),
});
export type AprovacaoSolicitadaEvento = z.infer<typeof AprovacaoSolicitadaEvento>;

// T-0061 (ADR 0016, emenda 1): frete e endereço no formato do doc 06; sem valor de frete (RN-VEN-16). Aditivo no v1.
const FreteEvento = z.discriminatedUnion('modalidade', [
  z.object({ modalidade: z.literal('CIF') }),
  z.object({
    modalidade: z.literal('FOB'),
    transportadora: z.discriminatedUnion('tipo', [
      z.object({ tipo: z.literal('cadastrada'), id: Id, external_id: z.string().nullable(), nome: z.string(), cnpj: z.string().nullable(), telefone: z.string().nullable() }),
      z.object({ tipo: z.literal('digitada'), nome: z.string(), cnpj: z.string().regex(/^\d{14}$/), telefone: z.string().nullable() }),
    ]),
  }),
]);
const EnderecoEntregaEvento = z.object({
  external_id: z.string().nullable(),
  logradouro: z.string(),
  numero: z.string().nullable(),
  complemento: z.string().nullable(),
  bairro: z.string().nullable(),
  cidade: z.string(),
  uf: z.string(),
  cep: z.string().nullable(),
  /** true = o endereço principal do cadastro (o ERP já o assume; não exige Conector novo) */
  principal: z.boolean(),
});

/**
 * `vendedor.pedido.aprovado@1` — o pedido virou `aprovado` (automático dentro da alçada ou por decisão) com o
 * conteúdo para a fila do ERP (RN-INT-08; pedido do Hub R-20261101-044224-3). Chaves do ERP anuláveis: vêm do
 * `external_id` do Core e o Hub trata a ausência.
 */
export const PedidoAprovadoEvento = z.object({
  pedido_uuid: Id,
  cliente_external_id: z.string().nullable(),
  vendedor_external_id: z.string().nullable(),
  condicao_pagamento_codigo: z.string().nullable(),
  criado_em: IsoDateTime,
  aprovado_em: IsoDateTime,
  observacao: z.string().nullable(),
  itens: z
    .array(
      z.object({
        sequencia: z.number().int().min(1),
        produto_external_id: z.string().nullable(),
        quantidade: z.number().int().positive(),
        preco_unitario_cents: CentsNaoNeg,
        desconto_cents: CentsNaoNeg,
        total_cents: CentsNaoNeg,
        // T-0061 (aditivos): `quantidade` é a UNIDADE BASE; a medida vendida vem aqui
        unidade: z.string().nullable().optional(),
        fator: z.number().int().positive().optional(),
        quantidade_venda: z.number().int().positive().optional(),
        preco_tabela_cents: CentsNaoNeg.optional(),
        desconto_pct: z.number().min(0).max(100).optional(),
        acrescimo_pct: z.number().min(0).max(100).optional(),
        acrescimo_cents: CentsNaoNeg.optional(),
      }),
    )
    .min(1),
  desconto_total_cents: CentsNaoNeg,
  total_cents: CentsNaoNeg,
  desconto_pct: z.number().min(0).max(100).optional(),
  acrescimo_pct: z.number().min(0).max(100).optional(),
  acrescimo_total_cents: CentsNaoNeg.optional(),
  frete: FreteEvento.nullable().optional(),
  endereco_entrega: EnderecoEntregaEvento.nullable().optional(),
});
export type PedidoAprovadoEvento = z.infer<typeof PedidoAprovadoEvento>;

// ---------- definições (publicação na outbox: `tx.publicar(EVENTO_..., payload, agregadoId)`) ----------
export const EVENTO_PEDIDO_CRIADO = definirEvento('vendedor.pedido.criado@1', PedidoCriadoEvento);
export const EVENTO_PEDIDO_STATUS_ALTERADO = definirEvento('vendedor.pedido.status_alterado@1', PedidoStatusAlteradoEvento);
export const EVENTO_PEDIDO_APROVACAO_SOLICITADA = definirEvento('vendedor.pedido.aprovacao_solicitada@1', AprovacaoSolicitadaEvento);
export const EVENTO_PEDIDO_APROVADO = definirEvento('vendedor.pedido.aprovado@1', PedidoAprovadoEvento);
/** T-0053/T-0054: publicado pelo consumidor do retorno do ERP (`api/retorno-erp.ts`), um por nota faturada com itens (desenho T-0011). */
export const EVENTO_PEDIDO_FATURADO = definirEvento('vendedor.pedido.faturado@1', PedidoFaturadoEvento);
