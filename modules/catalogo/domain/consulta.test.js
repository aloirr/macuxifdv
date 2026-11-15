import { describe, expect, it } from 'vitest';
import { gtinValido, interpretarConsulta } from './consulta';
const vocab = { marcas: ['Limpex', 'Dona Maria', 'Ypê'], linhas: ['Detergentes', 'Sabão em pó', 'Amaciantes'] };
const f = (q, v = vocab) => interpretarConsulta(q, v);
describe('RF-CAT-01: interpretação de consulta sem LLM (regras locais)', () => {
    it('RF-CAT-01: "detergente neutro 5 litros com estoque" → texto, medida e filtro de estoque', () => {
        expect(f('detergente neutro 5 litros com estoque')).toMatchObject({ text: 'detergente neutro 5000ml', stock: 'com', measures: ['5000ml'], brand: null, line: null });
    });
    it('RF-CAT-01: "o mais barato da marca Limpex para o cliente atual" → marca e ordenação por preço', () => {
        expect(f('o mais barato da marca Limpex para o cliente atual')).toMatchObject({ brand: 'Limpex', sort: 'preco_asc', text: '' });
    });
    it('RF-CAT-01: marca é reconhecida pelo vocabulário do tenant, com ou sem a palavra "marca", sem acento', () => {
        expect(f('amaciante limpex').brand).toBe('Limpex');
        expect(f('sabao ype 1kg').brand).toBe('Ypê');
        expect(f('azeite marca Dona Maria')).toMatchObject({ brand: 'Dona Maria', text: 'azeite' });
    });
    it('RN-CAT-01: marca fora do vocabulário do tenant não vira filtro', () => {
        expect(f('detergente marca Inventada').brand).toBeNull();
    });
    it('RF-CAT-01: categoria só vira filtro com a palavra de apoio ("categoria", "linha")', () => {
        expect(f('linha detergentes neutro')).toMatchObject({ line: 'Detergentes', text: 'neutro' });
        expect(f('da categoria sabão em pó')).toMatchObject({ line: 'Sabão em pó', text: '' });
        expect(f('detergente neutro').line).toBeNull();
    });
    it('RF-CAT-01: faixa de preço "até R$ 10" (centavos inteiros)', () => {
        expect(f('detergente até R$ 10')).toMatchObject({ max_price_cents: 1000, min_price_cents: null, text: 'detergente' });
        expect(f('detergente ate 10 reais').max_price_cents).toBe(1000);
        expect(f('abaixo de R$ 10,50').max_price_cents).toBe(1050);
        expect(f('no máximo 7,9').max_price_cents).toBe(790);
        expect(f('menos de R$ 1.299,90').max_price_cents).toBe(129990);
    });
    it('RF-CAT-01: "entre 5 e 10" e "de 5 a 10 reais" viram faixa; valores trocados são ordenados', () => {
        expect(f('entre 5 e 10')).toMatchObject({ min_price_cents: 500, max_price_cents: 1000, text: '' });
        expect(f('sabão entre R$ 5 e R$ 10')).toMatchObject({ min_price_cents: 500, max_price_cents: 1000, text: 'sabao' });
        expect(f('de 5 a 10 reais')).toMatchObject({ min_price_cents: 500, max_price_cents: 1000 });
        expect(f('entre 10 e 5')).toMatchObject({ min_price_cents: 500, max_price_cents: 1000 });
    });
    it('RF-CAT-01: preço mínimo ("acima de", "a partir de")', () => {
        expect(f('acima de R$ 20').min_price_cents).toBe(2000);
        expect(f('a partir de 20 reais').min_price_cents).toBe(2000);
        expect(f('acima de 5 até 10')).toMatchObject({ min_price_cents: 500, max_price_cents: 1000 });
    });
    it('RF-CAT-01: número seguido de unidade de medida ou embalagem não é preço', () => {
        expect(f('detergente até 5 litros')).toMatchObject({ max_price_cents: null, measures: ['5000ml'] });
        expect(f('sabão até 3 caixas').max_price_cents).toBeNull();
        expect(f('entre 5 e 10 litros').min_price_cents).toBeNull();
    });
    it('RF-CAT-01: valor solto com R$ e sem palavra de apoio não vira filtro, mas sai do texto', () => {
        expect(f('detergente R$ 10')).toMatchObject({ max_price_cents: null, min_price_cents: null, text: 'detergente' });
    });
    it('RF-CAT-01: estoque — "com estoque", "em estoque", "disponível" e "sem estoque"', () => {
        expect(f('detergente em estoque').stock).toBe('com');
        expect(f('detergente disponível').stock).toBe('com');
        expect(f('detergente sem estoque').stock).toBe('sem');
        expect(f('detergente esgotado').stock).toBe('sem');
        expect(f('detergente').stock).toBeNull();
    });
    it('RF-CAT-01: ordenação — "mais barato" e "mais caro"', () => {
        expect(f('detergente mais barato').sort).toBe('preco_asc');
        expect(f('o detergente de menor preço').sort).toBe('preco_asc');
        expect(f('detergente mais caro').sort).toBe('preco_desc');
    });
    it('RF-CAT-02: código EAN válido (dígito verificador) na consulta vira código exato', () => {
        expect(f('7891000100103')).toMatchObject({ code: { type: 'ean', value: '7891000100103' } });
        expect(f('detergente 7891000100103')).toMatchObject({ code: { type: 'ean', value: '7891000100103' }, text: 'detergente' });
    });
    it('RF-CAT-02: consulta de uma palavra só com cara de SKU/código vira candidato a SKU (caixa alta)', () => {
        expect(f('det-5l').code).toEqual({ type: 'sku', value: 'DET-5L' });
        expect(f('ABC123').code).toEqual({ type: 'sku', value: 'ABC123' });
        expect(f('1234').code).toEqual({ type: 'sku', value: '1234' });
    });
    it('RF-CAT-02: número com dígito verificador inválido é só candidato a SKU, não EAN', () => {
        expect(f('7891000100100').code).toEqual({ type: 'sku', value: '7891000100100' });
    });
    it('RF-CAT-02: medida, número curto e palavra comum não são código', () => {
        expect(f('2l').code).toBeNull();
        expect(f('500ml').code).toBeNull();
        expect(f('5').code).toBeNull();
        expect(f('detergente').code).toBeNull();
        expect(f('detergente 5 litros').code).toBeNull();
    });
    it('RF-CAT-01: consulta vazia devolve filtros vazios', () => {
        expect(f('   ')).toMatchObject({ text: '', brand: null, line: null, stock: null, code: null, measures: [], sort: null });
    });
    it('o resultado sempre cumpre o contrato FiltrosInterpretados', () => {
        expect(() => f('sabão entre 10 e 5 em estoque marca Limpex')).not.toThrow();
    });
    it('gtinValido confere o dígito verificador de EAN-8/12/13/14', () => {
        expect(gtinValido('7891000100103')).toBe(true);
        expect(gtinValido('7894900011517')).toBe(true);
        expect(gtinValido('7891000100104')).toBe(false);
        expect(gtinValido('12345')).toBe(false);
        expect(gtinValido('789100010010a')).toBe(false);
    });
});
