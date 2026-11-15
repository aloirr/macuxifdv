/**
 * Filial (RN-CORE-39; RF-CORE-16; T-0149; ADR 0040): a unidade de onde saem as entregas. Toda empresa nasce com uma filial padrão;
 * cada cliente tem uma filial (sem informação, a padrão). Rotas BKO `/v1/core/filiais` e `PUT /v1/core/clientes/:id/filial`;
 * consulta pública `core.filiais@1` (API e aparelho); entidade de sync `filial` (sync.ts). Tudo aditivo (mesmas versões).
 * Os textos de entrada são tolerantes de propósito: quem valida (e devolve a mensagem em português) é o domínio, na API.
 */
import { definirConsulta } from '@macuxi/platform-sdk';
import { z } from 'zod';

/** Códigos de erro 422 da filial (a API devolve `ErroRegraNegocio`). */
export const ERROS_FILIAL = {
  invalida: 'FILIAL_INVALIDA',
  duplicada: 'FILIAL_DUPLICADA',
  padrao: 'FILIAL_PADRAO',
  emUso: 'FILIAL_EM_USO',
  doErp: 'RN-CORE-39',
  naoEncontrada: 'FILIAL_NAO_ENCONTRADA',
} as const;

const Id = z.string().uuid();

/** UF da filial: 2 letras maiúsculas, como no banco (aceita minúsculas na entrada e normaliza). */
export const UfSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'UF deve ter 2 letras (ex.: AM).');

/**
 * T-0159 (aditivo, opcional): CNPJ (14 dígitos, só números) e endereço da filial; o PDF do pedido e do orçamento mostra os da filial de faturamento.
 * Obrigatórios no cadastro do BKO (RN-CORE-39); opcionais na leitura porque filial antiga ou de aparelho antigo pode não ter.
 */
export const FilialDadosFiscaisSchema = z.object({
  cnpj: z.string().nullish(),
  logradouro: z.string().nullish(),
  numero: z.string().nullish(),
  complemento: z.string().nullish(),
  bairro: z.string().nullish(),
  cep: z.string().nullish(),
  telefone: z.string().nullish(),
});
export type FilialDadosFiscais = z.infer<typeof FilialDadosFiscaisSchema>;
/** RD-0115: os campos fiscais da filial, numa lista só (API, domain, web, Vendedor e Hub usam esta). */
export const CAMPOS_FISCAIS_FILIAL = FilialDadosFiscaisSchema.keyof().options;
export type CampoFiscalFilial = (typeof CAMPOS_FISCAIS_FILIAL)[number];

/** RD-0122 / RN-CORE-39: limites de tamanho do CNPJ (com máscara), endereço e telefone da filial; fonte única, que o Hub importa. */
export const LIMITES_FILIAL = { cnpj: 18, logradouro: 160, numero: 20, complemento: 80, bairro: 80, cep: 9, telefone: 30 } as const;
/** RD-0122 / RN-CORE-39: o que o cadastro da filial exige (CNPJ válido, endereço, cidade e UF). */
export const CAMPOS_OBRIGATORIOS_FILIAL = ['cnpj', 'logradouro', 'numero', 'bairro', 'cep', 'cidade', 'uf'] as const;

export const FilialSchema = z.object({
  id: Id,
  codigo: z.string(),
  nome: z.string(),
  cidade: z.string().nullable(),
  uf: z.string().nullable(),
  padrao: z.boolean(),
  ativo: z.boolean(),
  external_id: z.string().nullable(),
  ...FilialDadosFiscaisSchema.shape,
});
export type Filial = z.infer<typeof FilialSchema>;

/** Lista do BKO: com a contagem de clientes ativos (filial com cliente não inativa) e o aviso de cadastro a completar (padrão sem cidade/UF). */
export const FilialListaItemSchema = FilialSchema.extend({ clientes_ativos: z.number().int().nonnegative(), incompleta: z.boolean() });
export type FilialListaItem = z.infer<typeof FilialListaItemSchema>;
export const FiliaisListaSchema = z.object({ itens: z.array(FilialListaItemSchema) });
export type FiliaisLista = z.infer<typeof FiliaisListaSchema>;

/** Textos do CNPJ/endereço na entrada: tolerantes (aceitam máscara e ausência); quem valida e devolve a mensagem em português é o domínio. */
const TextoFiscal = (max: number) => z.string().max(max).optional();
const CamposFiscaisEntrada = {
  cnpj: TextoFiscal(LIMITES_FILIAL.cnpj),
  logradouro: TextoFiscal(LIMITES_FILIAL.logradouro),
  numero: TextoFiscal(LIMITES_FILIAL.numero),
  complemento: TextoFiscal(LIMITES_FILIAL.complemento),
  bairro: TextoFiscal(LIMITES_FILIAL.bairro),
  cep: TextoFiscal(LIMITES_FILIAL.cep),
  telefone: TextoFiscal(LIMITES_FILIAL.telefone),
};

/** Criar: o `id` (UUID) nasce no cliente; repetir o mesmo `id` devolve a filial já criada (escrita idempotente). */
export const FilialCriarSchema = z.object({
  id: Id,
  codigo: z.string().max(40),
  nome: z.string().max(200),
  cidade: z.string().max(200),
  uf: UfSchema,
  // T-0159 / RN-CORE-39: CNPJ e endereço obrigatórios (o domínio recusa com a mensagem do que falta).
  ...CamposFiscaisEntrada,
});
export type FilialCriar = z.infer<typeof FilialCriarSchema>;

/** Editar: ao menos um campo. `padrao: true` torna esta a filial padrão (a anterior deixa de ser); `padrao: false` não existe (troque a padrão marcando outra). */
export const FilialEditarSchema = z
  .object({
    codigo: z.string().max(40).optional(),
    nome: z.string().max(200).optional(),
    cidade: z.string().max(200).optional(),
    uf: UfSchema.optional(),
    ...CamposFiscaisEntrada,
    ativo: z.boolean().optional(),
    padrao: z.literal(true).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Informe ao menos um campo da filial.' });
export type FilialEditar = z.infer<typeof FilialEditarSchema>;

export const FilialIdParamSchema = z.object({ id: Id });

/** `PUT /v1/core/clientes/:id/filial` (BKO; cliente que veio do ERP recusa com 422 `RN-CORE-39`). */
export const ClienteFilialPutSchema = z.object({ filial_id: Id });
export type ClienteFilialPut = z.infer<typeof ClienteFilialPutSchema>;

/**
 * `core.filiais@1` (T-0149): as filiais do tenant e a filial EFETIVA dos clientes pedidos. Catálogo e Vendedor dependem dela
 * (preço e estoque da filial do cliente; retrato da filial no pedido); o Hub resolve `filial_external_id` por ela.
 * - `cliente_ids`: devolve a filial efetiva de cada um em `clientes` (cliente nulo/inativo/inexistente cai na padrão);
 * - `external_ids`: devolve `por_external_id` só com os que existem (desconhecido fica de fora: `referencia_ausente` no Hub);
 * - `escopo: 'carteira'`: `da_carteira` = filiais efetivas dos clientes visíveis a quem consulta + a padrão (`null` quando a carteira é o tenant inteiro).
 */
export const FiliaisEntradaSchema = z
  .object({
    cliente_ids: z.array(Id).max(500).default([]),
    external_ids: z.array(z.string().min(1).max(200)).max(500).default([]),
    escopo: z.enum(['tenant', 'carteira']).default('tenant'),
  })
  .strict();
export type FiliaisEntrada = z.infer<typeof FiliaisEntradaSchema>;
export const FiliaisSaidaSchema = z.object({
  padrao_id: Id,
  filiais: z.array(FilialSchema),
  clientes: z.array(z.object({ cliente_id: Id, filial_id: Id })),
  por_external_id: z.array(z.object({ external_id: z.string(), filial_id: Id })),
  da_carteira: z.array(Id).nullable(),
});
export type FiliaisSaida = z.infer<typeof FiliaisSaidaSchema>;

export const CONSULTA_FILIAIS = definirConsulta({ nome: 'core.filiais@1', entrada: FiliaisEntradaSchema, saida: FiliaisSaidaSchema });

/**
 * `core.filiais_do_usuario@1` (T-0176, RN-CORE-39): as filiais vivas de um usuário do tenant, de qualquer cargo (o Catálogo soma o estoque delas).
 * `sem_filial` = nenhuma filial viva. Usuário inexistente, apagado ou de outro tenant devolve `filial_ids: []` e `sem_filial: true`.
 */
export const FiliaisDoUsuarioEntradaSchema = z.object({ usuario_id: Id }).strict();
export type FiliaisDoUsuarioEntrada = z.infer<typeof FiliaisDoUsuarioEntradaSchema>;
export const FiliaisDoUsuarioSaidaSchema = z.object({ filial_ids: z.array(Id), sem_filial: z.boolean() });
export type FiliaisDoUsuarioSaida = z.infer<typeof FiliaisDoUsuarioSaidaSchema>;
export const CONSULTA_FILIAIS_DO_USUARIO = definirConsulta({ nome: 'core.filiais_do_usuario@1', entrada: FiliaisDoUsuarioEntradaSchema, saida: FiliaisDoUsuarioSaidaSchema });
