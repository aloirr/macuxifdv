import { describe, expect, it } from 'vitest';
import { decidirApagarMedida, decidirTrocaDeSigla, EMBALAGEM_QUANTIDADE_MAX, EMBALAGEM_QUANTIDADE_MIN, normalizarSigla, podeUsarMedida, reconciliarEmbalagemComErp, validarMedida, validarMedidasDoProduto } from './medida';
const medidas = new Map([
    ['UN', { ativo: true }],
    ['CX', { ativo: true }],
    ['DP', { ativo: false }],
]);
describe('RN-CORE-19: sigla e descrição da medida', () => {
    it('RN-CORE-19: a sigla é aparada e vai para maiúsculas', () => {
        expect(normalizarSigla('  cx ')).toBe('CX');
        expect(validarMedida({ sigla: ' pct ', descricao: ' Pacote ' })).toEqual({ ok: true, medida: { sigla: 'PCT', descricao: 'Pacote' } });
    });
    it('RN-CORE-19: sigla de 1 a 4 letras; vazia, longa, com número, espaço ou acento é recusada (MEDIDA_INVALIDA)', () => {
        for (const sigla of ['', '   ', 'CAIXA', 'C1', 'C X', 'DÚZ', 'U-N', '1']) {
            const r = validarMedida({ sigla, descricao: 'Qualquer' });
            expect(r, sigla).toMatchObject({ ok: false, codigo: 'MEDIDA_INVALIDA' });
        }
        expect(validarMedida({ sigla: 'u', descricao: 'Um' }).ok).toBe(true);
        expect(validarMedida({ sigla: 'ABCD', descricao: 'Quatro' }).ok).toBe(true);
    });
    it('RN-CORE-19: a descrição é obrigatória e tem até 40 caracteres', () => {
        expect(validarMedida({ sigla: 'UN', descricao: '   ' })).toMatchObject({ ok: false, codigo: 'MEDIDA_INVALIDA' });
        expect(validarMedida({ sigla: 'UN', descricao: 'x'.repeat(41) })).toMatchObject({ ok: false, codigo: 'MEDIDA_INVALIDA' });
        expect(validarMedida({ sigla: 'UN', descricao: 'x'.repeat(40) }).ok).toBe(true);
    });
    it('RN-CORE-19: a mensagem de erro é em português e diz o que fazer', () => {
        const r = validarMedida({ sigla: 'CAIXA', descricao: 'Caixa' });
        expect(r.ok).toBe(false);
        if (!r.ok)
            expect(r.mensagem).toMatch(/1 a 4 letras/);
    });
});
describe('RN-CORE-19: medida inativa não entra em produto novo', () => {
    it('RN-CORE-19: só a medida cadastrada e ativa pode ser usada', () => {
        expect(podeUsarMedida({ ativo: true })).toBe(true);
        expect(podeUsarMedida({ ativo: false })).toBe(false);
        expect(podeUsarMedida(undefined)).toBe(false);
        expect(podeUsarMedida(null)).toBe(false);
    });
});
describe('RN-CORE-19: medida da unidade e embalagem do produto', () => {
    it('RN-CORE-19: unidade obrigatória, cadastrada e ativa', () => {
        expect(validarMedidasDoProduto({ unidade: 'UN' }, medidas)).toEqual({ ok: true, valor: { unidade: 'UN', embalagem_medida: null, embalagem_quantidade: null } });
        expect(validarMedidasDoProduto({ unidade: ' ' }, medidas)).toMatchObject({ ok: false, codigo: 'MEDIDA_INVALIDA' });
        expect(validarMedidasDoProduto({ unidade: 'ZZ' }, medidas)).toMatchObject({ ok: false, codigo: 'MEDIDA_NAO_CADASTRADA' });
        expect(validarMedidasDoProduto({ unidade: 'DP' }, medidas)).toMatchObject({ ok: false, codigo: 'MEDIDA_INATIVA' });
    });
    it('RN-CORE-19: a sigla é normalizada antes de conferir', () => {
        expect(validarMedidasDoProduto({ unidade: ' un ', embalagem_medida: 'cx', embalagem_quantidade: 12 }, medidas)).toEqual({
            ok: true,
            valor: { unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: 12 },
        });
    });
    it('RN-CORE-19: embalagem é tudo ou nada (medida e quantidade juntas)', () => {
        expect(validarMedidasDoProduto({ unidade: 'UN', embalagem_medida: 'CX' }, medidas)).toMatchObject({ ok: false, codigo: 'EMBALAGEM_INCOMPLETA' });
        expect(validarMedidasDoProduto({ unidade: 'UN', embalagem_quantidade: 12 }, medidas)).toMatchObject({ ok: false, codigo: 'EMBALAGEM_INCOMPLETA' });
        expect(validarMedidasDoProduto({ unidade: 'UN', embalagem_medida: null, embalagem_quantidade: null }, medidas).ok).toBe(true);
    });
    it('RN-CORE-19: a quantidade da embalagem é inteira e maior que 1', () => {
        for (const q of [1, 0, -3, 2.5, Number.NaN]) {
            expect(validarMedidasDoProduto({ unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: q }, medidas), String(q)).toMatchObject({ ok: false, codigo: 'EMBALAGEM_INVALIDA' });
        }
        expect(validarMedidasDoProduto({ unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: 2 }, medidas).ok).toBe(true);
    });
    it('RN-CORE-19: a embalagem não pode ter a mesma medida da unidade', () => {
        expect(validarMedidasDoProduto({ unidade: 'UN', embalagem_medida: 'UN', embalagem_quantidade: 6 }, medidas)).toMatchObject({ ok: false, codigo: 'EMBALAGEM_INVALIDA' });
    });
    it('RN-CORE-19: a embalagem também exige medida cadastrada e ativa', () => {
        expect(validarMedidasDoProduto({ unidade: 'UN', embalagem_medida: 'ZZ', embalagem_quantidade: 6 }, medidas)).toMatchObject({ ok: false, codigo: 'MEDIDA_NAO_CADASTRADA' });
        expect(validarMedidasDoProduto({ unidade: 'UN', embalagem_medida: 'DP', embalagem_quantidade: 6 }, medidas)).toMatchObject({ ok: false, codigo: 'MEDIDA_INATIVA' });
    });
    it('RN-CORE-19: inativar a medida não trava produto que já a usa; só impede escolhê-la de novo', () => {
        const atuais = { unidade: 'DP', embalagem_medida: null };
        // o produto mantém a sigla inativa (edita só o preço/embalagem)
        expect(validarMedidasDoProduto({ unidade: 'DP', embalagem_medida: 'CX', embalagem_quantidade: 6 }, medidas, atuais).ok).toBe(true);
        // trocar para outra inativa continua recusado
        expect(validarMedidasDoProduto({ unidade: 'UN', embalagem_medida: 'DP', embalagem_quantidade: 6 }, medidas, atuais)).toMatchObject({ ok: false, codigo: 'MEDIDA_INATIVA' });
    });
});
describe('RN-CORE-19: apagar e trocar a sigla de medida em uso', () => {
    it('RN-CORE-19: apagar sem uso é permitido', () => {
        expect(decidirApagarMedida({ emUso: 0 })).toEqual({ ok: true });
    });
    it('RN-CORE-19: apagar em uso é recusado com a contagem e a saída (inativar)', () => {
        expect(decidirApagarMedida({ emUso: 3 })).toEqual({ ok: false, codigo: 'MEDIDA_EM_USO', mensagem: 'Medida em uso por 3 produto(s): inative em vez de apagar.' });
    });
    it('RN-CORE-19: a sigla só muda se a medida não estiver em uso; a descrição muda sempre', () => {
        expect(decidirTrocaDeSigla({ siglaAtual: 'CX', siglaNova: 'CX', emUso: 5 })).toEqual({ ok: true });
        expect(decidirTrocaDeSigla({ siglaAtual: 'CX', siglaNova: 'CXA', emUso: 0 })).toEqual({ ok: true });
        expect(decidirTrocaDeSigla({ siglaAtual: 'CX', siglaNova: 'CXA', emUso: 2 })).toMatchObject({ ok: false, codigo: 'MEDIDA_EM_USO' });
    });
    it('RN-CORE-19: inativar é permitido mesmo em uso (a lista de escolhas novas é que perde a medida)', () => {
        expect(podeUsarMedida({ ativo: false })).toBe(false);
        expect(decidirApagarMedida({ emUso: 1 }).ok).toBe(false);
    });
});
describe('RN-CORE-19 / RN-VEN-15: teto da quantidade da embalagem', () => {
    it('RN-CORE-19: a quantidade da embalagem é inteira entre 2 e 9999', () => {
        expect([EMBALAGEM_QUANTIDADE_MIN, EMBALAGEM_QUANTIDADE_MAX]).toEqual([2, 9999]);
        expect(validarMedidasDoProduto({ unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: 9999 }, medidas).ok).toBe(true);
        for (const q of [10000, 100000, 2147483648, Number.POSITIVE_INFINITY]) {
            expect(validarMedidasDoProduto({ unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: q }, medidas), String(q)).toMatchObject({ ok: false, codigo: 'EMBALAGEM_INVALIDA' });
        }
    });
});
describe('RN-CORE-19 / RN-VEN-15: embalagem do produto x unidade de venda do ERP (core.produto_unidade)', () => {
    const vendas = new Map([['CX', 6]]);
    it('RN-VEN-15: embalagem com a mesma sigla da unidade de venda viva exige quantidade igual ao fator do ERP', () => {
        const r = validarMedidasDoProduto({ unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: 12 }, medidas, undefined, vendas);
        expect(r).toMatchObject({ ok: false, codigo: 'EMBALAGEM_DIVERGE_ERP' });
        expect(r.mensagem).toContain('A embalagem CX deste produto já vem do ERP com 6 unidades');
        expect(validarMedidasDoProduto({ unidade: 'UN', embalagem_medida: 'cx', embalagem_quantidade: 6 }, medidas, undefined, vendas).ok).toBe(true);
    });
    it('RN-VEN-15: sigla sem unidade de venda no ERP (ou sem embalagem) não sofre a regra', () => {
        expect(validarMedidasDoProduto({ unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: 12 }, medidas, undefined, new Map([['DZ', 12]])).ok).toBe(true);
        expect(validarMedidasDoProduto({ unidade: 'UN' }, medidas, undefined, vendas).ok).toBe(true);
        expect(validarMedidasDoProduto({ unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: 12 }, medidas).ok).toBe(true);
    });
    it('RN-VEN-15: o ERP prevalece — reconciliarEmbalagemComErp troca a quantidade pelo fator e avisa que ajustou', () => {
        expect(reconciliarEmbalagemComErp({ embalagem_medida: 'CX', embalagem_quantidade: 12 }, vendas)).toEqual({ embalagem_medida: 'CX', embalagem_quantidade: 6, ajustada: true });
        expect(reconciliarEmbalagemComErp({ embalagem_medida: 'CX', embalagem_quantidade: 6 }, vendas)).toEqual({ embalagem_medida: 'CX', embalagem_quantidade: 6, ajustada: false });
        expect(reconciliarEmbalagemComErp({ embalagem_medida: 'DZ', embalagem_quantidade: 12 }, vendas).ajustada).toBe(false);
        expect(reconciliarEmbalagemComErp({ embalagem_medida: null, embalagem_quantidade: null }, vendas)).toEqual({ embalagem_medida: null, embalagem_quantidade: null, ajustada: false });
    });
    it('RN-VEN-15: fator do ERP fora de 2 a 9999 (ex.: UN = 1) não vira embalagem — fica como está', () => {
        expect(reconciliarEmbalagemComErp({ embalagem_medida: 'CX', embalagem_quantidade: 12 }, new Map([['CX', 1]])).ajustada).toBe(false);
        expect(reconciliarEmbalagemComErp({ embalagem_medida: 'CX', embalagem_quantidade: 12 }, new Map([['CX', 10000]])).ajustada).toBe(false);
        expect(validarMedidasDoProduto({ unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: 12 }, medidas, undefined, new Map([['CX', 1]])).ok).toBe(true);
    });
});
