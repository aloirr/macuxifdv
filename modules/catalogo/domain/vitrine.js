/**
 * Vitrine e busca do Catálogo (RF-CAT-01..03): monta o cartão do produto (cadastro base do Core + preço da tabela do
 * cliente + estoque das filiais do usuário), aplica quem vê o quê (RN-CAT-05) e roda o ranking (`rankear`) com
 * paginação. Função pura: a API usa com as linhas do Postgres; o app, com as linhas do SQLite (offline, RF-CAT-02).
 */
import { anoCivilNoFuso } from './ano-civil';
import { estoqueVisivel } from './estoque';
import { MENSAGEM_SEM_PRECO_CLIENTE, precoVisivel } from './preco';
import { rankear, TOKENS_DO_PRODUTO } from './ranking';
import { trechoServeEm } from './serve-em';
import { chaveDeTermo, expandirSinonimos } from './texto';
import { filtrosParaPerfil, itemVitrineParaPerfil, podeVerPrecoEstoque } from './visibilidade';
/** RN-VEN-01 (T-0173): sem cliente vale a tabela da filial padrão; produto sem preço nela mostra só "Sem preço". */
export const MENSAGEM_SEM_PRECO_CATALOGO = 'Sem preço';
/** Teto de candidatos da busca (o app e a API cortam aqui; a tela pagina de 20 em 20). */
export const LIMITE_RESULTADOS_BUSCA = 500;
function semPreco(produtoId, aviso) {
    return { product_id: produtoId, price_cents: null, base_cents: null, on_promotion: false, promotion_id: null, promotion_ends_at: null, price_table_id: null, source: null, sellable: false, reason: 'sem_preco', notice: aviso };
}
function precoDoCartao(p, ctx) {
    // RN-CAT-06: cliente em contexto SEM tabela = nada vendável para ele; nunca a tabela padrão
    if (ctx.clienteId !== null && ctx.tabelaClienteId === null)
        return semPreco(p.id, MENSAGEM_SEM_PRECO_CLIENTE);
    const v = precoVisivel(p.id, ctx.itensPreco, ctx.promocoes, { agora: ctx.agora, tabela_cliente_id: ctx.clienteId === null ? null : ctx.tabelaClienteId });
    if (ctx.clienteId === null && !v.sellable)
        return { ...v, notice: MENSAGEM_SEM_PRECO_CATALOGO };
    return v;
}
/**
 * Cartão do produto para o perfil (RF-CAT-03): preço da tabela do cliente (RN-CAT-06), estoque das filiais do usuário
 * em faixas com a hora da atualização (RN-CAT-07) e, para quem não vê, sem preço e sem estoque (RN-CAT-05).
 */
export function itemDaVitrine(p, ctx) {
    const base = { id: p.id, erp_code: p.sku, description: p.nome, brand: p.marca, line: p.categoria, unit: p.unidade, ean: p.ean, thumbnail_url: p.thumbnail_url, is_campaign: p.campanha };
    if (!podeVerPrecoEstoque(ctx.perfil, ctx.parametros))
        return { ...base, price: null, availability: null, price_stock_visible: false };
    const item = {
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
export function docDeBusca(p, item) {
    const estoque = estoqueDeBusca(item);
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
        preco_cents: item?.price?.price_cents ?? null,
        // T-0119: termos preparados na carga do índice (a busca do servidor não normaliza o produto de novo a cada consulta)
        tokens: TOKENS_DO_PRODUTO.get(p),
    };
}
/** Estoque que o ranking enxerga (RN-CAT-05/07): o número, ou 0/1 pela faixa quando o número está escondido. */
export function estoqueDeBusca(item) {
    const a = item?.availability ?? null;
    return a === null ? 0 : a.quantity !== null ? a.quantity : a.band === 'sem_estoque' ? 0 : 1;
}
/**
 * O produto tem estoque para o ranking (`estoque > 0` do `docDeBusca`) sem montar o cartão nem ordenar filiais: soma as filiais
 * do usuário (RN-CAT-07) e só diz se passa de zero. Quem não vê estoque (RN-CAT-05) nunca tem. O corte de candidatos usa só isto.
 */
export function temEstoqueParaBusca(p, ctx) {
    if (!podeVerPrecoEstoque(ctx.perfil, ctx.parametros))
        return false;
    const filiais = ctx.filiais === null ? null : new Set(ctx.filiais);
    for (const s of ctx.saldos.get(p.id) ?? []) {
        if (filiais && !filiais.has(s.branch_id))
            continue;
        if (Number.isFinite(s.quantity) && Math.trunc(s.quantity) > 0)
            return true;
    }
    return false;
}
/** RN-CAT-01 + chips: o produto entra na busca (ativo, campanha e nó da árvore escolhidos). Usado pela busca e pelo índice. */
export function entraNaVitrine(p, chips) {
    return p.ativo && !(chips?.campaign && !p.campanha) && (!chips?.only_product_ids || chips.only_product_ids.has(p.id));
}
/** RF-CAT-01: o chip da tela vence o que a frase disse (o usuário escolheu na hora). */
export function aplicarChips(f, chips) {
    return {
        ...f,
        line: chips.line?.trim() ? chips.line.trim() : f.line,
        brand: chips.brand?.trim() ? chips.brand.trim() : f.brand,
        stock: chips.only_in_stock ? 'com' : f.stock,
    };
}
/**
 * Busca paginada (RF-CAT-01/02): só produtos ativos (RN-CAT-01), chips + frase, filtros limpos para o perfil
 * (RN-CAT-05), ranking híbrido com sinônimos (RN-CAT-08) e a nota de cada item.
 */
export function buscarProdutos(e) {
    const ctx = e.contexto;
    const ativos = e.produtos.filter((p) => entraNaVitrine(p, e.chips));
    const itens = new Map();
    const docs = [];
    for (const p of ativos) {
        const item = itemDaVitrine(p, ctx);
        if (e.chips?.only_sellable && !(item.price?.sellable ?? false))
            continue;
        itens.set(p.id, item);
        docs.push(docDeBusca(p, item));
    }
    const filtros = filtrosParaPerfil(aplicarChips(e.filtros, e.chips ?? {}), ctx.perfil, ctx.parametros);
    const anoAtual = e.anoAtual ?? anoCivilNoFuso(ctx.agora, e.fuso);
    const ranking = rankear(docs, { filtros, sinonimos: e.sinonimos, parametros: ctx.parametros, anoAtual, ...(e.semantica ? { semantica: e.semantica } : {}), ...(e.maxVendas !== undefined ? { maxVendas: e.maxVendas } : {}) }).slice(0, LIMITE_RESULTADOS_BUSCA);
    const limit = Math.max(1, Math.trunc(e.limit));
    const offset = Math.max(0, Math.trunc(e.offset));
    const grupos = expandirSinonimos(filtros.text, e.sinonimos);
    const pagina = ranking.slice(offset, offset + limit).map((r) => {
        const serveEm = r.doc.aplicacao === '' ? null : trechoServeEm(r.doc.aplicacao, grupos, { anoAtual });
        const equivale = r.referencia_casada === null ? null : equivaleA(r.doc.referencias[r.referencia_casada]);
        return { ...itens.get(r.doc.id), score: r.nota, ...(serveEm ? { serve_em: serveEm } : {}), ...(equivale ? { equivale_a: equivale } : {}) };
    });
    return { items: pagina, total: ranking.length, next_offset: offset + limit < ranking.length ? offset + limit : null };
}
/** RN-CAT-09: 'Equivale a: <marca> <código>' com o código marcado. */
export function equivaleA(ref) {
    if (!ref)
        return null;
    const ini = ref.marca_nome.length + 1;
    return { ...ref, marcas: [[ini, ini + ref.codigo.length]] };
}
const SEM_FILTRO = { text: '', brand: null, line: null, min_price_cents: null, max_price_cents: null, stock: null, code: null, measures: [], sort: null };
/** Vitrine sem texto (RF-CAT-01): filtros dos chips; ordenam os boosts (RN-CAT-08) e desempata o nome. */
export function listarVitrine(e) {
    const r = buscarProdutos({ ...e, filtros: SEM_FILTRO });
    return { ...r, items: r.items.map(({ score: _s, ...i }) => i) };
}
/** RN-CAT-01: vocabulário do tenant (só produtos ativos) — o que pode virar filtro de marca e de categoria. */
export function vocabularioDe(produtos) {
    const unicos = (valores) => {
        const porChave = new Map();
        // T-0052-B4: marcas e categorias se repetem em milhares de produtos; normaliza cada texto uma vez só
        for (const v of new Set(valores)) {
            const k = chaveDeTermo(v);
            if (k && !porChave.has(k))
                porChave.set(k, v.trim());
        }
        return [...porChave.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    };
    const ativos = produtos.filter((p) => p.ativo);
    return { marcas: unicos(ativos.map((p) => p.marca)), linhas: unicos(ativos.map((p) => p.categoria)) };
}
