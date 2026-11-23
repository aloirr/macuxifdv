/**
 * Cliente novo (pré-cadastro aprovado no BKO) oferecido ao ERP e retorno do código (RN-INT-22, RF-CORE-10; padrão da RN-INT-08).
 *  - `GET /clientes/pendentes`: o Hub entrega os aprovados sem código do ERP e marca como `enviado`.
 *  - `POST /clientes/{cliente_uuid}/retorno`: o Conector devolve o `external_id` (cliente criado no ERP) ou a rejeição. Idempotente.
 * Aditivo no v1 (RN-INT-09): Conector antigo não chama estas rotas.
 */
import { z } from 'zod';
import { DataHoraUtc, ExternalId, LIMITE_PEDIDOS_POLL_MAX, LIMITE_PEDIDOS_POLL_PADRAO, Uuid, VERSAO_CONTRATO } from './base';

const TextoNulo = z.string().max(200).nullable();

/** Cliente aprovado para o ERP gravar (campos canônicos do cadastro; `cliente_uuid` é o id do Macuxi, a chave de idempotência). */
export const ClienteParaErp = z.object({
  cliente_uuid: Uuid,
  aprovado_em: DataHoraUtc,
  razao_social: z.string().min(1).max(200),
  nome_fantasia: TextoNulo,
  documento: TextoNulo,
  inscricao_estadual: TextoNulo,
  telefone: TextoNulo,
  email: TextoNulo,
  logradouro: TextoNulo,
  numero: TextoNulo,
  complemento: TextoNulo,
  bairro: TextoNulo,
  cidade: TextoNulo,
  uf: TextoNulo,
  cep: TextoNulo,
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  /** Código da filial no ERP, quando houver. */
  filial_external_id: TextoNulo,
  /** Quantas vezes o Hub entregou este cliente (1 na primeira). */
  tentativa: z.number().int().positive().optional(),
});
export type ClienteParaErp = z.infer<typeof ClienteParaErp>;

export const QueryClientesPendentes = z.object({
  limite: z.coerce.number().int().min(1).max(LIMITE_PEDIDOS_POLL_MAX).default(LIMITE_PEDIDOS_POLL_PADRAO),
});
export type QueryClientesPendentes = z.infer<typeof QueryClientesPendentes>;

export const ClientesPendentes = z.object({ clientes: z.array(ClienteParaErp) });
export type ClientesPendentes = z.infer<typeof ClientesPendentes>;

export const ParamsCliente = z.object({ cliente_uuid: Uuid });

export const StatusRetornoCliente = z.enum(['vinculado', 'rejeitado_erp']);
export type StatusRetornoCliente = z.infer<typeof StatusRetornoCliente>;

/** `vinculado` exige `external_id` (código do cliente no ERP); `rejeitado_erp` exige `motivo`. */
export const RetornoCliente = z
  .object({
    versao_contrato: z.literal(VERSAO_CONTRATO),
    cliente_uuid: Uuid,
    status: StatusRetornoCliente,
    external_id: ExternalId.nullish(),
    motivo: z.string().trim().min(1).max(1000).nullish(),
    ocorrido_em: DataHoraUtc,
  })
  .superRefine((r, ctx) => {
    if (r.status === 'vinculado' && !r.external_id) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['external_id'], message: 'informe o código do cliente no ERP' });
    if (r.status === 'rejeitado_erp' && !r.motivo) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['motivo'], message: 'informe o motivo da rejeição' });
  });
export type RetornoCliente = z.infer<typeof RetornoCliente>;

export const EstadoClienteFila = z.enum(['pendente', 'enviado', 'vinculado', 'rejeitado']);
export type EstadoClienteFila = z.infer<typeof EstadoClienteFila>;

export const RetornoClienteAceito = z.object({ cliente_uuid: Uuid, estado: EstadoClienteFila, repetido: z.boolean() });
export type RetornoClienteAceito = z.infer<typeof RetornoClienteAceito>;
