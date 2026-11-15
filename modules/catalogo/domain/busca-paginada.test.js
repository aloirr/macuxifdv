import { describe, expect, it } from 'vitest';
import { buscaPodeRodar, codigoExatoNoTopo, MINIMO_CARACTERES_BUSCA, paginaDaBusca, sugerirTermo, TAMANHO_PAGINA_BUSCA, TETO_RANKING_BUSCA } from './busca-consulta';
const p = (id, o = {}) => ({ id, sku: id.toUpperCase(), ean: null, nome: 'Produto', marca: '', categoria: '', unidade: 'UN', ativo: true, atributos: [], thumbnail_url: null, campanha: false, vendas: 0, ...o });
const item = (produto_id) => ({ produto_id, nota: 0.5, so_aplicacao: false, serve_em: null, equivale_a: null });
describe('RF-CAT-01: busca a partir de 3 caracteres', () => {
    it('RF-CAT-01: abaixo de 3 caracteres a consulta não roda (espaços não contam)', () => {
        expect(MINIMO_CARACTERES_BUSCA).toBe(3);
        expect(buscaPodeRodar('ab')).toBe(false);
        expect(buscaPodeRodar('  a b ')).toBe(false);
        expect(buscaPodeRodar('abc')).toBe(true);
        expect(buscaPodeRodar(' uno ')).toBe(true);
    });
});
describe('RF-CAT-01: paginação de 20 em 20 sobre a lista ranqueada uma vez', () => {
    it('RF-CAT-01: teto de 400 e página de 20', () => {
        expect(TAMANHO_PAGINA_BUSCA).toBe(20);
        expect(TETO_RANKING_BUSCA).toBe(400);
    });
    it('RF-CAT-01: "Mostrando 20 de 87" e o botão traz mais até acabar', () => {
        const a = paginaDaBusca(87, 1);
        expect(a).toEqual({ mostrando: 20, total: 87, temMais: true, rotulo: 'Mostrando 20 de 87' });
        expect(paginaDaBusca(87, 4)).toMatchObject({ mostrando: 80, temMais: true });
        expect(paginaDaBusca(87, 5)).toEqual({ mostrando: 87, total: 87, temMais: false, rotulo: 'Mostrando 87 de 87' });
        expect(paginaDaBusca(87, 99).mostrando).toBe(87);
    });
    it('RF-CAT-01: total acima do teto vale o teto; lista vazia não tem botão', () => {
        expect(paginaDaBusca(900, 1).total).toBe(400);
        expect(paginaDaBusca(0, 1)).toEqual({ mostrando: 0, total: 0, temMais: false, rotulo: 'Mostrando 0 de 0' });
    });
});
describe('RF-CAT-01: código exato no topo', () => {
    const produtos = [p('a', { sku: 'P-100' }), p('b', { ean: '7891234567895' }), p('c', { referencias: [{ marca_id: 'm', marca_nome: 'Cobreq', codigo: 'CB 1230' }] }), p('d')];
    it('RF-CAT-01: SKU idêntico ao texto vem em 1º, sem mexer na ordem do resto', () => {
        expect(codigoExatoNoTopo([item('d'), item('a'), item('c')], produtos, 'p100').map((i) => i.produto_id)).toEqual(['a', 'd', 'c']);
    });
    it('RF-CAT-01: EAN idêntico e código alternativo (referência) vêm em 1º', () => {
        expect(codigoExatoNoTopo([item('d'), item('b')], produtos, '7891234567895')[0].produto_id).toBe('b');
        expect(codigoExatoNoTopo([item('d'), item('c')], produtos, 'cb-1230')[0].produto_id).toBe('c');
    });
    it('RF-CAT-01: produto exato que o ranking não trouxe entra no topo', () => {
        expect(codigoExatoNoTopo([item('d')], produtos, 'P-100').map((i) => i.produto_id)).toEqual(['a', 'd']);
    });
    it('RF-CAT-01: texto que não é código não muda nada, e produto inativo não sobe', () => {
        const lista = [item('d'), item('a')];
        expect(codigoExatoNoTopo(lista, produtos, 'pastilha')).toEqual(lista);
        expect(codigoExatoNoTopo(lista, [...produtos.slice(1), p('a', { sku: 'P-100', ativo: false })], 'p100')).toEqual(lista);
    });
});
describe('RF-CAT-01: "Você quis dizer…" pelo vocabulário do índice', () => {
    const termos = new Map([['pastilha', 40], ['filtro', 30], ['correia', 12], ['amortecedor', 9], ['uno', 50]]);
    it('RF-CAT-01: troca a palavra mais próxima (um erro de digitação)', () => {
        expect(sugerirTermo('pastilla', termos)).toBe('pastilha');
        expect(sugerirTermo('filtor uno', termos)).toBe('filtro uno');
        expect(sugerirTermo('amortecedr', termos)).toBe('amortecedor');
    });
    it('RF-CAT-01: sem erro, sem termo parecido ou palavra curta, não sugere', () => {
        expect(sugerirTermo('pastilha', termos)).toBeNull();
        expect(sugerirTermo('xyzwkq', termos)).toBeNull();
        expect(sugerirTermo('un', termos)).toBeNull();
    });
    it('RF-CAT-01: no empate de distância vence o termo mais frequente', () => {
        expect(sugerirTermo('corria', new Map([['correia', 12], ['corrida', 80]]))).toBe('corrida');
    });
});
