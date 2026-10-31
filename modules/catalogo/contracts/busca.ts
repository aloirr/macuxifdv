/**
 * Contratos da vitrine, da busca (inteligente e offline), de preço e estoque visíveis, de sinônimos e do
 * "Pergunte ao catálogo" (RF-CAT-01..05, RF-CAT-07; RN-CAT-01..03).
 * Convenções: dinheiro em centavos inteiros (ADR 0002); instantes em ISO 8601 UTC; campos em snake_case como
 * o restante dos contratos de produto; valores de enum em português.
 * O que for regra (normalização, ranking, preço, estoque, limite) mora em `../domain`; aqui só a forma.
 */
import { z } from 'zod';
import { Cents, Id, ProductBase } from '@macuxi/core/contracts';

/** Instante ISO 8601 em UTC (termina em `Z`). */
export const InstanteUtc = z.string().datetime({ message: 'Informe a data e hora em ISO 8601 UTC (ex.: 2026-10-31T12:00:00Z).' });

// ---------- parâmetros do tenant (doc 03, tabela de parâmetros; docs/modulos/catalogo/regras.md) ----------
export const ParametrosCatalogo = z
  .object({
    /** RN-CAT-03: limite de consultas de IA por usuário/dia ([200]); 0 desliga a busca inteligente. */
    limite_consultas_ia_dia: z.number().int().min(0).default(200),
    /** Fuso do tenant: define a virada do dia do limite (doc 03: America/Manaus). */
    fuso: z.string().min(1).default('America/Manaus'),
    /** RF-CAT-03: faixa "baixo" = saldo de 1 até este valor (premissa: 10). */
    estoque_baixo_ate: z.number().int().min(0).default(10),
    /** RF-CAT-03: false esconde o número exato e mostra só a faixa (premissa: mostra). */
    estoque_mostrar_quantidade: z.boolean().default(true),
    /** RF-CAT-03: horas sem atualização para avisar "estoque desatualizado" (premissa: 24). */
    estoque_defasado_horas: z.number().int().min(1).default(24),
    /** Validade do cache de consultas frequentes, em segundos (premissa: 600). */
    cache_ttl_s: z.number().int().min(0).default(600),
    /** A consulta só entra no cache a partir da N-ésima ocorrência (premissa: 2). */
    cache_min_ocorrencias: z.number().int().min(1).default(2),
    /** Ranking híbrido (RF-CAT-01): peso da nota semântica quando existe (0..1). */
    peso_semantico: z.number().min(0).max(1).default(0.4),
    /** Boost aditivo por ter estoque (0..1). */
    peso_estoque: z.number().min(0).max(1).default(0.1),
    /** Boost aditivo proporcional ao mais vendido (0..1). */
    peso_mais_vendido: z.number().min(0).max(1).default(0.1),
    /** Boost aditivo para produto de campanha/destaque (0..1). */
    peso_campanha: z.number().min(0).max(1).default(0.05),
    /** RN-CAT-02: máximo de fontes enviadas ao LLM no "Pergunte ao catálogo". */
    pergunte_max_fontes: z.number().int().min(1).default(6),
    /** RN-CAT-02: orçamento de caracteres do contexto enviado ao LLM. */
    pergunte_max_caracteres: z.number().int().min(200).default(6000),
  })
  .strict();
export type ParametrosCatalogo = z.infer<typeof ParametrosCatalogo>;

// ---------- preço visível (RF-CAT-03, RN-VEN-01) ----------
export const OrigemPreco = z.enum(['condicao', 'cliente', 'padrao']);
export type OrigemPreco = z.infer<typeof OrigemPreco>;

/**
 * Preço que a pessoa pode ver/usar agora: tabela da condição ou do cliente (ou a padrão do tenant), com a
 * promoção vigente aplicada. Sem preço ⇒ `sellable=false` e `price_cents=null` (RN-VEN-01).
 */
export const PrecoVisivel = z
  .object({
    product_id: Id,
    /** Preço a mostrar/cobrar (promoção aplicada, se houver). */
    price_cents: Cents.nullable(),
    /** Preço da tabela, antes da promoção (mostrar riscado). */
    base_cents: Cents.nullable(),
    on_promotion: z.boolean(),
    promotion_id: Id.nullable(),
    /** Fim da promoção vigente (instante em que deixa de valer). */
    promotion_ends_at: InstanteUtc.nullable(),
    price_table_id: Id.nullable(),
    source: OrigemPreco.nullable(),
    sellable: z.boolean(),
    reason: z.enum(['sem_preco']).nullable(),
  })
  .strict()
  .refine((p) => (p.sellable ? p.price_cents !== null : p.price_cents === null), 'Item vendável tem preço; item sem preço não é vendável.');
export type PrecoVisivel = z.infer<typeof PrecoVisivel>;

// ---------- estoque visível (RF-CAT-03, RN-VEN-20) ----------
export const FaixaEstoque = z.enum(['disponivel', 'baixo', 'sem_estoque']);
export type FaixaEstoque = z.infer<typeof FaixaEstoque>;

export const EstoqueFilialVisivel = z.object({
  branch_id: Id,
  branch_name: z.string(),
  band: FaixaEstoque,
  /** Nulo quando o tenant não quer mostrar o número exato. */
  quantity: z.number().int().nullable(),
});
export type EstoqueFilialVisivel = z.infer<typeof EstoqueFilialVisivel>;

export const EstoqueVisivel = z.object({
  product_id: Id,
  band: FaixaEstoque,
  /** Soma das filiais/depósitos visíveis ao usuário; nulo quando o tenant esconde o número. */
  quantity: z.number().int().nullable(),
  by_branch: z.array(EstoqueFilialVisivel),
  /** Hora da última atualização do saldo (a mais antiga entre as filiais visíveis). */
  updated_at: InstanteUtc.nullable(),
  /** Passou de `estoque_defasado_horas` sem atualizar. */
  stale: z.boolean(),
});
export type EstoqueVisivel = z.infer<typeof EstoqueVisivel>;

// ---------- vitrine ----------
/** Cartão de produto na vitrine/lista/resultado de busca: cadastro base do Core + preço e estoque visíveis. */
export const ItemVitrine = ProductBase.pick({ id: true, erp_code: true, description: true, brand: true, line: true, unit: true, ean: true }).extend({
  thumbnail_url: z.string().nullable(),
  is_campaign: z.boolean(),
  price: PrecoVisivel,
  availability: EstoqueVisivel,
  /** Nota final do ranking (0..~1,3); só na busca. */
  score: z.number().optional(),
});
export type ItemVitrine = z.infer<typeof ItemVitrine>;

// ---------- sinônimos do tenant (RF-CAT-02, RF-CAT-07) ----------
/** Grupo de termos equivalentes (vale nos dois sentidos): `term` ↔ cada item de `synonyms`. */
export const Sinonimo = z.object({
  id: Id,
  term: z.string().trim().min(1),
  synonyms: z.array(z.string().trim().min(1)).min(1, 'Informe ao menos um sinônimo.'),
  active: z.boolean().default(true),
  external_id: z.string().nullable().optional(),
});
export type Sinonimo = z.infer<typeof Sinonimo>;

// ---------- consulta e resultado de busca ----------
export const CodigoExato = z.object({ type: z.enum(['ean', 'sku']), value: z.string().min(1) });
export type CodigoExato = z.infer<typeof CodigoExato>;

/** Filtros estruturados tirados da frase (pelas regras locais ou pelo LLM) — sempre revalidados na API. */
export const FiltrosInterpretados = z
  .object({
    /** Texto livre que sobrou depois de tirar os filtros (normalizado). */
    text: z.string().default(''),
    brand: z.string().nullable().default(null),
    /** Categoria/linha do produto (`ProductBase.line`). */
    line: z.string().nullable().default(null),
    min_price_cents: Cents.nonnegative().nullable().default(null),
    max_price_cents: Cents.nonnegative().nullable().default(null),
    stock: z.enum(['com', 'sem']).nullable().default(null),
    code: CodigoExato.nullable().default(null),
    /** Medidas em forma canônica (ex.: `5000ml`). */
    measures: z.array(z.string()).default([]),
    sort: z.enum(['preco_asc', 'preco_desc']).nullable().default(null),
  })
  .refine((f) => f.min_price_cents === null || f.max_price_cents === null || f.min_price_cents <= f.max_price_cents, {
    message: 'O preço mínimo não pode ser maior que o máximo.',
    path: ['min_price_cents'],
  });
export type FiltrosInterpretados = z.infer<typeof FiltrosInterpretados>;

export const ConsultaBusca = z.object({
  q: z.string().trim().min(1, 'Digite o que procura.').max(200, 'Use até 200 caracteres.'),
  /** Cliente em contexto: define a tabela de preço (RN-CAT-01). */
  customer_id: Id.optional(),
  /** Filtros explícitos da tela (chips) — somam aos interpretados. */
  line: z.string().optional(),
  brand: z.string().optional(),
  only_in_stock: z.boolean().optional(),
  mode: z.enum(['inteligente', 'basica']).default('inteligente'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ConsultaBusca = z.infer<typeof ConsultaBusca>;

export const ResultadoBusca = z.object({
  items: z.array(ItemVitrine),
  filters: FiltrosInterpretados,
  /** Quem interpretou a frase. `nenhum` = busca textual simples (offline, limite atingido ou modo básico). */
  interpreted_by: z.enum(['llm', 'regras', 'nenhum']),
  /** Busca inteligente indisponível (offline, limite ou falha do provedor): mostrar aviso discreto. */
  degraded: z.boolean(),
  notice: z.string().nullable(),
  from_cache: z.boolean(),
  /** Consultas de IA que ainda restam hoje (nulo = não se aplica). */
  remaining_ai_queries: z.number().int().min(0).nullable(),
});
export type ResultadoBusca = z.infer<typeof ResultadoBusca>;

// ---------- "Pergunte ao catálogo" (RF-CAT-05, RN-CAT-02) ----------
export const TipoFonte = z.enum(['ficha', 'faq', 'documento']);
export type TipoFonte = z.infer<typeof TipoFonte>;

/** Conteúdo cadastrado pelo tenant que pode servir de base para uma resposta. */
export const FonteCatalogo = z.object({
  id: Id,
  tenant_id: Id,
  type: TipoFonte,
  /** Produto a que a fonte se refere; nulo = vale para o catálogo todo (ex.: manual geral). */
  product_id: Id.nullable(),
  title: z.string().min(1),
  text: z.string().min(1),
  updated_at: InstanteUtc.nullable().default(null),
});
export type FonteCatalogo = z.infer<typeof FonteCatalogo>;

export const PerguntaCatalogo = z.object({
  question: z.string().trim().min(3, 'Escreva a pergunta com pelo menos 3 letras.').max(500, 'Use até 500 caracteres.'),
  /** Quando informado, a resposta usa só o conteúdo desse produto. */
  product_id: Id.optional(),
});
export type PerguntaCatalogo = z.infer<typeof PerguntaCatalogo>;

/** Fonte citada na resposta (sem o texto completo). */
export const FonteCitada = z.object({ id: Id, type: TipoFonte, title: z.string(), product_id: Id.nullable() });
export type FonteCitada = z.infer<typeof FonteCitada>;

/** RN-CAT-02: resposta com fonte ou "não encontrei na base" (sem fonte). */
export const RespostaCatalogo = z
  .object({ found: z.boolean(), answer: z.string().min(1), sources: z.array(FonteCitada) })
  .refine((r) => (r.found ? r.sources.length > 0 : r.sources.length === 0), {
    message: 'Resposta encontrada exige ao menos uma fonte; "não encontrei" não leva fonte.',
    path: ['sources'],
  });
export type RespostaCatalogo = z.infer<typeof RespostaCatalogo>;
