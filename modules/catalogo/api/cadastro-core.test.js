import { describe, expect, it } from 'vitest';
import { produtoDoCadastroCore } from './cadastro-core';
const base = { id: '11111111-1111-4111-8111-111111111111', sku: 'CAF-500', nome: 'Café 500 g', unidade: 'UN', ativo: true };
describe('cadastro do Core no Catálogo (T-0119: marca e categoria vazias na busca)', () => {
    it('RN-CAT-01: marca, categoria e EAN do cadastro do Core chegam ao produto do Catálogo', () => {
        const p = produtoDoCadastroCore({ ...base, marca: 'Aroma da Serra', categoria: 'Mercearia', ean: '7890000000017' });
        expect(p.marca).toBe('Aroma da Serra');
        expect(p.categoria).toBe('Mercearia');
        expect(p.ean).toBe('7890000000017');
    });
    it('RN-CAT-01: emissor antigo (campos ausentes ou nulos) vira texto vazio, sem quebrar', () => {
        expect(produtoDoCadastroCore(base)).toMatchObject({ marca: '', categoria: '', ean: null });
        expect(produtoDoCadastroCore({ ...base, marca: null, categoria: null, ean: null })).toMatchObject({ marca: '', categoria: '', ean: null });
    });
    it('RN-CAT-01: espaços sobrando no cadastro são aparados', () => {
        expect(produtoDoCadastroCore({ ...base, marca: '  Doce Vale ', categoria: ' ' }).marca).toBe('Doce Vale');
        expect(produtoDoCadastroCore({ ...base, categoria: ' ' }).categoria).toBe('');
    });
});
