/**
 * Cliente 360 v2 (T-0186; RN-CORE-40; decisões P1 a P17 de 19/11/2026): abas Resumo, Histórico e Documentação.
 * Tudo ADITIVO: `Cliente360Schema` (cliente360.ts) ganha campos opcionais e o app antigo os ignora.
 * - Histórico: uma linha por NF (data, número, valor, forma de pagamento e status). A janela do aparelho é de 90 dias (P8). O detalhe da NF
 *   (parcelas, itens e PDF) só vem do servidor ao tocar (P17): nada fica no aparelho. "Em atraso" é o fato, sem a data.
 * - Documentação: só visualizar (P15). A lista traz a permissão já resolvida para o perfil; o arquivo abre do servidor.
 * - Sem nenhum alerta financeiro na ficha (R-20261119-0440).
 * Rotas (`/v1/core`): `clientes/:id/notas` (lista online), `clientes/:id/notas/:nota_id` (detalhe), `clientes/:id/documentos`,
 * `clientes/:id/documentos/:documento_id` (abrir) e, no BKO, `documentos/permissoes` (+ `documentos/excecoes`).
 */
import { z } from 'zod';

const Id = z.string().uuid();
const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Centavos = z.number().int();

export const ROTAS_CLIENTE360_V2 = {
  notas: 'clientes/:id/notas',
  nota: 'clientes/:id/notas/:nota_id',
  documentos: 'clientes/:id/documentos',
  documento: 'clientes/:id/documentos/:documento_id',
  documentosPermissoes: 'documentos/permissoes',
  documentosExcecoes: 'documentos/excecoes',
} as const;

export const ERROS_CLIENTE360_V2 = {
  notaNaoEncontrada: 'NOTA_NAO_ENCONTRADA',
  documentoNaoEncontrado: 'DOCUMENTO_NAO_ENCONTRADO',
  documentoSemPermissao: 'DOCUMENTO_SEM_PERMISSAO',
  historicoSemAcesso: 'HISTORICO_SEM_ACESSO',
  periodoInvalido: 'PERIODO_INVALIDO',
  nivelInvalido: 'DOCUMENTO_NIVEL_INVALIDO',
  tipoDesconhecido: 'DOCUMENTO_TIPO_DESCONHECIDO',
  perfilFixo: 'DOCUMENTO_PERFIL_FIXO',
} as const;

/** Status da NF (spec §4). O rótulo e o tom saem de `rotuloStatusNf` e `tomStatusNf` (domain). */
export const STATUS_NF = ['em_atraso', 'em_aberto', 'pago', 'devolvido', 'devolvido_parcial'] as const;
export const StatusNfSchema = z.enum(STATUS_NF);
export type StatusNf = z.infer<typeof StatusNfSchema>;

/** Linha da tabela do Histórico: **Data · Nº NF (e a forma de pagamento) · Valor · Status**. */
export const LinhaHistoricoNfSchema = z.object({
  id: Id,
  data: Data,
  numero_nf: z.string(),
  valor_cents: Centavos,
  /** DESCRIÇÃO em texto como o ERP manda (E1; até 120 caracteres), nunca o código; nulo = a nota veio sem a forma. */
  forma_pagamento: z.string().max(120).nullable(),
  status: StatusNfSchema,
  /** P4: valor devolvido, na 2ª linha do Valor; ausente ou 0 = sem devolução. */
  devolvido_cents: Centavos.optional(),
});
export type LinhaHistoricoNfContrato = z.infer<typeof LinhaHistoricoNfSchema>;

/** `GET clientes/:id/notas`: filtros do Histórico na URL (listas separadas por vírgula). Sem `de`, vale o padrão de 90 dias. */
export const HistoricoNfQuerySchema = z
  .object({
    de: Data.optional(),
    ate: Data.optional(),
    status: z.string().optional().transform((v) => (v ? v.split(',').filter(Boolean) : [])).pipe(z.array(StatusNfSchema)),
    forma_pagamento: z.string().optional().transform((v) => (v ? v.split(',').filter(Boolean) : [])),
    numero_nf: z.string().max(20).optional(),
    limite: z.coerce.number().int().min(1).max(500).default(200),
  })
  .strict();
export type HistoricoNfQuery = z.infer<typeof HistoricoNfQuerySchema>;

export const HistoricoNfRespostaSchema = z.object({
  de: Data,
  ate: Data,
  itens: z.array(LinhaHistoricoNfSchema),
  /** Quantas notas sairam da lista por causa do `limite`. */
  cortadas: z.number().int().min(0),
  /** Formas de pagamento que aparecem nas notas do cliente no período (grupo do filtro "Forma de pagamento"). */
  formas_pagamento: z.array(z.string()),
});
export type HistoricoNfResposta = z.infer<typeof HistoricoNfRespostaSchema>;

export const ParcelaNfSchema = z.object({
  parcela: z.string().nullable(),
  vencimento: Data,
  valor_cents: Centavos,
  saldo_cents: Centavos,
  situacao: z.enum(['aberto', 'liquidado', 'cancelado']),
  liquidado_em: z.string().nullable(),
  /** Parcela aberta com saldo e vencida: mesmo destaque da linha da nota. Sem a data de atraso. */
  em_atraso: z.boolean(),
});
export const ItemNfSchema = z.object({
  produto_codigo: z.string(),
  produto_nome: z.string(),
  unidade: z.string().nullable(),
  fator: z.number().nullable(),
  quantidade: z.number(),
  total_cents: Centavos,
});

/** `GET clientes/:id/notas/:nota_id` (P17): consulta online ao tocar. Sem pull e sem cópia no aparelho. */
export const NotaDetalheSchema = z.object({
  id: Id,
  numero_nf: z.string(),
  serie: z.string().nullable(),
  data: Data,
  /** Descrição em texto do ERP (até 120 caracteres). */
  forma_pagamento: z.string().max(120).nullable(),
  status: StatusNfSchema,
  valor_cents: Centavos,
  devolvido_cents: Centavos,
  devolvido_em: Data.nullable(),
  /** Valor da nota − devolvido. */
  valor_final_cents: Centavos,
  em_atraso: z.boolean(),
  parcelas: z.array(ParcelaNfSchema),
  /** Vazio enquanto o ERP não mandar as linhas da NF. */
  itens: z.array(ItemNfSchema),
  /** Arquivo do PDF no servidor, só para ver; nulo = sem PDF. */
  pdf_arquivo_id: Id.nullable(),
});
export type NotaDetalhe = z.infer<typeof NotaDetalheSchema>;

// --- Resumo ---------------------------------------------------------------------------------------------------------

/** Spec §3.2: o cartão tem só Limite, Saldo disponível e Prazo médio (+ o motivo, com o cliente bloqueado). `null` = sem dados financeiros ou perfil sem acesso (P12). */
export const CartaoCreditoSchema = z.object({
  limite_cents: Centavos,
  saldo_disponivel_cents: Centavos,
  prazo_medio_dias: z.number().int().nullable(),
  bloqueado: z.boolean(),
  motivo_bloqueio: z.string().nullable(),
});
export type CartaoCredito = z.infer<typeof CartaoCreditoSchema>;

export const CurvaDoClienteSchema = z.object({
  dimensao: z.enum(['faturamento', 'frequencia', 'volume']),
  curva: z.enum(['A', 'B', 'C']),
  /** "Curva Faturamento", "Curva Frequência" ou "Curva Volume". */
  rotulo: z.string(),
});

// --- Documentação ---------------------------------------------------------------------------------------------------

export const NIVEIS_DOCUMENTO = ['nao_ve', 've', 've_e_envia'] as const;
export const NivelDocumentoSchema = z.enum(NIVEIS_DOCUMENTO);
export const ORIGENS_TIPO_DOCUMENTO = ['erp', 'escritorio', 'app'] as const;

/** Linha da tabela da Documentação: **Documento · Data · Abrir**, com uma faixa por tipo/grupo. */
export const DocumentoLinhaSchema = z.object({
  id: Id,
  tipo_id: Id,
  /** Nome do tipo ("Alvará de funcionamento"). */
  tipo: z.string(),
  /** Faixa da tabela ("Fotos do PDV", "Cadastro", "Contratos"). */
  grupo: z.string(),
  nome: z.string(),
  data: Data,
  formato: z.string().nullable(),
  validade: Data.nullable(),
  validade_situacao: z.enum(['sem_validade', 'valido', 'vencido']),
  /** `bloqueado` = exceção por documento: linha com cadeado, "Sem permissão para abrir", data "—". */
  acesso: z.enum(['abrir', 'bloqueado']),
  /** Foto que o perfil pode enviar (câmera). */
  pode_enviar: z.boolean(),
});
export type DocumentoLinhaContrato = z.infer<typeof DocumentoLinhaSchema>;

export const DocumentosRespostaSchema = z.object({ itens: z.array(DocumentoLinhaSchema) });
export type DocumentosResposta = z.infer<typeof DocumentosRespostaSchema>;

/** `GET clientes/:id/documentos/:documento_id`: só depois de revalidar licença, perfil, carteira, tipo e exceção. O arquivo abre no visualizador, sem baixar. */
export const DocumentoAbrirRespostaSchema = z.object({ id: Id, nome: z.string(), formato: z.string().nullable(), arquivo_id: Id });
export type DocumentoAbrirResposta = z.infer<typeof DocumentoAbrirRespostaSchema>;

// --- BKO › Parâmetros › Documentos ----------------------------------------------------------------------------------

export const DocumentoTipoSchema = z.object({
  id: Id,
  nome: z.string(),
  grupo: z.string(),
  ordem: z.number().int(),
  origem: z.enum(ORIGENS_TIPO_DOCUMENTO),
  permite_envio: z.boolean(),
  ativo: z.boolean(),
});
export const PermissaoTipoDocumentoSchema = z.object({ tipo_id: Id, perfil: z.string().min(1).max(40), nivel: NivelDocumentoSchema });
export const ExcecaoDocumentoSchema = z.object({ documento_id: Id, perfil: z.string().min(1).max(40) });

/** `GET documentos/permissoes` (ação `documento.permissoes`): a matriz tipo × perfil e as exceções por documento. */
export const DocumentoPermissoesRespostaSchema = z.object({
  tipos: z.array(DocumentoTipoSchema),
  matriz: z.array(PermissaoTipoDocumentoSchema),
  excecoes: z.array(
    z.object({ documento_id: Id, documento_nome: z.string(), cliente_id: Id, cliente_nome: z.string(), perfis: z.array(z.string()) }),
  ),
});
export type DocumentoPermissoesResposta = z.infer<typeof DocumentoPermissoesRespostaSchema>;

/** `PUT documentos/permissoes`: o estado inteiro da matriz (a tela envia o que mudou junto com o resto; idempotente). */
export const DocumentoPermissoesPutSchema = z.object({ matriz: z.array(PermissaoTipoDocumentoSchema).max(2000) }).strict();
export type DocumentoPermissoesPut = z.infer<typeof DocumentoPermissoesPutSchema>;

/** `PUT documentos/excecoes`: perfis que NÃO veem o documento (P11: a exceção só tira acesso). Lista vazia = remove a exceção. */
export const DocumentoExcecaoPutSchema = z.object({ documento_id: Id, perfis: z.array(z.string().min(1).max(40)).max(20) }).strict();
export type DocumentoExcecaoPut = z.infer<typeof DocumentoExcecaoPutSchema>;
