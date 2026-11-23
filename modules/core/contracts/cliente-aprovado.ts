/**
 * Cliente novo aprovado no BKO, disponível ao ERP (RF-CORE-10; RN-CORE-78 e RN-INT-22).
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

/** Pré-cadastro (campo ou BKO): o `id` nasce no aparelho/tela e torna a escrita idempotente. Sem `complemento`: o cliente não tem a coluna. */
const TextoOpc = z.string().trim().max(200).nullish();
export const PreCadastroClienteSchema = z
  .object({
    id: Uuid,
    origem: z.enum(['campo', 'bko']),
    razao_social: z.string().trim().min(1).max(200),
    nome_fantasia: TextoOpc,
    documento: z
      .string()
      .transform((v) => v.replace(/\D/g, ''))
      .pipe(z.string().regex(/^(\d{11}|\d{14})$/, 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).'))
      .nullish(),
    inscricao_estadual: TextoOpc,
    telefone: TextoOpc,
    email: TextoOpc,
    logradouro: TextoOpc,
    numero: TextoOpc,
    bairro: TextoOpc,
    cidade: TextoOpc,
    uf: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Informe a UF com 2 letras.').nullish(),
    cep: TextoOpc,
    latitude: z.number().min(-90).max(90).nullish(),
    longitude: z.number().min(-180).max(180).nullish(),
    filial_id: Uuid.nullish(),
  })
  .strict();
export type PreCadastroCliente = z.infer<typeof PreCadastroClienteSchema>;
export const PreCadastroClienteSaidaSchema = z.object({ id: Uuid, status_cadastro: z.enum(['pendente', 'aprovado', 'recusado']), ja_existia: z.boolean() });

export const DecidirCadastroClienteSchema = z.object({ decisao: z.enum(['aprovar', 'recusar']) }).strict();
export type DecidirCadastroCliente = z.infer<typeof DecidirCadastroClienteSchema>;
export const DecidirCadastroClienteSaidaSchema = z.object({ id: Uuid, status_cadastro: z.enum(['aprovado', 'recusado']) });
