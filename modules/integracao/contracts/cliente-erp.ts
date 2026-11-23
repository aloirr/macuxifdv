/**
 * Cliente novo (pré-cadastro recebido, sem código) oferecido ao ERP e retorno do código (RN-INT-22, RF-CORE-10; padrão da RN-INT-08).
 *  - `GET /clientes/pendentes`: o Hub entrega os pré-cadastros sem código do ERP e marca como `enviado`.
 *  - `POST /clientes/{cliente_uuid}/retorno`: o Conector devolve o `external_id` (cliente criado no ERP) ou a rejeição. Idempotente.
 * Aditivo no v1 (RN-INT-09): Conector antigo não chama estas rotas.
 * v1.0.30 (ADR 0069, aditivo): cada cliente sai com `revisao` e `hash`; o reenvio do recusado reabre o mesmo `cliente_uuid` com a revisão
 * nova. O retorno aceita `revisao` (ausente = a atual) e, em `rejeitado_erp`, `erros` por campo.
 */
import { z } from 'zod';
import { DataHoraUtc, ExternalId, LIMITE_PEDIDOS_POLL_MAX, LIMITE_PEDIDOS_POLL_PADRAO, Uuid, VERSAO_CONTRATO } from './base';

const TextoNulo = z.string().max(200).nullable();

/** Revisão do pré-cadastro (1 na primeira; sobe a cada reenvio do cadastro corrigido). */
export const RevisaoCliente = z.number().int().positive();

/** Erro por campo da recusa do ERP (RN-INT-22): `campo` canônico do `ClienteParaErp` ou o nome que o ERP usa. */
export const ErroCampoRetornoCliente = z.object({
  campo: z.string().trim().min(1).max(60),
  codigo: z.string().trim().min(1).max(60),
  mensagem: z.string().trim().min(1).max(300),
});
export type ErroCampoRetornoCliente = z.infer<typeof ErroCampoRetornoCliente>;

/** Pré-cadastro para o ERP gravar (campos canônicos do cadastro; `cliente_uuid` é o id do Macuxi, a chave de idempotência). */
export const ClienteParaErp = z.object({
  cliente_uuid: Uuid,
  recebido_em: DataHoraUtc,
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
  /**
   * Código FDV do cliente (v1.0.30, ADR 0069 §10): número do Macuxi, só dígitos (5 ou mais, zeros à esquerda), para o ERP guardar como
   * referência. `null` nos clientes que entraram antes da v1.0.30. O código do cliente no ERP continua sendo o `external_id` do retorno.
   */
  codigo_fdv: z.string().regex(/^[0-9]{5,}$/).nullable().optional(),
  /** Revisão dos dados (v1.0.30): sobe quando o cadastro recusado é corrigido e reenviado. Devolva-a no retorno. */
  revisao: RevisaoCliente.optional(),
  /** sha256 (hex minúsculo) dos dados desta revisão; nulo nos clientes que entraram antes da v1.0.30. */
  hash: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional(),
  /** Quantas vezes o Hub entregou esta revisão do cliente (1 na primeira). */
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

/** `vinculado` exige `external_id` (código do cliente no ERP); `rejeitado_erp` exige `motivo` e aceita `erros` por campo. */
export const RetornoCliente = z
  .object({
    versao_contrato: z.literal(VERSAO_CONTRATO),
    cliente_uuid: Uuid,
    status: StatusRetornoCliente,
    external_id: ExternalId.nullish(),
    motivo: z.string().trim().min(1).max(1000).nullish(),
    /** Revisão recebida em `GET /clientes/pendentes`; ausente = a revisão atual do cliente. */
    revisao: RevisaoCliente.optional(),
    /** Só em `rejeitado_erp`: o que o ERP recusou, campo a campo (até 50). */
    erros: z.array(ErroCampoRetornoCliente).min(1).max(50).optional(),
    ocorrido_em: DataHoraUtc,
  })
  .superRefine((r, ctx) => {
    if (r.status === 'vinculado' && !r.external_id) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['external_id'], message: 'informe o código do cliente no ERP' });
    if (r.status === 'rejeitado_erp' && !r.motivo) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['motivo'], message: 'informe o motivo da rejeição' });
    if (r.status !== 'rejeitado_erp' && r.erros !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['erros'], message: 'erros só vale com status rejeitado_erp' });
  });
export type RetornoCliente = z.infer<typeof RetornoCliente>;

export const EstadoClienteFila = z.enum(['pendente', 'enviado', 'vinculado', 'rejeitado']);
export type EstadoClienteFila = z.infer<typeof EstadoClienteFila>;

export const RetornoClienteAceito = z.object({
  cliente_uuid: Uuid,
  estado: EstadoClienteFila,
  repetido: z.boolean(),
  /** Revisão atual do cliente depois do retorno. */
  revisao: RevisaoCliente,
  /** Só presente (`true`) quando a recusa era de uma revisão anterior: aceita sem gravar (a revisão nova segue valendo). */
  obsoleto: z.literal(true).optional(),
});
export type RetornoClienteAceito = z.infer<typeof RetornoClienteAceito>;
