import { describe, expect, it } from 'vitest';
import { CONSULTA_PRODUTOS_POR_SKU, ProdutosPorSkuEntradaSchema, ProdutosPorSkuSaidaSchema } from './index';
describe('T-0174: contrato core.produtos_por_sku@1', () => {
    it('T-0174: a consulta se chama core.produtos_por_sku@1 e a entrada exige de 1 a 500 códigos de 1 a 100 caracteres, sem campo extra', () => {
        expect(CONSULTA_PRODUTOS_POR_SKU.nome).toBe('core.produtos_por_sku@1');
        expect(ProdutosPorSkuEntradaSchema.safeParse({ codigos: ['A1'] }).success).toBe(true);
        expect(ProdutosPorSkuEntradaSchema.safeParse({ codigos: [] }).success).toBe(false);
        expect(ProdutosPorSkuEntradaSchema.safeParse({ codigos: [''] }).success).toBe(false);
        expect(ProdutosPorSkuEntradaSchema.safeParse({ codigos: ['x'.repeat(101)] }).success).toBe(false);
        expect(ProdutosPorSkuEntradaSchema.safeParse({ codigos: Array.from({ length: 501 }, () => 'A') }).success).toBe(false);
        expect(ProdutosPorSkuEntradaSchema.safeParse({ codigos: ['A'], extra: 1 }).success).toBe(false);
    });
    it('T-0174: a saída traz id, sku, ean (ou nulo) e ativo', () => {
        const id = '0e630000-0000-4000-8000-000000000001';
        expect(ProdutosPorSkuSaidaSchema.parse({ produtos: [{ id, sku: 'A1', ean: null, ativo: false }] }).produtos[0].ativo).toBe(false);
        expect(ProdutosPorSkuSaidaSchema.safeParse({ produtos: [{ id, sku: 'A1', ativo: true }] }).success).toBe(false);
    });
});
