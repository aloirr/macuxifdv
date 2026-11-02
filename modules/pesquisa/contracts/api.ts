/**
 * Contratos HTTP da Pesquisa (`/v1/pesquisa/*`, T-0057): construtor do BKO, resultados/exportação e linhas do sync.
 * Os tipos de domínio (versão, pergunta, resposta, resultado) vêm dos outros arquivos de `contracts`; aqui só os
 * envelopes de pedido/resposta das rotas e as linhas do pull (ADR 0009 §2: comando do push ≠ linha do servidor).
 */
import { z } from 'zod';
import { DataCivil, InstanteUtc, TextoCurto, Uuid } from './base';
import { Pergunta } from './pergunta';
import { Frequencia, ModoPesquisa, PublicoAlvo, Vigencia } from './publico';
import { Questionario, QuestionarioVersao, StatusVersao } from './questionario';
import { RegraCondicional } from './regra';
import { ItemResposta } from './resposta';
import { ResultadoConsolidado, ResultadoPesquisa } from './resultado';

// ---------- construtor (BKO) ----------

/** RF-PES-01: cria o questionário com a 1ª versão em rascunho. O `id` pode vir do navegador (escrita idempotente). */
export const CriarQuestionarioRequest = z
  .object({
    id: Uuid.optional(),
    titulo: TextoCurto,
    descricao: z.string().trim().max(1000).optional(),
    modo: ModoPesquisa.optional(),
  })
  .strict();
export type CriarQuestionarioRequest = z.infer<typeof CriarQuestionarioRequest>;

/**
 * RF-PES-01/02/05: grava o rascunho. Sem rascunho aberto, a API abre a próxima versão a partir da publicada mais nova
 * (`iniciarEdicao`) e aplica as alterações nela; versão publicada nunca muda (RN-PES-01).
 */
export const SalvarRascunhoRequest = z
  .object({
    titulo: TextoCurto.optional(),
    descricao: z.string().trim().max(1000).optional(),
    modo: ModoPesquisa.optional(),
    frequencia: Frequencia.optional(),
    publico_alvo: PublicoAlvo.optional(),
    vigencia: Vigencia.optional(),
    perguntas: z.array(Pergunta).optional(),
    regras: z.array(RegraCondicional).optional(),
  })
  .strict();
export type SalvarRascunhoRequest = z.infer<typeof SalvarRascunhoRequest>;

/** Problema de validação do construtor (erros impedem publicar; avisos não). */
export const ProblemaConstrutor = z.object({ codigo: z.string(), mensagem: z.string(), pergunta_id: z.string().optional(), regra_id: z.string().optional() }).passthrough();
export type ProblemaConstrutor = z.infer<typeof ProblemaConstrutor>;

export const ValidacaoConstrutor = z.object({ erros: z.array(ProblemaConstrutor), avisos: z.array(ProblemaConstrutor) }).strict();
export type ValidacaoConstrutor = z.infer<typeof ValidacaoConstrutor>;

/** Linha da lista de questionários do BKO. */
export const QuestionarioResumo = z
  .object({
    id: Uuid,
    titulo: z.string(),
    modo: ModoPesquisa,
    /** `publicada` quando há versão vigente; `rascunho` quando só há rascunho; `arquivado` por cima de tudo. */
    situacao: z.enum(['rascunho', 'publicada', 'arquivado']),
    versao_vigente: z.number().int().positive().nullable(),
    tem_rascunho: z.boolean(),
    vigencia: Vigencia,
    respostas: z.number().int().nonnegative(),
    criado_em: InstanteUtc,
    atualizado_em: InstanteUtc,
    arquivado_em: InstanteUtc.nullable(),
  })
  .strict();
export type QuestionarioResumo = z.infer<typeof QuestionarioResumo>;

export const ListaQuestionarios = z.object({ itens: z.array(QuestionarioResumo) }).strict();
export type ListaQuestionarios = z.infer<typeof ListaQuestionarios>;

export const ListaQuestionariosQuery = z
  .object({
    situacao: z.enum(['rascunho', 'publicada', 'arquivado']).optional(),
    q: z.string().trim().max(100).optional(),
  })
  .strict();
export type ListaQuestionariosQuery = z.infer<typeof ListaQuestionariosQuery>;

/** Detalhe para o construtor: cabeçalho, todas as versões e a validação do rascunho aberto (se houver). */
export const QuestionarioDetalhe = z
  .object({
    questionario: Questionario,
    versoes: z.array(QuestionarioVersao),
    /** Validação do rascunho aberto (`null` sem rascunho). */
    validacao_rascunho: ValidacaoConstrutor.nullable(),
    respostas: z.number().int().nonnegative(),
  })
  .strict();
export type QuestionarioDetalhe = z.infer<typeof QuestionarioDetalhe>;

export const PublicarResponse = z.object({ versao: QuestionarioVersao, avisos: z.array(ProblemaConstrutor) }).strict();
export type PublicarResponse = z.infer<typeof PublicarResponse>;

export const ParamsQuestionario = z.object({ id: Uuid }).strict();

// ---------- resultados e exportação (RF-PES-06) ----------

/** Filtros da URL do BKO (`?de=&ate=&equipes=a,b&versao=`). `versao` vazia = consolidado entre versões (RN-PES-01). */
export const ResultadoQuery = z
  .object({
    de: DataCivil.optional(),
    ate: DataCivil.optional(),
    /** Ids de equipe separados por vírgula. */
    equipes: z
      .string()
      .optional()
      .transform((s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined))
      .pipe(z.array(Uuid).max(100).optional()),
    versao: Uuid.optional(),
  })
  .strict()
  .refine((q) => q.de === undefined || q.ate === undefined || q.de <= q.ate, { path: ['ate'], message: 'A data final não pode ser anterior à inicial.' });
export type ResultadoQuery = z.infer<typeof ResultadoQuery>;

export const ResultadoResponse = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('versao'), resultado: ResultadoPesquisa }).strict(),
  z.object({ tipo: z.literal('consolidado'), resultado: ResultadoConsolidado }).strict(),
]);
export type ResultadoResponse = z.infer<typeof ResultadoResponse>;

/** Resposta listada no BKO (texto aberto, galeria e exportação), no escopo de quem vê. */
export const RespostaListada = z
  .object({
    id: Uuid,
    versao_id: Uuid,
    versao_numero: z.number().int().positive(),
    usuario_id: Uuid,
    equipe_id: Uuid.nullable(),
    cliente_id: Uuid.nullable(),
    visita_id: Uuid.nullable(),
    respondida_em: InstanteUtc,
    recebida_em: InstanteUtc,
    suspeita: z.boolean(),
    motivos_suspeita: z.array(z.string()),
    itens: z.array(ItemResposta),
  })
  .strict();
export type RespostaListada = z.infer<typeof RespostaListada>;

export const ListaRespostas = z.object({ itens: z.array(RespostaListada), total: z.number().int().nonnegative() }).strict();
export type ListaRespostas = z.infer<typeof ListaRespostas>;

/** Foto da galeria: o binário vem de `GET /v1/arquivos/:id` (ADR 0010); aqui só a referência e o contexto. */
export const FotoGaleria = z
  .object({
    foto_id: Uuid,
    resposta_id: Uuid,
    pergunta_id: Uuid,
    enunciado: z.string(),
    cliente_id: Uuid.nullable(),
    usuario_id: Uuid,
    capturada_em: InstanteUtc,
  })
  .strict();
export type FotoGaleria = z.infer<typeof FotoGaleria>;

export const Galeria = z.object({ itens: z.array(FotoGaleria) }).strict();
export type Galeria = z.infer<typeof Galeria>;

/** Exportação (RF-PES-06): CSV em UTF-8 com BOM e `;` (abre direto no Excel pt-BR). */
export const ExportacaoResponse = z.object({ nome_arquivo: z.string().min(1), tipo: z.literal('text/csv'), conteudo: z.string() }).strict();
export type ExportacaoResponse = z.infer<typeof ExportacaoResponse>;

// ---------- linhas do sync (pull) ----------

const BaseLinha = { id: Uuid, updated_at: z.string(), deleted_at: z.string().nullable() };

/**
 * Linha do pull `questionario_versao`: só versões PUBLICADAS (rascunho nunca vai ao aparelho, RN-PES-01), com o
 * `arquivado_em` do questionário repetido em cada versão (arquivar = todas as versões mudam e somem da oferta).
 */
export const QuestionarioVersaoSync = z
  .object({
    ...BaseLinha,
    questionario_id: Uuid,
    numero: z.number().int().positive(),
    status: StatusVersao,
    arquivado_em: InstanteUtc.nullable(),
    questionario_criado_em: InstanteUtc,
    versao: QuestionarioVersao,
  })
  .strict();
export type QuestionarioVersaoSync = z.infer<typeof QuestionarioVersaoSync>;

/**
 * Linha do pull `resposta_pesquisa`: só o necessário para a frequência e o checkout (RN-PES-02/03) — sem o conteúdo
 * das respostas (LGPD e tamanho). Escopo: respostas do próprio usuário e dos clientes da carteira (RN-CORE-04).
 */
export const RespostaPesquisaSync = z
  .object({
    ...BaseLinha,
    questionario_id: Uuid,
    versao_id: Uuid,
    usuario_id: Uuid,
    cliente_id: Uuid.nullable(),
    visita_id: Uuid.nullable(),
    respondida_em: InstanteUtc,
    recebida_em: InstanteUtc,
  })
  .strict();
export type RespostaPesquisaSync = z.infer<typeof RespostaPesquisaSync>;
