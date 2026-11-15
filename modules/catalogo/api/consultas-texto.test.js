/**
 * RN-CAT-09: `catalogo.busca_produtos@1` na API acha pelo código do concorrente (lê `produto_referencia`), como o aparelho e a vitrine.
 * Banco falso por SQL; o ponta a ponta com Postgres é do agente testes.
 */
import { describe, expect, it } from 'vitest';
import { consultaBuscaProdutos } from './consultas-texto';
const PROD = '00000000-0000-4000-8000-000000000001';
const MARCA = '00000000-0000-4000-8000-000000000002';
const linha = { produto_id: PROD, sku: 'FO-100', ean: null, nome: 'Filtro de óleo', marca: 'Tecfil', categoria: 'Filtros', atributos: null, aplicacao: 'Gol 1.0', ativo: true };
function contexto(o = {}) {
    const consultas = [];
    const db = {
        query: async (sql) => {
            consultas.push(sql);
            if (/produto_busca/.test(sql))
                return { rows: [linha] };
            if (/produto_referencia/.test(sql))
                return { rows: o.referencias ?? [{ produto_id: PROD, marca_id: MARCA, marca_nome: 'Mann', codigo: 'W 712/75' }] };
            if (/marca_concorrente/.test(sql))
                return { rows: o.marcas ?? [] };
            return { rows: [] };
        },
    };
    return { consultas, ctx: { db, parametros: () => ({}), agora: () => new Date('2026-11-10T13:00:00Z'), fuso: () => 'America/Manaus' } };
}
const impl = consultaBuscaProdutos;
describe('RN-CAT-09: busca_produtos na API pelo código do concorrente', () => {
    it('RN-CAT-09: "w71275" acha o produto pela referência "Mann W 712/75" e devolve o Equivale a', async () => {
        const r = await impl.executar({ q: 'w71275', limite: 100 }, contexto().ctx);
        expect(r.itens.map((i) => i.produto_id)).toEqual([PROD]);
        expect(r.itens[0].equivale_a).toMatchObject({ marca_nome: 'Mann', codigo: 'W 712/75' });
    });
    it('RN-CAT-09: o nome vem do cadastro de marcas concorrentes quando a marca existe; marca inativa esconde a referência', async () => {
        const ativa = await impl.executar({ q: 'w71275', limite: 100 }, contexto({ marcas: [{ id: MARCA, nome: 'Mann-Filter', ativo: true }] }).ctx);
        expect(ativa.itens[0].equivale_a).toMatchObject({ marca_nome: 'Mann-Filter' });
        const inativa = await impl.executar({ q: 'w71275', limite: 100 }, contexto({ marcas: [{ id: MARCA, nome: 'Mann-Filter', ativo: false }] }).ctx);
        expect(inativa.itens).toEqual([]);
    });
    it('RN-CAT-09: com produto_ids a leitura das referências é restrita a eles (não varre o cadastro todo)', async () => {
        const { ctx, consultas } = contexto();
        await impl.executar({ q: 'filtro', limite: 10, produto_ids: [PROD] }, ctx);
        expect(consultas.filter((s) => /produto_referencia/.test(s)).every((s) => /any\(\$1::uuid\[\]\)/.test(s))).toBe(true);
    });
});
