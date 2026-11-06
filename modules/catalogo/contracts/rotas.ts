/**
 * Contratos das rotas do Catálogo (`/v1/catalogo`, T-0052): busca (inteligente e textual), vitrine, ficha, filtros e o
 * BKO de conteúdo (sinônimos, destaques, conteúdo da ficha e termos sem resultado). RF-CAT-01..03, RF-CAT-07;
 * RN-CAT-01, RN-CAT-03..07. Convenções de `busca.ts`: centavos inteiros, instantes ISO UTC, campos em snake_case.
 * As rotas GET recebem tudo como texto na query: os schemas `*Query` convertem número e booleano.
 */
import { z } from 'zod';
import { Id } from '@macuxi/core/contracts';
import { ConsultaBusca, InstanteUtc, ItemVitrine, Referencia, ResultadoBusca, Sinonimo } from './busca';

/** Booleano vindo da query (`true`/`false`/`1`/`0`); qualquer outro texto é inválido. */
export const BooleanoQuery = z.preprocess((v) => {
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return v;
}, z.boolean());

/** Até onde a lista pagina (a busca corta em 500 candidatos; ver `LIMITE_RESULTADOS_BUSCA` no domain). */
export const OFFSET_MAXIMO = 450;

// ---------- busca (GET /v1/catalogo/busca) ----------
/** Query de `GET /v1/catalogo/busca`: `ConsultaBusca` + paginação por deslocamento. */
export const ConsultaBuscaQuery = ConsultaBusca.extend({
  only_in_stock: BooleanoQuery.optional(),
  offset: z.coerce.number().int().min(0).max(OFFSET_MAXIMO).default(0),
});
export type ConsultaBuscaQuery = z.infer<typeof ConsultaBuscaQuery>;

/** Resposta da busca: `ResultadoBusca` + total de candidatos e o próximo deslocamento (nulo = acabou). */
export const RespostaBusca = ResultadoBusca.extend({
  total: z.number().int().min(0),
  next_offset: z.number().int().min(0).nullable(),
});
export type RespostaBusca = z.infer<typeof RespostaBusca>;

// ---------- vitrine (GET /v1/catalogo/produtos) ----------
export const ConsultaVitrineQuery = z.object({
  /** Cliente em contexto: define a tabela de preço (RN-CAT-06) e passa pelo escopo de carteira (RN-CORE-04). */
  customer_id: Id.optional(),
  line: z.string().trim().min(1).max(80).optional(),
  brand: z.string().trim().min(1).max(80).optional(),
  only_in_stock: BooleanoQuery.optional(),
  /** Só produtos de campanha/destaque. */
  campaign: BooleanoQuery.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(OFFSET_MAXIMO).default(0),
});
export type ConsultaVitrineQuery = z.infer<typeof ConsultaVitrineQuery>;

export const PaginaVitrine = z.object({
  items: z.array(ItemVitrine),
  total: z.number().int().min(0),
  next_offset: z.number().int().min(0).nullable(),
});
export type PaginaVitrine = z.infer<typeof PaginaVitrine>;

// ---------- filtros (GET /v1/catalogo/filtros) ----------
/** Vocabulário do tenant para os chips da tela (marcas e categorias/linhas cadastradas). */
export const FiltrosCatalogo = z.object({ brands: z.array(z.string()), lines: z.array(z.string()) });
export type FiltrosCatalogo = z.infer<typeof FiltrosCatalogo>;

// ---------- ficha (GET /v1/catalogo/produtos/:id) ----------
export const ParamsProduto = z.object({ id: Id });
export type ParamsProduto = z.infer<typeof ParamsProduto>;

export const ConsultaFichaQuery = z.object({ customer_id: Id.optional() });
export type ConsultaFichaQuery = z.infer<typeof ConsultaFichaQuery>;

/** Atributo técnico da ficha (ex.: "Volume" = "5 L"). */
export const AtributoProduto = z.object({ name: z.string().trim().min(1).max(60), value: z.string().trim().min(1).max(200) });
export type AtributoProduto = z.infer<typeof AtributoProduto>;

export const TipoMidia = z.enum(['foto', 'video', 'pdf']);
export type TipoMidia = z.infer<typeof TipoMidia>;

export const MidiaProduto = z.object({
  id: Id,
  type: TipoMidia,
  url: z.string().min(1),
  title: z.string().nullable(),
  order: z.number().int().min(0),
});
export type MidiaProduto = z.infer<typeof MidiaProduto>;

export const PerguntaFrequente = z.object({ question: z.string().trim().min(3).max(200), answer: z.string().trim().min(1).max(2000) });
export type PerguntaFrequente = z.infer<typeof PerguntaFrequente>;

/** Conteúdo comercial da ficha cadastrado no BKO (RF-CAT-07): texto, argumentos de venda e FAQ. */
export const ConteudoProduto = z.object({
  description: z.string().trim().max(4000).nullable().default(null),
  selling_points: z.array(z.string().trim().min(1).max(200).regex(/^[^\r\n]+$/, 'Cada argumento de venda deve ficar em uma linha só.')).max(10).default([]),
  faq: z.array(PerguntaFrequente).max(20).default([]),
  /**
   * RN-CAT-11: Aplicação (descrição 2), até 2.000 (a API recusa acima de `aplicacao_max_cadastro`: 422 `RN-CAT-11`).
   * Ausente no corpo do `PUT conteudo` = não altera; `null` = limpa.
   */
  aplicacao: z.string().trim().max(2000).nullable().optional(),
});
export type ConteudoProduto = z.infer<typeof ConteudoProduto>;

/** Produto que a ficha oferece junto (RN-CAT-09: até 5; relação `complementar`). */
export const OfereceJunto = z.object({ produto_id: Id, erp_code: z.string(), description: z.string() });
export type OfereceJunto = z.infer<typeof OfereceJunto>;

/** Seção Catálogo da ficha (T-0085 K8): promotor vê tudo, só leitura (RN-CAT-05 só esconde preço e estoque). */
export const CatalogoDaFicha = z.object({
  aplicacao: z.string().nullable(),
  referencias: z.array(Referencia).max(3),
  oferece_junto: z.array(OfereceJunto).max(5),
  etiquetas: z.array(z.string().max(20)).max(4),
});
export type CatalogoDaFicha = z.infer<typeof CatalogoDaFicha>;

/** Ficha rica (RF-CAT-03): o cartão da vitrine + atributos, mídias e conteúdo. Preço/estoque seguem o RN-CAT-05. */
export const FichaProduto = z.object({
  product: ItemVitrine,
  attributes: z.array(AtributoProduto),
  media: z.array(MidiaProduto),
  content: ConteudoProduto,
  /** Instante da última alteração do conteúdo (nulo = nunca enriquecido). */
  content_updated_at: InstanteUtc.nullable(),
  /** T-0084/T-0085: aplicação, referências, oferece junto e etiquetas (aditivo; ausente = servidor antigo). */
  catalogo: CatalogoDaFicha.optional(),
});
export type FichaProduto = z.infer<typeof FichaProduto>;

// ---------- BKO: sinônimos (GET/PUT/DELETE /v1/catalogo/sinonimos) ----------
export const ParamsSinonimo = z.object({ id: Id });
export type ParamsSinonimo = z.infer<typeof ParamsSinonimo>;

/** Corpo do `PUT /v1/catalogo/sinonimos/:id` (idempotente pelo `id`: cria ou substitui). */
export const SalvarSinonimo = z.object({
  term: z.string().trim().min(1, 'Informe o termo.').max(60, 'Use até 60 caracteres.'),
  synonyms: z.array(z.string().trim().min(1).max(60)).min(1, 'Informe ao menos um sinônimo.').max(20, 'Use até 20 sinônimos.'),
  active: z.boolean().default(true),
});
export type SalvarSinonimo = z.infer<typeof SalvarSinonimo>;

export const ListaSinonimos = z.object({ items: z.array(Sinonimo) });
export type ListaSinonimos = z.infer<typeof ListaSinonimos>;

// ---------- BKO: destaque e conteúdo ----------
/** Corpo do `PUT /v1/catalogo/produtos/:id/destaque` (RF-CAT-01: boost de campanha/destaque). */
export const SalvarDestaque = z.object({ is_campaign: z.boolean() });
export type SalvarDestaque = z.infer<typeof SalvarDestaque>;

/** Corpo do `PUT /v1/catalogo/produtos/:id/conteudo` (RF-CAT-07): substitui conteúdo e atributos do produto. */
export const SalvarConteudo = ConteudoProduto.extend({ attributes: z.array(AtributoProduto).max(30).default([]) });
export type SalvarConteudo = z.infer<typeof SalvarConteudo>;

/**
 * Corpo do `PUT /v1/catalogo/produtos/:id/cadastro-catalogo` (T-0085 K9; ação `produto.enriquecer`): substitui o conjunto
 * inteiro. Limites (RN-CAT-09: 3 referências, código até 30, oferece junto até 5) conferidos por `validarCadastroCatalogo`;
 * a forma aqui é larga de propósito para a API devolver 422 com a regra, não 400.
 */
export const SalvarCadastroCatalogo = z.object({
  aplicacao: z.string().nullable(),
  oferece_junto: z.array(Id).max(50),
  referencias: z.array(z.object({ marca_id: Id, codigo: z.string() })).max(20),
  etiquetas: z.array(z.string()).max(20),
});
export type SalvarCadastroCatalogo = z.infer<typeof SalvarCadastroCatalogo>;

/** Marcas concorrentes ativas (cadastro do Promotor) para o seletor da referência cruzada no BKO. */
export const ListaMarcasConcorrentes = z.object({ items: z.array(z.object({ id: Id, nome: z.string() })) });
export type ListaMarcasConcorrentes = z.infer<typeof ListaMarcasConcorrentes>;

/** Linha da exportação do catálogo (T-0085 K10): preço fora. */
export const LinhaExportacao = z.object({
  sistema: z.string(),
  grupo: z.string(),
  linha: z.string(),
  codigo: z.string(),
  descricao: z.string(),
  medida_embalagem: z.string(),
  aplicacao: z.string(),
  oferece_junto: z.array(z.string()),
  equivale_a: z.array(z.string()),
});
export type LinhaExportacao = z.infer<typeof LinhaExportacao>;

export const ConsultaExportacaoQuery = z.object({ no_id: Id.optional(), cursor: z.string().max(200).optional() });
export type ConsultaExportacaoQuery = z.infer<typeof ConsultaExportacaoQuery>;

export const PaginaExportacao = z.object({ itens: z.array(LinhaExportacao).max(1000), proximo_cursor: z.string().nullable() });
export type PaginaExportacao = z.infer<typeof PaginaExportacao>;

// ---------- BKO: termos buscados sem resultado (GET /v1/catalogo/termos-sem-resultado) ----------
export const ConsultaTermosQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ConsultaTermosQuery = z.infer<typeof ConsultaTermosQuery>;

export const TermoSemResultado = z.object({
  /** Termo normalizado (sem acento, caixa ou plural): o mesmo termo digitado de jeitos diferentes soma. */
  term: z.string(),
  count: z.number().int().min(1),
  last_searched_at: InstanteUtc,
});
export type TermoSemResultado = z.infer<typeof TermoSemResultado>;

export const ListaTermosSemResultado = z.object({ items: z.array(TermoSemResultado) });
export type ListaTermosSemResultado = z.infer<typeof ListaTermosSemResultado>;

/** Resposta das escritas do BKO (idempotentes): `criado` diz se a linha nasceu agora. */
export const RespostaEscrita = z.object({ id: Id, criado: z.boolean() });
export type RespostaEscrita = z.infer<typeof RespostaEscrita>;

/** Caminhos das rotas (relativos a `/v1/catalogo`), para a API, o app e o BKO usarem o mesmo texto. */
export const ROTAS_CATALOGO = {
  busca: 'busca',
  produtos: 'produtos',
  produto: 'produtos/:id',
  filtros: 'filtros',
  sinonimos: 'sinonimos',
  sinonimo: 'sinonimos/:id',
  destaque: 'produtos/:id/destaque',
  conteudo: 'produtos/:id/conteudo',
  termosSemResultado: 'termos-sem-resultado',
  cadastroCatalogo: 'produtos/:id/cadastro-catalogo',
  marcasConcorrentes: 'marcas-concorrentes',
  exportacao: 'exportacao',
} as const;

/** Caminho HTTP completo de uma rota do Catálogo (`/v1/catalogo/...`) com os parâmetros trocados. */
export function caminhoCatalogo(rota: keyof typeof ROTAS_CATALOGO, params: Record<string, string> = {}): string {
  const rel = ROTAS_CATALOGO[rota].replace(/:([a-z_]+)/g, (_m, k: string) => encodeURIComponent(params[k] ?? ''));
  return `/v1/catalogo/${rel}`;
}
