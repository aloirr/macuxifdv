/**
 * Corpo das rotas `/v1/treinamento/*` (desenho T-0058). A API valida a entrada com estes schemas e o app/BKO lê a
 * saída tipada por eles. Toda rota checa licença, perfil (ação do manifesto) e escopo (RN-CORE-04).
 */
import { z } from 'zod';
import { InstanteUtc, IsoDate, Pct0a100, Pontos, Uuid } from './base';
import { STATUS_TRILHA, Trilha } from './conteudo';
import { PeriodoRankingContrato } from './ranking';

const AnoMes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês no formato AAAA-MM.');
const PctOuNulo = Pct0a100.nullable();

// ---------- aluno ----------

export const NivelContrato = z
  .object({
    nivel: z.number().int().positive(),
    xp_total: Pontos,
    xp_inicio_nivel: Pontos,
    xp_proximo_nivel: Pontos.nullable(),
    xp_faltante: Pontos,
    progresso_pct: Pct0a100,
    nivel_maximo: z.boolean(),
  })
  .strict();

export const TrilhaNaJornadaContrato = z
  .object({
    trilha_id: Uuid,
    titulo: z.string(),
    obrigatoria: z.boolean(),
    prazo: IsoDate.nullable(),
    atrasada: z.boolean(),
    dias_para_prazo: z.number().int().nullable(),
    progresso_pct: Pct0a100,
    concluida: z.boolean(),
    licoes_total: z.number().int().nonnegative(),
    licoes_concluidas: z.number().int().nonnegative(),
    proxima_licao_id: Uuid.nullable(),
  })
  .strict();
export type TrilhaNaJornadaContrato = z.infer<typeof TrilhaNaJornadaContrato>;

/** `GET /v1/treinamento/jornada` — o mesmo `resumoDaJornada` que o app calcula offline. */
export const JornadaResposta = z
  .object({
    hoje: IsoDate,
    xp_total: Pontos,
    xp_hoje: Pontos,
    nivel: NivelContrato,
    streak: z.object({ dias: z.number().int().nonnegative(), ativa_hoje: z.boolean(), em_risco: z.boolean(), maior: z.number().int().nonnegative() }).strict(),
    trilhas: z.array(TrilhaNaJornadaContrato),
    medalhas: z.array(z.object({ codigo: z.string(), nome: z.string(), conquistada_em: InstanteUtc.nullable() }).strict()),
    obrigatorias_pendentes: z.number().int().nonnegative(),
  })
  .strict();
export type JornadaResposta = z.infer<typeof JornadaResposta>;

// ---------- ranking (RF-TRE-04, RN-TRE-03) ----------

export const ESCOPOS_RANKING = ['geral', 'equipe', 'regional'] as const;
export const RankingQuery = z
  .object({
    periodo: PeriodoRankingContrato.default('semanal'),
    escopo: z.enum(ESCOPOS_RANKING).default('geral'),
    /** Data de referência (fuso do tenant); padrão = hoje. */
    data: IsoDate.optional(),
  })
  .strict();
export type RankingQuery = z.infer<typeof RankingQuery>;

export const LinhaRankingContrato = z
  .object({
    posicao: z.number().int().positive(),
    usuario_id: Uuid,
    nome: z.string(),
    pontos: Pontos,
    trilhas_concluidas: z.number().int().nonnegative(),
    eu: z.boolean(),
  })
  .strict();
export type LinhaRankingContrato = z.infer<typeof LinhaRankingContrato>;

export const RankingResposta = z
  .object({
    periodo: PeriodoRankingContrato,
    escopo: z.enum(ESCOPOS_RANKING),
    inicio: IsoDate.nullable(),
    fim: IsoDate.nullable(),
    data_ref: IsoDate,
    calculado_em: InstanteUtc,
    linhas: z.array(LinhaRankingContrato),
    minha_linha: LinhaRankingContrato.nullable(),
  })
  .strict();
export type RankingResposta = z.infer<typeof RankingResposta>;

// ---------- painel de adesão (RF-TRE-05) ----------

export const AdesaoQuery = z.object({ mes: AnoMes.optional(), equipe_id: Uuid.optional() }).strict();
export type AdesaoQuery = z.infer<typeof AdesaoQuery>;

export const IndicadorTrilhaContrato = z
  .object({
    trilha_id: Uuid,
    titulo: z.string(),
    status: z.enum(STATUS_TRILHA),
    obrigatoria: z.boolean(),
    prazo: IsoDate.nullable(),
    publico: z.number().int().nonnegative(),
    concluiram: z.number().int().nonnegative(),
    conclusao_pct: PctOuNulo,
    nota_media_pct: PctOuNulo,
  })
  .strict();
export type IndicadorTrilhaContrato = z.infer<typeof IndicadorTrilhaContrato>;

export const AdesaoResposta = z
  .object({
    mes: AnoMes,
    equipe_id: Uuid.nullable(),
    calculado_em: InstanteUtc,
    /** true = a lista de pessoas só tem quem já usou o Treinamento (Core sem `core.usuarios_resumo@1`): a adesão pode sair inflada. */
    base_parcial: z.boolean().default(false),
    adesao: z.object({ publico: z.number().int().nonnegative(), ativos_no_mes: z.number().int().nonnegative(), adesao_pct: PctOuNulo }).strict(),
    trilhas: z.array(IndicadorTrilhaContrato),
  })
  .strict();
export type AdesaoResposta = z.infer<typeof AdesaoResposta>;

export const PessoaDoPainelContrato = z
  .object({
    usuario_id: Uuid,
    nome: z.string(),
    perfil: z.string(),
    equipe_id: Uuid.nullable(),
    licoes_no_mes: z.number().int().nonnegative(),
    trilhas_concluidas: z.number().int().nonnegative(),
    obrigatorias_pendentes: z.number().int().nonnegative(),
    nota_media_pct: PctOuNulo,
    ultima_atividade_em: InstanteUtc.nullable(),
  })
  .strict();
export type PessoaDoPainelContrato = z.infer<typeof PessoaDoPainelContrato>;

/** `GET /v1/treinamento/adesao/pessoas` (ação `notas.ver`). */
export const PessoasResposta = z.object({ mes: AnoMes, equipe_id: Uuid.nullable(), calculado_em: InstanteUtc, pessoas: z.array(PessoaDoPainelContrato) }).strict();
export type PessoasResposta = z.infer<typeof PessoasResposta>;

// ---------- BKO de trilhas (RF-TRE-01) ----------

export const BkoTrilhasQuery = z.object({ status: z.enum(STATUS_TRILHA).optional(), busca: z.string().trim().max(100).optional() }).strict();
export type BkoTrilhasQuery = z.infer<typeof BkoTrilhasQuery>;

export const BkoTrilhaResumo = z
  .object({
    id: Uuid,
    titulo: z.string(),
    status: z.enum(STATUS_TRILHA),
    obrigatoria: z.boolean(),
    prazo: IsoDate.nullable(),
    modulos: z.number().int().nonnegative(),
    licoes: z.number().int().nonnegative(),
    quizzes: z.number().int().nonnegative(),
    publico_perfis: z.array(z.string()),
    publico_equipes: z.number().int().nonnegative(),
    publicada_em: InstanteUtc.nullable(),
    updated_at: InstanteUtc,
  })
  .strict();
export type BkoTrilhaResumo = z.infer<typeof BkoTrilhaResumo>;

export const BkoTrilhasResposta = z.object({ itens: z.array(BkoTrilhaResumo) }).strict();
export type BkoTrilhasResposta = z.infer<typeof BkoTrilhasResposta>;

/** Detalhe no BKO: a trilha e o que ainda impede publicar (vazio = pode publicar). */
export const BkoTrilhaDetalhe = Trilha.extend({ problemas_para_publicar: z.array(z.string()) }).strict();
export type BkoTrilhaDetalhe = z.infer<typeof BkoTrilhaDetalhe>;

export const IdParams = z.object({ id: Uuid }).strict();

/**
 * Caminhos das rotas, RELATIVOS à base da API (que já termina em `/v1`: `ClienteHttp` do app e `api()` do BKO).
 * Na API o módulo é montado em `/v1/treinamento/<caminho>`.
 */
export const ROTAS_TREINAMENTO = {
  jornada: '/treinamento/jornada',
  ranking: '/treinamento/ranking',
  adesao: '/treinamento/adesao',
  adesaoPessoas: '/treinamento/adesao/pessoas',
  bkoTrilhas: '/treinamento/bko/trilhas',
  bkoTrilha: (id: string) => `/treinamento/bko/trilhas/${id}`,
  bkoPublicar: (id: string) => `/treinamento/bko/trilhas/${id}/publicar`,
  bkoArquivar: (id: string) => `/treinamento/bko/trilhas/${id}/arquivar`,
} as const;
