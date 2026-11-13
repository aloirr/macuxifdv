/**
 * Contratos da vitrine, da busca (inteligente e offline), de preço e estoque visíveis, de sinônimos e do
 * "Pergunte ao catálogo" (RF-CAT-01..05, RF-CAT-07; RN-CAT-01..08).
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
    /** RN-CAT-03: limite de consultas de IA por usuário/dia ([200]); 0 desliga a busca inteligente. Só consulta respondida conta. */
    limite_consultas_ia_dia: z.number().int().min(0).default(200),
    /** RN-CAT-05: false (padrão) = promotor vê ficha e fotos sem preço de tabela e sem estoque; true = vê como o vendedor. */
    promotor_ve_preco_estoque: z.boolean().default(false),
    /** RN-CAT-07: faixa "baixo" = saldo de 1 até este valor ([9]; T-0173: a tag laranja vai de 1 a 9). */
    estoque_baixo_ate: z.number().int().min(0).default(9),
    /** RN-CAT-07: true (padrão) mostra o número exato; false mostra só a faixa. */
    estoque_mostrar_quantidade: z.boolean().default(true),
    /** RN-CAT-07: horas sem atualização para marcar "estoque desatualizado" ([24]). */
    estoque_defasado_horas: z.number().int().min(1).default(24),
    /** RN-CAT-08: validade do cache de consultas frequentes, em segundos ([600]; 0 desliga). */
    cache_ttl_s: z.number().int().min(0).default(600),
    /** RN-CAT-08: a consulta só entra no cache a partir da N-ésima ocorrência ([2]). */
    cache_min_ocorrencias: z.number().int().min(1).default(2),
    /** RN-CAT-08: peso da nota semântica no ranking híbrido quando existe (0..1, [0,4]); calibrado na Sprint 3. */
    peso_semantico: z.number().min(0).max(1).default(0.4),
    /** RN-CAT-08: boost aditivo por ter estoque (0..1, [0,10]). */
    peso_estoque: z.number().min(0).max(1).default(0.1),
    /** RN-CAT-08: boost aditivo proporcional ao mais vendido (0..1, [0,10]). */
    peso_mais_vendido: z.number().min(0).max(1).default(0.1),
    /** RN-CAT-08: boost aditivo para produto de campanha/destaque (0..1, [0,05]). */
    peso_campanha: z.number().min(0).max(1).default(0.05),
    /** RN-CAT-02: máximo de fontes enviadas ao LLM no "Pergunte ao catálogo". */
    pergunte_max_fontes: z.number().int().min(1).default(6),
    /** RN-CAT-02: orçamento de caracteres do contexto enviado ao LLM. */
    pergunte_max_caracteres: z.number().int().min(200).default(6000),
    /** RN-CAT-12: peso do campo Aplicação no ranking (0..1, [0,5]); os atributos seguem com 0,3 (constante). */
    peso_aplicacao: z.number().min(0).max(1).default(0.5),
    /** RN-CAT-11: máximo de caracteres da Aplicação no cadastro (100..2.000, [2.000]). */
    aplicacao_max_cadastro: z.number().int().min(100).max(2000).default(2000),
  })
  .strict();
export type ParametrosCatalogo = z.infer<typeof ParametrosCatalogo>;

// ---------- preço visível (RF-CAT-03, RN-CAT-06, RN-VEN-01) ----------
export const OrigemPreco = z.enum(['condicao', 'cliente', 'padrao']);
export type OrigemPreco = z.infer<typeof OrigemPreco>;

/**
 * Preço que a pessoa pode ver/usar agora: tabela da condição ou do cliente (ou a padrão do tenant), com a
 * promoção vigente aplicada. Sem preço ⇒ `sellable=false` e `price_cents=null` (RN-VEN-01). Cliente em contexto e
 * item fora da tabela dele ⇒ "sem preço para este cliente", sem cair na tabela padrão (RN-CAT-06).
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
    /** Texto para a tela quando não há preço (RN-CAT-06: "Sem preço para este cliente."); nulo quando vendável. */
    notice: z.string().nullable().default(null),
  })
  .strict()
  .refine((p) => (p.sellable ? p.price_cents !== null : p.price_cents === null), 'Item vendável tem preço; item sem preço não é vendável.');
export type PrecoVisivel = z.infer<typeof PrecoVisivel>;

// ---------- estoque visível (RF-CAT-03, RN-CAT-07, RN-VEN-20) ----------
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
  /**
   * RN-CAT-07: instante da última atualização do saldo (a mais antiga entre as filiais visíveis), sempre presente
   * na resposta para a tela mostrar "atualizado às hh:mm" (`rotuloAtualizacaoEstoque`); nulo só quando nenhum
   * saldo visível tem hora (aí `stale` é true).
   */
  updated_at: InstanteUtc.nullable(),
  /** RN-CAT-07: passou de `estoque_defasado_horas` sem atualizar (ou há saldo sem hora): "estoque desatualizado". */
  stale: z.boolean(),
});
export type EstoqueVisivel = z.infer<typeof EstoqueVisivel>;

// ---------- trecho "Serve em" e referência cruzada (RN-CAT-12, RN-CAT-09; T-0084 C7, T-0085 K5/K6) ----------
/** Par [início, fim) em posições do `texto` (fim exclusivo). */
const Marca = z.tuple([z.number().int().min(0), z.number().int().min(0)]);

/** Trecho da aplicação que casou com a consulta (até 90 caracteres), com os termos marcados. */
export const TrechoBusca = z
  .object({
    texto: z.string().max(90),
    marcas: z.array(Marca).max(20),
    /** Preenchido quando o ano da consulta casou por faixa ("inclui 2012"). */
    inclui_ano: z.number().int().min(1900).max(2100).nullable(),
  })
  .strict();
export type TrechoBusca = z.infer<typeof TrechoBusca>;

/** Referência cruzada do produto: marca concorrente (id do cadastro de marcas do Catálogo, `catalogo.marca_concorrente`, sem FK) + código (até 30). */
export const Referencia = z.object({ marca_id: Id, marca_nome: z.string().min(1), codigo: z.string().min(1).max(30) }).strict();
export type Referencia = z.infer<typeof Referencia>;

/** "Equivale a: <marca> <código>"; `marcas` em posições de `<marca_nome> <codigo>`. */
export const EquivaleA = Referencia.extend({ marcas: z.array(Marca).max(20) }).strict();
export type EquivaleA = z.infer<typeof EquivaleA>;

// ---------- vitrine ----------
/**
 * Cartão de produto na vitrine/lista/resultado de busca: cadastro base do Core + preço e estoque visíveis.
 * RN-CAT-05: para quem não vê preço e estoque (promotor com `promotor_ve_preco_estoque=false`), `price` e
 * `availability` vêm nulos e `price_stock_visible=false` — a ficha e as fotos continuam.
 */
export const ItemVitrine = ProductBase.pick({ id: true, erp_code: true, description: true, brand: true, line: true, unit: true, ean: true })
  .extend({
    thumbnail_url: z.string().nullable(),
    is_campaign: z.boolean(),
    price: PrecoVisivel.nullable(),
    availability: EstoqueVisivel.nullable(),
    /** RN-CAT-05: false = o perfil não vê preço de tabela nem estoque deste tenant. */
    price_stock_visible: z.boolean().default(true),
    /** Nota final do ranking (0..~1,3); só na busca. */
    score: z.number().optional(),
    /** RN-CAT-12: trecho "Serve em"; só na busca; nulo/ausente = a aplicação não contribuiu. */
    serve_em: TrechoBusca.nullable().optional(),
    /** RN-CAT-09: referência cruzada que casou com a consulta; só na busca. */
    equivale_a: EquivaleA.nullable().optional(),
  })
  .refine((i) => (i.price_stock_visible ? i.price !== null && i.availability !== null : i.price === null && i.availability === null), {
    message: 'Com preço e estoque visíveis, o item traz os dois; sem, não traz nenhum.',
    path: ['price_stock_visible'],
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
