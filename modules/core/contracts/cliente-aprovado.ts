/**
 * @deprecated v1.0.28 (temporário até o commit 2): substituído por `cliente-pre-cadastro.ts`; só o consumidor antigo da Integração ainda usa.
 * Cliente novo aprovado no BKO, disponível ao ERP (RF-CORE-10; RN-CORE-78 e RN-INT-22).
 *  - Evento `core.cliente.aprovado@1`: só ids e o carimbo da aprovação; o Hub busca os dados pela consulta abaixo (sem dado pessoal na outbox/log).
 *  - Consulta `core.clientes_aprovados_sem_erp@1`: aprovados sem `external_id`, com os campos canônicos do cadastro (RN-CORE-16).
 *  - O código do ERP volta pelo evento de retorno do Hub (`integracao.cliente.retorno_erp@1`), não por consulta (ADR 0012 §5).
 */
import { definirEvento, definirConsulta } from '@macuxi/platform-sdk';
import { z } from 'zod';

const Uuid = z.string().uuid();
const Texto = z.string().max(200).nullable();

export const ClienteAprovadoSchema = z.object({
  cliente_id: Uuid,
  aprovado_em: z.string().datetime(),
  aprovado_por: Uuid,
});
export type ClienteAprovadoEvento = z.infer<typeof ClienteAprovadoSchema>;
export const EVENTO_CLIENTE_APROVADO = definirEvento('core.cliente.aprovado@1', ClienteAprovadoSchema);

export const ClienteAprovadoParaErpSchema = z.object({
  cliente_id: Uuid,
  aprovado_em: z.string().datetime(),
  razao_social: z.string().min(1).max(200),
  nome_fantasia: Texto,
  documento: Texto,
  inscricao_estadual: Texto,
  telefone: Texto,
  email: Texto,
  logradouro: Texto,
  numero: Texto,
  complemento: Texto,
  bairro: Texto,
  cidade: Texto,
  uf: Texto,
  cep: Texto,
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  /** Código da filial no ERP (external_id da filial), quando houver. */
  filial_external_id: Texto,
});
export type ClienteAprovadoParaErp = z.infer<typeof ClienteAprovadoParaErpSchema>;

export const ClientesAprovadosSemErpEntradaSchema = z
  .object({ limite: z.number().int().min(1).max(500).default(100), depois_de: Uuid.nullable().default(null) })
  .strict();
export const ClientesAprovadosSemErpSaidaSchema = z.object({ clientes: z.array(ClienteAprovadoParaErpSchema).max(500), proximo: Uuid.nullable() });
export type ClientesAprovadosSemErpSaida = z.infer<typeof ClientesAprovadosSemErpSaidaSchema>;
export const CONSULTA_CLIENTES_APROVADOS_SEM_ERP = definirConsulta({
  nome: 'core.clientes_aprovados_sem_erp@1',
  entrada: ClientesAprovadosSemErpEntradaSchema,
  saida: ClientesAprovadosSemErpSaidaSchema,
});
