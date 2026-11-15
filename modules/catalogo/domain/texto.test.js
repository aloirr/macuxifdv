import { describe, expect, it } from 'vitest';
import { expandirSinonimos, normalizarTexto, tokensDeBusca } from './texto';
describe('RN-CAT-01 / RF-CAT-02: normalização do texto de busca', () => {
    it('RF-CAT-02: minúsculas, sem acento e sem pontuação', () => {
        expect(normalizarTexto('  Sabão EM Pó, Açaí!  ')).toBe('sabao em po acai');
    });
    it('RF-CAT-02: "2 L", "2lt", "2 litros" e "2000 ml" viram a mesma forma canônica', () => {
        const formas = ['2 L', '2lt', '2 litros', '2L', '2 Lts', '2000 ml', '2000ML'].map(normalizarTexto);
        expect(new Set(formas)).toEqual(new Set(['2000ml']));
    });
    it('RF-CAT-02: "500ml" e "0,5 l" são a mesma medida; ponto decimal também vale', () => {
        expect(normalizarTexto('500ml')).toBe('500ml');
        expect(normalizarTexto('0,5 l')).toBe('500ml');
        expect(normalizarTexto('0.5 litro')).toBe('500ml');
        expect(normalizarTexto('1,5l')).toBe('1500ml');
    });
    it('RF-CAT-02: ponto de milhar não vira decimal ("1.500 ml" = 1500 ml)', () => {
        expect(normalizarTexto('1.500 ml')).toBe('1500ml');
    });
    it('RF-CAT-02: peso — kg e g na mesma base (gramas)', () => {
        expect(normalizarTexto('1 kg')).toBe('1000g');
        expect(normalizarTexto('1,5 quilos')).toBe('1500g');
        expect(normalizarTexto('500 gramas')).toBe('500g');
        expect(normalizarTexto('500g')).toBe('500g');
    });
    it('RF-CAT-02: comprimento — m, cm e mm', () => {
        expect(normalizarTexto('2 metros')).toBe('200cm');
        expect(normalizarTexto('10 mm')).toBe('10mm');
    });
    it('RF-CAT-02: unidades de embalagem ganham forma única', () => {
        expect(normalizarTexto('12 unidades')).toBe('12un');
        expect(normalizarTexto('12 und')).toBe('12un');
        expect(normalizarTexto('cx 12')).toBe('cx 12');
        expect(normalizarTexto('caixa 12')).toBe('cx 12');
    });
    it('RF-CAT-02: número solto, sem unidade, não é alterado; "x" de multipack fica separado', () => {
        expect(normalizarTexto('12x500ml')).toBe('12 x 500ml');
        expect(normalizarTexto('pilha aa 4')).toBe('pilha aa 4');
    });
    it('RF-CAT-02: plural simples — a busca por "detergentes" acha "detergente"', () => {
        const t = (s) => tokensDeBusca(s);
        expect(t('detergentes')).toEqual(t('detergente'));
        expect(t('sabões')).toEqual(t('sabão'));
        expect(t('flores')).toEqual(t('flor'));
        expect(t('papéis')).toEqual(t('papel'));
        expect(t('pães')).toEqual(t('pão'));
    });
    it('RF-CAT-02: plural não mexe em medida nem em palavra curta', () => {
        expect(tokensDeBusca('2000ml gas')).toEqual(['2000ml', 'gas']);
    });
    it('RF-CAT-02: stopwords saem dos termos de busca, mas medidas e números ficam', () => {
        expect(tokensDeBusca('detergente de 5 litros para a cozinha')).toEqual(['detergente', '5000ml', 'cozinha']);
    });
    it('RF-CAT-02: texto vazio ou só pontuação não gera termos', () => {
        expect(tokensDeBusca('  ,, !! ')).toEqual([]);
        expect(normalizarTexto('')).toBe('');
    });
});
describe('RF-CAT-02: sinônimos do tenant', () => {
    const sin = [
        { id: 's1', term: 'Amaciante', synonyms: ['Suavizante'], active: true },
        { id: 's2', term: 'água sanitária', synonyms: ['cloro', 'alvejante'], active: true },
        { id: 's3', term: 'refri', synonyms: ['refrigerante'], active: false },
    ];
    it('RF-CAT-02: o termo e seus sinônimos entram como alternativas (nos dois sentidos)', () => {
        expect(expandirSinonimos('amaciante', sin)).toEqual([['amaciante', 'suavizante']]);
        expect(expandirSinonimos('suavizante', sin)).toEqual([['suavizante', 'amaciante']]);
    });
    it('RF-CAT-02: sinônimo de duas palavras casa como frase e consome as duas', () => {
        expect(expandirSinonimos('cloro 1 litro', sin)).toEqual([['cloro', 'agua sanitaria', 'alvejante'], ['1000ml']]);
        expect(expandirSinonimos('agua sanitaria 2l', sin)).toEqual([['agua sanitaria', 'alvejante', 'cloro'], ['2000ml']]);
    });
    it('RF-CAT-02: sinônimo com palavra de ligação ("pasta de dente", "sabão em pó") casa como frase, sem a stopword dos dois lados', () => {
        const s = [
            { term: 'creme dental', synonyms: ['pasta de dente'] },
            { term: 'sabão em pó', synonyms: ['lava-roupas'] },
        ];
        expect(expandirSinonimos('pasta de dente', s)).toEqual([['pasta dente', 'creme dental']]);
        expect(expandirSinonimos('lava roupas', s)).toEqual([['lava roupa', 'sabao po']]);
        expect(expandirSinonimos('sabão em pó 1 kg', s)).toEqual([['sabao po', 'lava roupa'], ['1000g']]);
    });
    it('RF-CAT-02: sinônimo inativo é ignorado', () => {
        expect(expandirSinonimos('refri', sin)).toEqual([['refri']]);
    });
    it('RF-CAT-02: sem sinônimo, cada termo é um grupo de uma alternativa; stopwords saem', () => {
        expect(expandirSinonimos('detergente neutro de coco', [])).toEqual([['detergente'], ['neutro'], ['coco']]);
    });
    it('RF-CAT-02: a ordem das alternativas é determinística (original primeiro, resto em ordem alfabética)', () => {
        const a = expandirSinonimos('alvejante', sin);
        expect(a).toEqual([['alvejante', 'agua sanitaria', 'cloro']]);
    });
});
