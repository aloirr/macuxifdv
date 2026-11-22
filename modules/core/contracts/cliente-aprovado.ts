/**
 * Cliente novo aprovado no BKO, disponível ao ERP (RF-CORE-10; RN-CORE-74 e RN-INT-24, propostas).
 *  - Evento `core.cliente.aprovado@1`: só ids e o carimbo da aprovação; o Hub busca os dados pela consulta abaixo (sem dado pessoal na outbox/log).
 *  - Consulta `core.clientes_aprovados_sem_erp@1`: aprovados sem `external_id`, com os campos canônicos do cadastro (RN-CORE-16).
 *  - Comando `core.cliente_vincular_erp@1`: grava o `external_id` devolvido pelo ERP (idempotente; outro código = conflito).
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

export const ClienteVincularErpEntradaSchema = z.object({ cliente_id: Uuid, external_id: z.string().trim().min(1).max(200) }).strict();
export const ClienteVincularErpSaidaSchema = z.object({
  resultado: z.enum(['vinculado', 'ja_vinculado', 'conflito', 'nao_encontrado', 'nao_aprovado', 'codigo_em_uso']),
  /** Preenchido em `conflito`: o código que o cliente já tem. */
  external_id_atual: z.string().nullable(),
});
export type ClienteVincularErpSaida = z.infer<typeof ClienteVincularErpSaidaSchema>;
export const CONSULTA_CLIENTE_VINCULAR_ERP = definirConsulta({
  nome: 'core.cliente_vincular_erp@1',
  entrada: ClienteVincularErpEntradaSchema,
  saida: ClienteVincularErpSaidaSchema,
});
