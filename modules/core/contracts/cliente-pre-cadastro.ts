/**
 * Pré-cadastro de cliente (v1.0.28; RF-CORE-10; RN-CORE-78, RN-CORE-79 e RN-INT-22). O FDV só faz o pré-cadastro; quem aprova é o ERP.
 *  - Evento `core.cliente.pre_cadastrado@1`: só ids e o carimbo do recebimento; o Hub busca os dados pela consulta abaixo (sem dado pessoal na outbox/log).
 *  - Consulta `core.clientes_pre_cadastro_sem_erp@1`: pendentes sem `external_id`, com os campos canônicos do cadastro (RN-CORE-16).
 *  - Parâmetro `cliente.pre_cadastro.obrigatorios`: quais campos configuráveis a empresa exige (RN-CORE-79). Razão social e documento são sempre obrigatórios.
 *  - O código do ERP volta pelo evento de retorno do Hub (`integracao.cliente.retorno_erp@1`), não por consulta (ADR 0012 §5).
 */
import { definirEvento, definirConsulta } from '@macuxi/platform-sdk';
import { z } from 'zod';

const Uuid = z.string().uuid();
const Texto = z.string().max(200).nullable();

/** Campos sempre obrigatórios (travados; mínimo para o ERP identificar o cliente). */
export const CAMPOS_PRE_CADASTRO_SEMPRE = ['razao_social', 'documento'] as const;
/** Campos que a empresa pode marcar como obrigatórios (chaves do parâmetro). Padrão: nenhum. */
export const CAMPOS_PRE_CADASTRO_CONFIGURAVEIS = ['nome_fantasia', 'inscricao_estadual', 'telefone', 'email', 'endereco'] as const;
export type CampoPreCadastroSempre = (typeof CAMPOS_PRE_CADASTRO_SEMPRE)[number];
export type CampoPreCadastroConfiguravel = (typeof CAMPOS_PRE_CADASTRO_CONFIGURAVEIS)[number];
export type CampoPreCadastro = CampoPreCadastroSempre | CampoPreCadastroConfiguravel;

/** Rótulos em português para telas e mensagens (única fonte: app, BKO e API). */
export const ROTULOS_CAMPOS_PRE_CADASTRO: Record<CampoPreCadastro, string> = {
  razao_social: 'Razão social',
  documento: 'CPF/CNPJ',
  nome_fantasia: 'Nome fantasia',
  inscricao_estadual: 'Inscrição estadual',
  telefone: 'Telefone',
  email: 'E-mail',
  endereco: 'Endereço',
};

/** Colunas do pré-cadastro que formam o campo `endereco` (vale o grupo todo: logradouro, número, bairro, cidade, UF e CEP). */
export const COLUNAS_ENDERECO_PRE_CADASTRO = ['logradouro', 'numero', 'bairro', 'cidade', 'uf', 'cep'] as const;

/** Colunas do pré-cadastro que cada campo cobre (`endereco` é o grupo; os demais são a própria coluna). */
export const COLUNAS_DO_CAMPO_PRE_CADASTRO: Record<CampoPreCadastro, readonly string[]> = {
  razao_social: ['razao_social'],
  documento: ['documento'],
  nome_fantasia: ['nome_fantasia'],
  inscricao_estadual: ['inscricao_estadual'],
  telefone: ['telefone'],
  email: ['email'],
  endereco: COLUNAS_ENDERECO_PRE_CADASTRO,
};

/** Chave em `plataforma.parametro` (modulo `core`); valor = array de campos configuráveis, sem repetição. */
export const PARAMETRO_PRE_CADASTRO_OBRIGATORIOS = 'cliente.pre_cadastro.obrigatorios';

export const CampoPreCadastroConfiguravelSchema = z.enum(CAMPOS_PRE_CADASTRO_CONFIGURAVEIS);
export const ObrigatoriosPreCadastroSchema = z
  .array(CampoPreCadastroConfiguravelSchema)
  .max(CAMPOS_PRE_CADASTRO_CONFIGURAVEIS.length)
  .refine((v) => new Set(v).size === v.length, 'Campo repetido na lista de obrigatórios.');

/**
 * Obrigatórios efetivos a partir das linhas da entidade de sync `parametro` (`motor.linhas('parametro')`): sem linha viva do módulo
 * `core`, ou valor inválido, vale o padrão (nenhum configurável). Mesmo molde de `paradoMinDasLinhas`.
 */
export function obrigatoriosPreCadastroDasLinhas(
  linhas: readonly { modulo: string; chave: string; valor?: unknown; deleted_at?: string | null }[],
): CampoPreCadastroConfiguravel[] {
  const l = linhas.find((x) => x.modulo === 'core' && x.chave === PARAMETRO_PRE_CADASTRO_OBRIGATORIOS && !x.deleted_at);
  const r = ObrigatoriosPreCadastroSchema.safeParse(l?.valor);
  return r.success ? r.data : [];
}

/** `GET|PUT /v1/core/parametros/pre-cadastro` (ação `parametro.pre_cadastro`). */
export const ParametroPreCadastroPutSchema = z.object({ obrigatorios: ObrigatoriosPreCadastroSchema }).strict();
export type ParametroPreCadastroPut = z.infer<typeof ParametroPreCadastroPutSchema>;
export const ParametroPreCadastroSchema = z.object({ obrigatorios: ObrigatoriosPreCadastroSchema }).strict();
export type ParametroPreCadastro = z.infer<typeof ParametroPreCadastroSchema>;
/** 422 do pré-cadastro: só as chaves dos campos faltantes, nunca valores. */
export const ErroCamposObrigatoriosPreCadastroSchema = z.object({ codigo: z.literal('CAMPOS_OBRIGATORIOS'), campos: z.array(z.string()).min(1) });

export const ClientePreCadastradoSchema = z.object({
  cliente_id: Uuid,
  recebido_em: z.string().datetime(),
});
export type ClientePreCadastradoEvento = z.infer<typeof ClientePreCadastradoSchema>;
export const EVENTO_CLIENTE_PRE_CADASTRADO = definirEvento('core.cliente.pre_cadastrado@1', ClientePreCadastradoSchema);

export const ClientePreCadastroParaErpSchema = z.object({
  cliente_id: Uuid,
  recebido_em: z.string().datetime(),
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
export type ClientePreCadastroParaErp = z.infer<typeof ClientePreCadastroParaErpSchema>;

export const ClientesPreCadastroSemErpEntradaSchema = z
  .object({ limite: z.number().int().min(1).max(500).default(100), depois_de: Uuid.nullable().default(null) })
  .strict();
export const ClientesPreCadastroSemErpSaidaSchema = z.object({ clientes: z.array(ClientePreCadastroParaErpSchema).max(500), proximo: Uuid.nullable() });
export type ClientesPreCadastroSemErpSaida = z.infer<typeof ClientesPreCadastroSemErpSaidaSchema>;
export const CONSULTA_CLIENTES_PRE_CADASTRO_SEM_ERP = definirConsulta({
  nome: 'core.clientes_pre_cadastro_sem_erp@1',
  entrada: ClientesPreCadastroSemErpEntradaSchema,
  saida: ClientesPreCadastroSemErpSaidaSchema,
});

/** Pré-cadastro (campo ou BKO): o `id` nasce no aparelho/tela e torna a escrita idempotente. Sem `complemento`: o cliente não tem a coluna. */
const TextoOpc = z.string().trim().max(200).nullish();
export const PreCadastroClienteSchema = z
  .object({
    id: Uuid,
    origem: z.enum(['campo', 'bko']),
    razao_social: z.string().trim().min(1).max(200),
    nome_fantasia: TextoOpc,
    /** Sempre obrigatório (RN-CORE-79). */
    documento: z
      .string({ required_error: 'Informe o CPF ou CNPJ.' })
      .transform((v) => v.replace(/\D/g, ''))
      .pipe(z.string().regex(/^(\d{11}|\d{14})$/, 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).')),
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
