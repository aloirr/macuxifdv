/**
 * Teste de relevância (conjunto de consultas de referência): um catálogo pequeno e realista, 24 consultas e o
 * resultado esperado de cada uma, rodando o caminho completo SEM LLM (interpretar → sinônimos → ranking).
 * Mexeu em normalização, interpretação ou ranking e uma consulta mudou de resultado? Este teste mostra qual.
 * Ao descobrir um caso ruim em produção (termo buscado sem resultado, RF-CAT-07), acrescente-o aqui.
 */
import { describe, expect, it } from 'vitest';
import { interpretarConsulta } from './consulta';
import { PARAMETROS_PADRAO } from './parametros';
import { rankear as rankearBase } from './ranking';
const rankear = (docs, e) => rankearBase(docs, { anoAtual: 2026, ...e });
const d = (id, nome, marca, categoria, o = {}) => ({
    id,
    sku: id.toUpperCase(),
    ean: null,
    nome,
    marca,
    categoria,
    atributos: '',
    aplicacao: '',
    referencias: [],
    estoque: 20,
    vendas: 0,
    campanha: false,
    preco_cents: 1000,
    ...o,
});
const CATALOGO = [
    d('det-neutro-5l', 'Detergente Neutro 5 L', 'Limpex', 'Detergentes', { preco_cents: 2490, vendas: 90, ean: '7891000100103' }),
    d('det-neutro-500', 'Detergente Neutro 500 ml', 'Limpex', 'Detergentes', { preco_cents: 299, vendas: 300 }),
    d('det-coco-500', 'Detergente Coco 500 ml', 'Ypê', 'Detergentes', { preco_cents: 349, vendas: 120 }),
    d('det-maca-500', 'Detergente Maçã 500 ml', 'Ypê', 'Detergentes', { preco_cents: 329, estoque: 0 }),
    d('ama-brisa-2l', 'Amaciante Brisa 2 L', 'Limpex', 'Amaciantes', { preco_cents: 1590, vendas: 60 }),
    d('ama-lavanda-2l', 'Amaciante Lavanda 2 L', 'Dona Maria', 'Amaciantes', { preco_cents: 1390, vendas: 40 }),
    d('ama-conc-1l', 'Amaciante Concentrado 1 L', 'Ypê', 'Amaciantes', { preco_cents: 1190, campanha: true }),
    d('sab-po-1kg', 'Sabão em Pó 1 kg', 'Limpex', 'Sabão em pó', { preco_cents: 1290, vendas: 200 }),
    d('sab-po-2kg', 'Sabão em Pó 2 kg', 'Ypê', 'Sabão em pó', { preco_cents: 2390, vendas: 80 }),
    d('sab-liq-3l', 'Sabão Líquido 3 L', 'Dona Maria', 'Sabão líquido', { preco_cents: 3290, estoque: 3 }),
    d('agua-san-1l', 'Água Sanitária 1 L', 'Dona Maria', 'Alvejantes', { preco_cents: 450, vendas: 150 }),
    d('agua-san-2l', 'Água Sanitária 2 L', 'Limpex', 'Alvejantes', { preco_cents: 790 }),
    d('desinf-pinho', 'Desinfetante Pinho 2 L', 'Limpex', 'Desinfetantes', { preco_cents: 1090 }),
    d('desinf-lav', 'Desinfetante Lavanda 500 ml', 'Dona Maria', 'Desinfetantes', { preco_cents: 590 }),
    d('esponja-3', 'Esponja Multiuso 3 unidades', 'Limpex', 'Utensílios', { preco_cents: 499, vendas: 70 }),
    d('pano-chao', 'Pano de Chão Alvejado', 'Dona Maria', 'Utensílios', { preco_cents: 690 }),
    d('luva-m', 'Luva de Borracha M', 'Limpex', 'Utensílios', { preco_cents: 899, atributos: 'proteção para limpeza pesada' }),
    d('papel-12', 'Papel Higiênico Folha Dupla 12 rolos', 'Dona Maria', 'Papéis', { preco_cents: 1890, vendas: 110 }),
    d('papel-toalha', 'Papel Toalha 2 rolos', 'Ypê', 'Papéis', { preco_cents: 790 }),
    d('saco-lixo-50', 'Saco de Lixo 50 L 20 unidades', 'Limpex', 'Utensílios', { preco_cents: 1190 }),
    d('lava-louca-pastilha', 'Lava-louças em Pastilha 30 unidades', 'Limpex', 'Lava-louças', { preco_cents: 3490, estoque: 0 }),
    d('limpa-vidro', 'Limpa Vidros 500 ml', 'Ypê', 'Limpeza geral', { preco_cents: 790 }),
    d('multiuso', 'Limpador Multiuso 500 ml', 'Ypê', 'Limpeza geral', { preco_cents: 590, vendas: 90 }),
    d('cera-liq', 'Cera Líquida Incolor 750 ml', 'Dona Maria', 'Limpeza geral', { preco_cents: 1490 }),
];
const VOCAB = {
    marcas: ['Limpex', 'Ypê', 'Dona Maria'],
    linhas: ['Detergentes', 'Amaciantes', 'Sabão em pó', 'Sabão líquido', 'Alvejantes', 'Desinfetantes', 'Utensílios', 'Papéis', 'Lava-louças', 'Limpeza geral'],
};
const SINONIMOS = [
    { term: 'amaciante', synonyms: ['suavizante'], active: true },
    { term: 'água sanitária', synonyms: ['cloro', 'alvejante'], active: true },
    { term: 'lava roupas', synonyms: ['sabão em pó', 'sabão líquido'], active: true },
    { term: 'papel higiênico', synonyms: ['pH'], active: true },
];
const buscar = (q) => rankear(CATALOGO, { filtros: interpretarConsulta(q, VOCAB), sinonimos: SINONIMOS, parametros: PARAMETROS_PADRAO }).map((i) => i.doc.id);
const CASOS = [
    ['detergente neutro 5 litros com estoque', { primeiro: 'det-neutro-5l' }],
    ['detergente neutro 500ml', { primeiro: 'det-neutro-500' }],
    ['detergente neutro 0,5 l', { primeiro: 'det-neutro-500' }],
    ['detergentes', { fora: ['ama-brisa-2l', 'sab-po-1kg'] }],
    ['detergente com estoque', { fora: ['det-maca-500'] }],
    ['detergente sem estoque', { todos: ['det-maca-500'] }],
    ['detergente até R$ 3', { todos: ['det-neutro-500'] }],
    ['detergente entre 3 e 4 reais', { todos: ['det-coco-500', 'det-maca-500'] }],
    ['o mais barato da marca Ypê', { primeiro: 'det-maca-500', fora: ['det-neutro-5l'] }],
    ['detergente mais caro', { primeiro: 'det-neutro-5l' }],
    ['suavizante 2 litros', { topo: ['ama-brisa-2l', 'ama-lavanda-2l'] }],
    ['suavizante', { fora: ['det-coco-500'] }],
    ['amaciante dona maria', { primeiro: 'ama-lavanda-2l' }],
    ['cloro', { todos: ['agua-san-1l', 'agua-san-2l'] }],
    ['agua sanitaria 2l', { primeiro: 'agua-san-2l' }],
    ['sabao em po 1kg', { primeiro: 'sab-po-1kg' }],
    ['sabão em pó 2 quilos', { primeiro: 'sab-po-2kg' }],
    ['detregente coco', { primeiro: 'det-coco-500' }],
    ['amacinte brisa', { primeiro: 'ama-brisa-2l' }],
    ['7891000100103', { todos: ['det-neutro-5l'] }],
    ['DET-NEUTRO-500', { todos: ['det-neutro-500'] }],
    ['papel higienico', { primeiro: 'papel-12' }],
    ['luva proteção', { primeiro: 'luva-m' }],
    ['televisão 50 polegadas', { vazio: true }],
];
describe('relevância: consultas de referência com resultado esperado (RF-CAT-01, RF-CAT-02)', () => {
    it('o conjunto de referência tem pelo menos 20 consultas', () => {
        expect(CASOS.length).toBeGreaterThanOrEqual(20);
    });
    it.each(CASOS)('RF-CAT-02: "%s"', (consulta, esperado) => {
        const ids = buscar(consulta);
        if (esperado.vazio)
            expect(ids).toEqual([]);
        if (esperado.primeiro)
            expect(ids[0]).toBe(esperado.primeiro);
        if (esperado.topo)
            expect(ids.slice(0, esperado.topo.length).sort()).toEqual([...esperado.topo].sort());
        if (esperado.todos)
            expect([...ids].sort()).toEqual([...esperado.todos].sort());
        for (const f of esperado.fora ?? [])
            expect(ids).not.toContain(f);
    });
});
