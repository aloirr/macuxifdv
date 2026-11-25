import { describe, expect, it } from 'vitest';
import { DESCONTO_MAXIMO_PRODUTO_PADRAO_PCT, custoNaoInformado, descontoMaximoAplicavel, limiteDeDescontoSobreTabela, lucroCents, margemNoMinimoPct, margemPct, markupPct, precoFinalRespeitaMinimo, precoMinimoCents, produtoVendavel, } from './produto-preco';
describe('RN-CORE-18: margem, markup e lucro são calculados, nunca digitados', () => {
    it('RN-CORE-18: preço 100,00 e custo 60,00 dão margem 40%, markup 66,67% e lucro 40,00', () => {
        expect(margemPct(10_000, 6_000)).toBe(40);
        expect(markupPct(10_000, 6_000)).toBe(66.67);
        expect(lucroCents(10_000, 6_000)).toBe(4_000);
    });
    it('RN-CORE-18: custo zero dá margem 100%, lucro igual ao preço e markup indefinido (null)', () => {
        expect(margemPct(10_000, 0)).toBe(100);
        expect(lucroCents(10_000, 0)).toBe(10_000);
        expect(markupPct(10_000, 0)).toBeNull();
    });
    it('RN-CORE-18: custo maior que o preço dá margem, markup e lucro negativos', () => {
        expect(margemPct(10_000, 12_500)).toBe(-25);
        expect(markupPct(10_000, 12_500)).toBe(-20);
        expect(lucroCents(10_000, 12_500)).toBe(-2_500);
    });
    it('RN-CORE-18: produto sem preço de venda não tem margem e não é vendável; sem custo é vendável mas "custo não informado"', () => {
        expect(margemPct(0, 500)).toBeNull();
        expect(margemPct(null, 500)).toBeNull();
        expect(produtoVendavel({ preco_venda_cents: null })).toBe(false);
        expect(produtoVendavel({ preco_venda_cents: 0 })).toBe(false);
        expect(produtoVendavel({ preco_venda_cents: 1_000 })).toBe(true);
        expect(custoNaoInformado({ custo_cents: null })).toBe(true);
        expect(custoNaoInformado({ custo_cents: 0 })).toBe(false);
    });
    it('RN-CORE-18: sem custo informado não se calcula margem, markup nem lucro', () => {
        expect(margemPct(10_000, null)).toBeNull();
        expect(markupPct(10_000, null)).toBeNull();
        expect(lucroCents(10_000, null)).toBeNull();
    });
});
describe('RN-VEN-11: preço mínimo = preço de venda × (1 − desconto máximo aplicável)', () => {
    it('RN-VEN-11: o desconto do produto vale quando existe', () => {
        expect(descontoMaximoAplicavel(8)).toBe(8);
        expect(precoMinimoCents(10_000, 8)).toBe(9_200);
    });
    it('RN-VEN-11: produto sem desconto cadastrado usa o padrão desconto_maximo_produto_pct de 15%', () => {
        expect(DESCONTO_MAXIMO_PRODUTO_PADRAO_PCT).toBe(15);
        expect(descontoMaximoAplicavel(null)).toBe(15);
        expect(descontoMaximoAplicavel(undefined)).toBe(15);
        expect(precoMinimoCents(10_000, null)).toBe(8_500);
    });
    it('RN-VEN-11: o padrão do tenant substitui os 15% quando informado; desconto 0 do produto trava o preço de venda', () => {
        expect(precoMinimoCents(10_000, null, 10)).toBe(9_000);
        expect(precoMinimoCents(10_000, 0)).toBe(10_000);
    });
    it('RN-VEN-11: o preço mínimo arredonda para cima ao centavo e o desconto fora de 0 a 100 é rejeitado', () => {
        expect(precoMinimoCents(999, 15)).toBe(850); // 849,15 → 850
        expect(descontoMaximoAplicavel(120)).toBe(15);
        expect(descontoMaximoAplicavel(-1)).toBe(15);
    });
    it('RN-VEN-11: o preço final não pode ficar abaixo do mínimo', () => {
        expect(precoFinalRespeitaMinimo(8_500, 10_000, null)).toBe(true);
        expect(precoFinalRespeitaMinimo(8_499, 10_000, null)).toBe(false);
    });
    it('RN-VEN-11: o app trava o desconto no limite sobre o preço da tabela do cliente (mostra "Desconto máximo deste produto: X%")', () => {
        // tabela do cliente 90,00 e mínimo 85,00 → 5,56% de desconto possível sobre a tabela
        expect(limiteDeDescontoSobreTabela(9_000, 10_000, null)).toBe(5.55);
        // tabela abaixo do mínimo: nenhum desconto
        expect(limiteDeDescontoSobreTabela(8_000, 10_000, null)).toBe(0);
        // tabela igual ao preço de venda: o próprio desconto máximo
        expect(limiteDeDescontoSobreTabela(10_000, 10_000, null)).toBe(15);
    });
    it('RN-VEN-11: margem no preço mínimo mostra o quanto o desconto máximo consome da margem', () => {
        expect(margemNoMinimoPct(10_000, 6_000, null)).toBe(29.41); // (8.500 − 6.000) ÷ 8.500
        expect(margemNoMinimoPct(10_000, 9_000, null)).toBe(-5.88); // vender no mínimo dá prejuízo
        expect(margemNoMinimoPct(10_000, null, null)).toBeNull();
    });
});
