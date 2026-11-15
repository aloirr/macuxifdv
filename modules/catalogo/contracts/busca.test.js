import { describe, expect, it } from 'vitest';
import { ConsultaBusca, EstoqueVisivel, FiltrosInterpretados, ItemVitrine, ParametrosCatalogo, PerguntaCatalogo, PrecoVisivel, RespostaCatalogo, ResultadoBusca, Sinonimo, } from './busca';
const preco = {
    product_id: 'p1',
    price_cents: 1590,
    base_cents: 1590,
    on_promotion: false,
    promotion_id: null,
    promotion_ends_at: null,
    price_table_id: 't1',
    source: 'cliente',
    sellable: true,
    reason: null,
};
const estoque = { product_id: 'p1', band: 'disponivel', quantity: 40, by_branch: [], updated_at: '2026-10-31T12:00:00Z', stale: false };
const item = {
    id: 'p1',
    erp_code: 'DET-5L',
    description: 'Detergente neutro 5 L',
    brand: 'Limpex',
    line: 'Detergentes',
    unit: 'UN',
    thumbnail_url: null,
    is_campaign: false,
    price: preco,
    availability: estoque,
};
describe('contracts da busca e da vitrine (RF-CAT-01..05)', () => {
    it('RN-VEN-01: preço visível em centavos inteiros; sem preço não é vendável', () => {
        expect(PrecoVisivel.safeParse(preco).success).toBe(true);
        expect(PrecoVisivel.safeParse({ ...preco, price_cents: 15.9 }).success).toBe(false);
        expect(PrecoVisivel.safeParse({ ...preco, price_cents: null }).success).toBe(false);
        expect(PrecoVisivel.safeParse({ ...preco, price_cents: null, base_cents: null, sellable: false, reason: 'sem_preco', source: null }).success).toBe(true);
    });
    it('RF-CAT-03: estoque visível aceita só instantes ISO UTC e faixas conhecidas', () => {
        expect(EstoqueVisivel.safeParse(estoque).success).toBe(true);
        expect(EstoqueVisivel.safeParse({ ...estoque, updated_at: '31/10/2026' }).success).toBe(false);
        expect(EstoqueVisivel.safeParse({ ...estoque, band: 'muito' }).success).toBe(false);
        expect(EstoqueVisivel.safeParse({ ...estoque, quantity: null }).success).toBe(true);
    });
    it('RF-CAT-01: item de vitrine = cadastro base do Core + preço e estoque visíveis', () => {
        expect(ItemVitrine.parse(item).price?.price_cents).toBe(1590);
        expect(ItemVitrine.parse(item).price_stock_visible).toBe(true);
        expect(ItemVitrine.safeParse({ ...item, availability: undefined }).success).toBe(false);
    });
    it('RN-CAT-05: item sem preço e estoque visíveis (promotor) traz os dois nulos; nunca só um deles', () => {
        expect(ItemVitrine.safeParse({ ...item, price: null, availability: null, price_stock_visible: false }).success).toBe(true);
        expect(ItemVitrine.safeParse({ ...item, price: null, availability: estoque, price_stock_visible: false }).success).toBe(false);
        expect(ItemVitrine.safeParse({ ...item, price: null, availability: null }).success).toBe(false);
    });
    it('RN-CAT-05: o promotor não vê preço e estoque por padrão (parâmetro do tenant)', () => {
        expect(ParametrosCatalogo.parse({}).promotor_ve_preco_estoque).toBe(false);
        expect(ParametrosCatalogo.parse({ promotor_ve_preco_estoque: true }).promotor_ve_preco_estoque).toBe(true);
    });
    it('RF-CAT-01: filtros interpretados têm padrão vazio e recusam faixa de preço invertida', () => {
        const f = FiltrosInterpretados.parse({});
        expect(f).toMatchObject({ text: '', brand: null, line: null, stock: null, code: null, measures: [], sort: null });
        expect(FiltrosInterpretados.safeParse({ min_price_cents: 1000, max_price_cents: 500 }).success).toBe(false);
        expect(FiltrosInterpretados.safeParse({ max_price_cents: 1000.5 }).success).toBe(false);
        expect(FiltrosInterpretados.safeParse({ stock: 'talvez' }).success).toBe(false);
    });
    it('consulta de busca: texto obrigatório, limite padrão 20 e máximo 50', () => {
        expect(ConsultaBusca.parse({ q: ' detergente ' })).toMatchObject({ q: 'detergente', limit: 20, mode: 'inteligente' });
        expect(ConsultaBusca.safeParse({ q: '   ' }).success).toBe(false);
        expect(ConsultaBusca.safeParse({ q: 'x', limit: 51 }).success).toBe(false);
        expect(ConsultaBusca.parse({ q: 'x', limit: '5' }).limit).toBe(5);
    });
    it('RF-CAT-02: resultado marca busca degradada com aviso discreto', () => {
        const r = ResultadoBusca.parse({
            items: [item],
            filters: {},
            interpreted_by: 'nenhum',
            degraded: true,
            notice: 'A busca inteligente volta quando houver internet.',
            from_cache: false,
            remaining_ai_queries: null,
        });
        expect(r.degraded).toBe(true);
    });
    it('RF-CAT-07: sinônimo exige termo e ao menos um equivalente', () => {
        expect(Sinonimo.parse({ id: 's1', term: 'amaciante', synonyms: ['suavizante'] }).active).toBe(true);
        expect(Sinonimo.safeParse({ id: 's1', term: 'amaciante', synonyms: [] }).success).toBe(false);
        expect(Sinonimo.safeParse({ id: 's1', term: ' ', synonyms: ['x'] }).success).toBe(false);
    });
    it('RN-CAT-02: resposta encontrada exige fonte; "não encontrei" não leva fonte', () => {
        const fonte = { id: 'f1', type: 'faq', title: 'Validade', product_id: 'p1' };
        expect(RespostaCatalogo.safeParse({ found: true, answer: 'Dura 24 meses.', sources: [fonte] }).success).toBe(true);
        expect(RespostaCatalogo.safeParse({ found: true, answer: 'Dura 24 meses.', sources: [] }).success).toBe(false);
        expect(RespostaCatalogo.safeParse({ found: false, answer: 'Não encontrei na base.', sources: [] }).success).toBe(true);
        expect(RespostaCatalogo.safeParse({ found: false, answer: 'Não encontrei na base.', sources: [fonte] }).success).toBe(false);
    });
    it('RN-CAT-02: pergunta tem tamanho mínimo e máximo', () => {
        expect(PerguntaCatalogo.safeParse({ question: 'ok' }).success).toBe(false);
        expect(PerguntaCatalogo.safeParse({ question: 'Qual a validade?' }).success).toBe(true);
        expect(PerguntaCatalogo.safeParse({ question: 'a'.repeat(501) }).success).toBe(false);
    });
    it('RN-CAT-03: parâmetros do tenant têm os padrões do doc 03 e recusam campo desconhecido', () => {
        const p = ParametrosCatalogo.parse({});
        expect(p.limite_consultas_ia_dia).toBe(200);
        expect(p).not.toHaveProperty('fuso'); // o fuso é do tenant (plataforma.tenant.fuso), não parâmetro do módulo
        expect(ParametrosCatalogo.safeParse({ limite_consultas_ia_dia: -1 }).success).toBe(false);
        expect(ParametrosCatalogo.safeParse({ inventado: 1 }).success).toBe(false);
    });
});
describe('ConteudoProduto — argumentos de venda (T-0052 🟢8)', () => {
    it('RF-CAT-07: argumento de venda com quebra de linha é recusado (o repositório guarda um por linha)', async () => {
        const { ConteudoProduto } = await import('./rotas');
        expect(ConteudoProduto.safeParse({ selling_points: ['Giro alto\nMargem boa'] }).success).toBe(false);
        expect(ConteudoProduto.safeParse({ selling_points: ['Giro alto', 'Margem boa'] }).success).toBe(true);
    });
});
