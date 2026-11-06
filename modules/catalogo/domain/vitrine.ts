/**
 * Vitrine e busca do Catálogo (RF-CAT-01..03): monta o cartão do produto (cadastro base do Core + preço da tabela do
 * cliente + estoque das filiais do usuário), aplica quem vê o quê (RN-CAT-05) e roda o ranking (`rankear`) com
 * paginação. Função pura: a API usa com as linhas do Postgres; o app, com as linhas do SQLite (offline, RF-CAT-02).
 */
import type { Perfil } from '@macuxi/platform-sdk';
import type { AtributoProduto, EquivaleA, FiltrosInterpretados, ItemTabelaPreco, ItemVitrine, PrecoVisivel, Promocao, Referencia, StockByBranch } from '../contracts';
import type { VocabularioTenant } from './consulta';
import { estoqueVisivel } from './estoque';
import type { ParametrosCatalogo } from './parametros';
import { MENSAGEM_SEM_PRECO_CLIENTE, precoVisivel } from './preco';
import { rankear, type DocBusca } from './ranking';
import { trechoServeEm } from './serve-em';
import { chaveDeTermo, expandirSinonimos, type SinonimoDoTenant } from './texto';
import { filtrosParaPerfil, itemVitrineParaPerfil, podeVerPrecoEstoque } from './visibilidade';

/** Produto como o Catálogo o enxerga: cadastro base do Core (por `id`) + enriquecimento do Catálogo. */
export interface ProdutoCatalogo {
  id: string;
  sku: string;
  ean: string | null;
  nome: string;
  marca: string;
  categoria: string;
  unidade: string;
  ativo: boolean;
  /** Atributos técnicos (BKO/ERP); entram na busca com o menor peso. */
  atributos: readonly AtributoProduto[];
  /** RN-CAT-11: Aplicação (descrição 2); ausente = sem aplicação. */
  aplicacao?: string | null;
  /** RN-CAT-09: referências cruzadas ativas (marca inativa já fora); ausente = nenhuma. */
  referencias?: readonly Referencia[];
  thumbnail_url: string | null;
  /** Produto de campanha/destaque (boost na busca, RN-CAT-08). */
  campanha: boolean;
  /** Vendas recentes (qualquer escala; o ranking normaliza). */
  vendas: number;
}

/** Tudo o que define o preço e o estoque que o usuário vê agora. */
export interface ContextoVitrine {
  perfil: Perfil;
  parametros: ParametrosCatalogo;
  /** Instante da consulta (ISO UTC). */
  agora: string;
  /** Cliente em contexto (já conferido na carteira, RN-CORE-04); nulo = sem cliente. */
  clienteId: string | null;
  /** Tabela de preço ativa do cliente; nula = cliente sem tabela (ou sem cliente). */
  tabelaClienteId: string | null;
  /** Itens de tabela de preço dos produtos em jogo (da tabela do cliente; sem cliente, da padrão). */
  itensPreco: readonly ItemTabelaPreco[];
  promocoes: readonly Promocao[];
  /** Saldos por produto (todas as filiais; o domínio filtra pelas do usuário). */
  saldos: ReadonlyMap<string, readonly StockByBranch[]>;
  /** Filiais/depósitos do usuário; `null` = todas (escopo do tenant, RN-CORE-04). */
  filiais: readonly string[] | null;
}

/** RF-CAT-03: sem cliente em contexto não há tabela para mostrar (o tenant não tem tabela padrão). */
export const MENSAGEM_ESCOLHA_CLIENTE = 'Escolha o cliente para ver o preço da tabela dele.';

/** Teto de candidatos da busca (o app e a API cortam aqui; a tela pagina de 20 em 20). */
export const LIMITE_RESULTADOS_BUSCA = 500;

function semPreco(produtoId: string, aviso: string): PrecoVisivel {
  return { product_id: produtoId, price_cents: null, base_cents: null, on_promotion: false, promotion_id: null, promotion_ends_at: null, price_table_id: null, source: null, sellable: false, reason: 'sem_preco', notice: aviso };
}

function precoDoCartao(p: ProdutoCatalogo, ctx: ContextoVitrine): PrecoVisivel {
  // RN-CAT-06: cliente em contexto SEM tabela = nada vendável para ele; nunca a tabela padrão
  if (ctx.clienteId !== null && ctx.tabelaClienteId === null) return semPreco(p.id, MENSAGEM_SEM_PRECO_CLIENTE);
  const v = precoVisivel(p.id, ctx.itensPreco, ctx.promocoes, { agora: ctx.agora, tabela_cliente_id: ctx.clienteId === null ? null : ctx.tabelaClienteId });
  if (ctx.clienteId === null && !v.sellable) return { ...v, notice: MENSAGEM_ESCOLHA_CLIENTE };
  return v;
}

/**
 * Cartão do produto para o perfil (RF-CAT-03): preço da tabela do cliente (RN-CAT-06), estoque das filiais do usuário
 * em faixas com a hora da atualização (RN-CAT-07) e, para quem não vê, sem preço e sem estoque (RN-CAT-05).
 */
export function itemDaVitrine(p: ProdutoCatalogo, ctx: ContextoVitrine): ItemVitrine {
  const base = { id: p.id, erp_code: p.sku, description: p.nome, brand: p.marca, line: p.categoria, unit: p.unidade, ean: p.ean, thumbnail_url: p.thumbnail_url, is_campaign: p.campanha };
  if (!podeVerPrecoEstoque(ctx.perfil, ctx.parametros)) return { ...base, price: null, availability: null, price_stock_visible: false };
  const item: ItemVitrine = {
    ...base,
    price: precoDoCartao(p, ctx),
    availability: estoqueVisivel(p.id, ctx.saldos.get(p.id) ?? [], { filiais: ctx.filiais, agora: ctx.agora, parametros: ctx.parametros }),
    price_stock_visible: true,
  };
  return itemVitrineParaPerfil(item, ctx.perfil, ctx.parametros);
}

/**
 * Documento do ranking a partir do cartão já filtrado pelo perfil. RN-CAT-05: sem preço/estoque visíveis, entra com
 * estoque 0 e sem preço — os boosts e a ordem não revelam o que o cartão esconde. RN-CAT-07: com o número escondido, a
 * faixa basta (disponível/baixo = tem estoque).
 */
export function docDeBusca(p: ProdutoCatalogo, item: ItemVitrine): DocBusca {
  const a = item.availability;
  const estoque = a === null ? 0 : a.quantity !== null ? a.quantity : a.band === 'sem_estoque' ? 0 : 1;
  return {
    id: p.id,
    sku: p.sku,
    ean: p.ean,
    nome: p.nome,
    marca: p.marca,
    categoria: p.categoria,
    atributos: p.atributos.map((x) => `${x.name} ${x.value}`).join(' '),
    aplicacao: p.aplicacao ?? '',
    referencias: p.referencias ?? [],
    estoque,
    vendas: p.vendas,
    campanha: p.campanha,
    preco_cents: item.price?.price_cents ?? null,
  };
}

/** Filtros explícitos da tela (chips): somam aos interpretados da frase. */
export interface ChipsVitrine {
  line?: string;
  brand?: string;
  only_in_stock?: boolean;
  /** Só campanha/destaque (vitrine). */
  campaign?: boolean;
  /** RF-CAT-04: só estes produtos (os do nó da árvore escolhido e dos níveis abaixo). Conjunto vazio = nenhum. */
  only_product_ids?: ReadonlySet<string>;
  /** RN-CAT-06: dentro do pedido, só produtos com preço vigente na tabela do cliente. */
  only_sellable?: boolean;
}

/** RF-CAT-01: o chip da tela vence o que a frase disse (o usuário escolheu na hora). */
export function aplicarChips(f: FiltrosInterpretados, chips: ChipsVitrine): FiltrosInterpretados {
  return {
    ...f,
    line: chips.line?.trim() ? chips.line.trim() : f.line,
    brand: chips.brand?.trim() ? chips.brand.trim() : f.brand,
    stock: chips.only_in_stock ? 'com' : f.stock,
  };
}

export interface EntradaBuscaProdutos {
  produtos: readonly ProdutoCatalogo[];
  contexto: ContextoVitrine;
  /** Filtros da frase (`interpretarConsulta` ou `interpretarBusca`). */
  filtros: FiltrosInterpretados;
  chips?: ChipsVitrine;
  sinonimos: readonly SinonimoDoTenant[];
  /** Nota semântica 0..1 por produto (busca vetorial), quando houver. */
  semantica?: ReadonlyMap<string, number>;
  /** Ano civil no fuso do tenant (ADR 0015); padrão: ano UTC de `contexto.agora`. Expande as faixas da aplicação. */
  anoAtual?: number;
  limit: number;
  offset: number;
}

export interface PaginaProdutos {
  items: ItemVitrine[];
  /** Candidatos que passaram (até `LIMITE_RESULTADOS_BUSCA`). */
  total: number;
  /** Próximo deslocamento; nulo = acabou. */
  next_offset: number | null;
}

/**
 * Busca paginada (RF-CAT-01/02): só produtos ativos (RN-CAT-01), chips + frase, filtros limpos para o perfil
 * (RN-CAT-05), ranking híbrido com sinônimos (RN-CAT-08) e a nota de cada item.
 */
export function buscarProdutos(e: EntradaBuscaProdutos): PaginaProdutos {
  const ctx = e.contexto;
  const noArvore = e.chips?.only_product_ids;
  const ativos = e.produtos.filter((p) => p.ativo && !(e.chips?.campaign && !p.campanha) && (!noArvore || noArvore.has(p.id)));
  const itens = new Map<string, ItemVitrine>();
  const docs: DocBusca[] = [];
  for (const p of ativos) {
    const item = itemDaVitrine(p, ctx);
    if (e.chips?.only_sellable && !(item.price?.sellable ?? false)) continue;
    itens.set(p.id, item);
    docs.push(docDeBusca(p, item));
  }
  const filtros = filtrosParaPerfil(aplicarChips(e.filtros, e.chips ?? {}), ctx.perfil, ctx.parametros);
  const anoAtual = e.anoAtual ?? Number(ctx.agora.slice(0, 4));
  const ranking = rankear(docs, { filtros, sinonimos: e.sinonimos, parametros: ctx.parametros, anoAtual, ...(e.semantica ? { semantica: e.semantica } : {}) }).slice(0, LIMITE_RESULTADOS_BUSCA);
  const limit = Math.max(1, Math.trunc(e.limit));
  const offset = Math.max(0, Math.trunc(e.offset));
  const grupos = expandirSinonimos(filtros.text, e.sinonimos);
  const pagina = ranking.slice(offset, offset + limit).map((r) => {
    const serveEm = r.doc.aplicacao === '' ? null : trechoServeEm(r.doc.aplicacao, grupos, { anoAtual });
    const equivale = r.referencia_casada === null ? null : equivaleA(r.doc.referencias[r.referencia_casada]);
    return { ...itens.get(r.doc.id)!, score: r.nota, ...(serveEm ? { serve_em: serveEm } : {}), ...(equivale ? { equivale_a: equivale } : {}) };
  });
  return { items: pagina, total: ranking.length, next_offset: offset + limit < ranking.length ? offset + limit : null };
}

/** RN-CAT-09: 'Equivale a: <marca> <código>' com o código marcado. */
export function equivaleA(ref: Referencia | undefined): EquivaleA | null {
  if (!ref) return null;
  const ini = ref.marca_nome.length + 1;
  return { ...ref, marcas: [[ini, ini + ref.codigo.length]] };
}

const SEM_FILTRO: FiltrosInterpretados = { text: '', brand: null, line: null, min_price_cents: null, max_price_cents: null, stock: null, code: null, measures: [], sort: null };

/** Vitrine sem texto (RF-CAT-01): filtros dos chips; ordenam os boosts (RN-CAT-08) e desempata o nome. */
export function listarVitrine(e: Omit<EntradaBuscaProdutos, 'filtros' | 'semantica'>): PaginaProdutos {
  const r = buscarProdutos({ ...e, filtros: SEM_FILTRO });
  return { ...r, items: r.items.map(({ score: _s, ...i }) => i) };
}

/** RN-CAT-01: vocabulário do tenant (só produtos ativos) — o que pode virar filtro de marca e de categoria. */
export function vocabularioDe(produtos: readonly ProdutoCatalogo[]): VocabularioTenant {
  const unicos = (valores: string[]) => {
    const porChave = new Map<string, string>();
    // T-0052-B4: marcas e categorias se repetem em milhares de produtos; normaliza cada texto uma vez só
    for (const v of new Set(valores)) {
      const k = chaveDeTermo(v);
      if (k && !porChave.has(k)) porChave.set(k, v.trim());
    }
    return [...porChave.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  };
  const ativos = produtos.filter((p) => p.ativo);
  return { marcas: unicos(ativos.map((p) => p.marca)), linhas: unicos(ativos.map((p) => p.categoria)) };
}
