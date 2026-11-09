/**
 * Frete, transportadora, item do push e endereço de entrega (T-0061; desenho §4.3, rev. 2). O frete NÃO tem valor
 * (RN-VEN-16): CIF = a empresa paga, FOB = o cliente paga (transportadora obrigatória, cadastrada OU digitada).
 * Só Zod aqui; as regras (CNPJ com dígito verificador, XOR) ficam no domain (`validarFrete`) e a API revalida.
 */
import { z } from 'zod';
import { Id, Pct } from '@macuxi/core/contracts';
import { UFS_BRASIL } from '@macuxi/comum/endereco';

export const TransportadoraDigitada = z
  .object({
    nome: z.string().trim().min(2).max(120),
    /** 14 dígitos; o dígito verificador é conferido no domain (`@macuxi/comum`). */
    cnpj: z.string().regex(/^\d{14}$/),
    telefone: z.string().trim().max(30).nullable().optional(),
  })
  .strict();
export type TransportadoraDigitada = z.infer<typeof TransportadoraDigitada>;

export const Frete = z.discriminatedUnion('modalidade', [
  z.object({ modalidade: z.literal('CIF') }).strict(),
  z
    .object({
      modalidade: z.literal('FOB'),
      /** da lista (vendedor.transportadora) */
      transportadora_id: Id.nullable().optional(),
      transportadora_digitada: TransportadoraDigitada.nullable().optional(),
    })
    .strict(),
]);
export type Frete = z.infer<typeof Frete>;

/** Item do push (T-0061): `unidade` ausente = unidade padrão do produto (APK antigo = base). O `fator` vem do Core, nunca do aparelho. */
export const ItemPush = z.object({
  product_id: Id,
  quantity: z.number().int().positive(),
  unidade: z.string().regex(/^[A-Z0-9]{1,6}$/).optional(),
  desconto_pct: Pct.min(0).max(100).optional(),
  acrescimo_pct: Pct.min(0).max(100).optional(),
  /** T-0071 (RN-VEN-02): R$ por unidade da MEDIDA VENDIDA (1 FD, 1 CX, 1 UN). No máximo UM dos quatro > 0 (senão `ajuste_invalido`). */
  desconto_unitario_cents: z.number().int().nonnegative().optional(),
  acrescimo_unitario_cents: z.number().int().nonnegative().optional(),
  /** T-0071: o que o vendedor digitou no item (Editar e Duplicar reabrem no mesmo modo). O servidor deriva o modo do campo preenchido; ausente = legado em %. */
  ajuste_em: z.enum(['pct', 'valor']).optional(),
  /** T-0084 (RN-VEN-19): retrato da aplicação do produto, tirado no aparelho (até 1.000); ausente (APK antigo) ou nulo = sem aplicação. A API corta de novo e nunca troca pelo cadastro. */
  aplicacao: z.string().max(1000).nullable().optional(),
});
export type ItemPush = z.infer<typeof ItemPush>;

/** Retrato do endereço de entrega no aceite (RN-VEN-17); vem de `core.cliente_endereco`. */
export const EnderecoRetrato = z.object({
  id: z.string().uuid().nullable().optional(),
  external_id: z.string().nullable().optional(),
  tipo: z.string().optional(),
  descricao: z.string().nullable().optional(),
  logradouro: z.string(),
  numero: z.string().nullable().optional(),
  complemento: z.string().nullable().optional(),
  bairro: z.string().nullable().optional(),
  cidade: z.string(),
  uf: z.string(),
  cep: z.string().nullable().optional(),
  principal: z.boolean().optional(),
});
export type EnderecoRetrato = z.infer<typeof EnderecoRetrato>;

/** RN-VEN-17 (T-0141): limites do endereço DIGITADO no pedido = limites da NF-e (tag entrega) e cabem no EnderecoEntregaErp do Hub. */
export const LIMITES_ENDERECO_PEDIDO = { logradouro: 60, numero: 20, complemento: 60, bairro: 60, cidade: 60 } as const;
export const ORIGENS_ENDERECO_PEDIDO = ['erp', 'editado'] as const;
export type OrigemEnderecoPedido = (typeof ORIGENS_ENDERECO_PEDIDO)[number];

/** Endereço que o vendedor digitou SÓ para este pedido (RN-VEN-17). Não muda o cadastro do cliente. */
export const EnderecoEditadoPedido = z
  .object({
    logradouro: z.string().trim().min(2).max(LIMITES_ENDERECO_PEDIDO.logradouro),
    /** aceita "S/N" */
    numero: z.string().trim().min(1).max(LIMITES_ENDERECO_PEDIDO.numero),
    complemento: z.string().trim().max(LIMITES_ENDERECO_PEDIDO.complemento).nullable().optional(),
    bairro: z.string().trim().min(2).max(LIMITES_ENDERECO_PEDIDO.bairro),
    cidade: z.string().trim().min(2).max(LIMITES_ENDERECO_PEDIDO.cidade),
    uf: z.enum(UFS_BRASIL),
    /** só dígitos; a máscara 00000-000 é da tela */
    cep: z.string().regex(/^\d{8}$/),
  })
  .strict();
export type EnderecoEditadoPedido = z.infer<typeof EnderecoEditadoPedido>;

/** Retrato gravado em vendedor.pedido.endereco_entrega (jsonb): o EnderecoRetrato + a origem (ausente = 'erp', linhas anteriores à T-0141). */
export const EnderecoEntregaPedido = EnderecoRetrato.extend({
  origem: z.enum(ORIGENS_ENDERECO_PEDIDO).optional(),
});
export type EnderecoEntregaPedido = z.infer<typeof EnderecoEntregaPedido>;

/** Frete no detalhe (BKO, PDFs e telas): modalidade e transportadora do retrato do pedido. */
export const FreteDoPedido = z.object({
  modality: z.enum(['CIF', 'FOB']),
  carrier_name: z.string().nullable(),
  carrier_document: z.string().nullable(),
  carrier_phone: z.string().nullable(),
  /** true = digitada pelo vendedor (não está na lista do BKO) */
  carrier_typed: z.boolean(),
});
export type FreteDoPedido = z.infer<typeof FreteDoPedido>;

// ---------- cadastro de transportadoras (BKO, RN-VEN-16) ----------
export const Transportadora = z.object({
  id: Id,
  nome: z.string(),
  /** 14 dígitos */
  documento: z.string().nullable(),
  inscricao_estadual: z.string().nullable(),
  telefone: z.string().nullable(),
  ativo: z.boolean(),
  /** vem do ERP (fila de corte): quando preenchido a linha é só leitura no BKO */
  external_id: z.string().nullable().optional(),
  updated_at: z.string(),
});
export type Transportadora = z.infer<typeof Transportadora>;

export const CriarTransportadoraRequest = z
  .object({
    nome: z.string().trim().min(2).max(120),
    documento: z.string().regex(/^\d{14}$/),
    inscricao_estadual: z.string().trim().max(20).nullable().optional(),
    telefone: z.string().trim().max(30).nullable().optional(),
  })
  .strict();
export type CriarTransportadoraRequest = z.infer<typeof CriarTransportadoraRequest>;

export const AtualizarTransportadoraRequest = z
  .object({
    nome: z.string().trim().min(2).max(120).optional(),
    documento: z.string().regex(/^\d{14}$/).optional(),
    inscricao_estadual: z.string().trim().max(20).nullable().optional(),
    telefone: z.string().trim().max(30).nullable().optional(),
    ativo: z.boolean().optional(),
  })
  .strict();
export type AtualizarTransportadoraRequest = z.infer<typeof AtualizarTransportadoraRequest>;

export const TransportadorasQuery = z.object({ q: z.string().max(100).optional(), ativas: z.enum(['0', '1']).optional() });

export const TransportadoraSyncSchema = z
  .object({
    id: z.string().uuid(),
    updated_at: z.string(),
    deleted_at: z.string().nullable(),
    external_id: z.string().nullable(),
    nome: z.string(),
    documento: z.string().nullable(),
    inscricao_estadual: z.string().nullable(),
    telefone: z.string().nullable(),
    ativo: z.boolean(),
  })
  .strict();
export type TransportadoraSync = z.infer<typeof TransportadoraSyncSchema>;

/** Parâmetros do frete (BKO, Parâmetros → Frete): padrão do tenant (RN-VEN-16). */
export const FreteParametros = z.object({ modalidade_padrao: z.enum(['CIF', 'FOB']) }).strict();
export type FreteParametros = z.infer<typeof FreteParametros>;
export const PARAMETRO_FRETE_PADRAO = 'frete.modalidade_padrao';
