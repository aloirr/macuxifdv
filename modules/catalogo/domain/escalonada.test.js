import { describe, expect, it } from 'vitest';
import { FaixaEscalonadaSchema, PrecosClienteSaidaSchema } from '../contracts';
import { chaveDaFaixa, conflitoDeFaixa, dataCivilNoFuso, faixaMaisCaraQueATabela, faixasDoProduto, faixaVigente, validarFaixa } from './escalonada';
import { MOTIVO_PERFIL_SEM_PRECO, precosDoCliente } from './precos-cliente';
const T = '0a000000-0000-4000-8000-000000000001';
const T2 = '0a000000-0000-4000-8000-000000000002';
const P1 = '0b000000-0000-4000-8000-000000000001';
const P2 = '0b000000-0000-4000-8000-000000000002';
const HOJE = '2026-11-06';
const linha = (extra = {}) => ({
    produto_id: P1,
    medida: null,
    quantidade_minima: 10,
    preco_unidade_cents: 900,
    vigencia_inicio: '2026-11-01',
    vigencia_fim: null,
    tabela_preco_id: null,
    ativo: true,
    ...extra,
});
describe('RN-VEN-23: faixas vigentes da tabela escalonada (domain do Catálogo)', () => {
    it('RN-VEN-23: vigência fechada nas duas pontas, em data civil (início e fim valem no próprio dia)', () => {
        expect(faixaVigente(linha({ vigencia_inicio: '2026-11-06' }), HOJE)).toBe(true);
        expect(faixaVigente(linha({ vigencia_inicio: '2026-11-07' }), HOJE)).toBe(false);
        expect(faixaVigente(linha({ vigencia_fim: '2026-11-06' }), HOJE)).toBe(true);
        expect(faixaVigente(linha({ vigencia_fim: '2026-11-05' }), HOJE)).toBe(false);
        expect(faixaVigente(linha({ vigencia_fim: null }), HOJE)).toBe(true);
    });
    it('RN-VEN-23: faixa inativa não vale', () => {
        expect(faixaVigente(linha({ ativo: false }), HOJE)).toBe(false);
    });
    it('RN-VEN-23: a data civil é a do fuso do tenant, não a UTC (22h em Manaus já é o dia seguinte em UTC)', () => {
        expect(dataCivilNoFuso('2026-11-07T02:30:00.000Z', 'America/Manaus')).toBe('2026-11-06');
        expect(dataCivilNoFuso('2026-11-07T02:30:00.000Z', 'UTC')).toBe('2026-11-07');
        expect(dataCivilNoFuso('2026-11-07T02:30:00.000Z', 'fuso/invalido')).toBe('2026-11-06');
    });
    it('RN-VEN-23: só entram as faixas do produto, da tabela do cliente ou gerais; a de outra tabela fica de fora', () => {
        const r = faixasDoProduto([linha({ tabela_preco_id: T }), linha({ quantidade_minima: 20, preco_unidade_cents: 800 }), linha({ quantidade_minima: 30, tabela_preco_id: T2 }), linha({ produto_id: P2 })], { produtoId: P1, tabelaId: T, hoje: HOJE });
        expect(r).toEqual([
            { medida: null, quantidade_minima: 10, preco_unidade_cents: 900 },
            { medida: null, quantidade_minima: 20, preco_unidade_cents: 800 },
        ]);
    });
    it('RN-VEN-23: na mesma (medida, quantidade mínima) a faixa da tabela do cliente vence a geral, mesmo a geral sendo mais barata', () => {
        const r = faixasDoProduto([linha({ preco_unidade_cents: 700 }), linha({ preco_unidade_cents: 950, tabela_preco_id: T })], { produtoId: P1, tabelaId: T, hoje: HOJE });
        expect(r).toEqual([{ medida: null, quantidade_minima: 10, preco_unidade_cents: 950 }]);
    });
    it('RN-VEN-23: a faixa da tabela do cliente vencida cede à geral vigente (não fica sem faixa)', () => {
        const r = faixasDoProduto([linha({ preco_unidade_cents: 700 }), linha({ preco_unidade_cents: 950, tabela_preco_id: T, vigencia_fim: '2026-11-05' })], { produtoId: P1, tabelaId: T, hoje: HOJE });
        expect(r).toEqual([{ medida: null, quantidade_minima: 10, preco_unidade_cents: 700 }]);
    });
    it('RN-VEN-23: duas vigentes na mesma chave e origem: vale a de início mais recente', () => {
        const r = faixasDoProduto([linha({ preco_unidade_cents: 700, vigencia_inicio: '2026-10-01' }), linha({ preco_unidade_cents: 850, vigencia_inicio: '2026-11-02' })], { produtoId: P1, tabelaId: T, hoje: HOJE });
        expect(r).toEqual([{ medida: null, quantidade_minima: 10, preco_unidade_cents: 850 }]);
    });
    it('RN-VEN-23: cada medida tem as suas faixas; ordem = unidade base primeiro, depois a medida, por quantidade mínima', () => {
        const r = faixasDoProduto([linha({ medida: 'FD', quantidade_minima: 20 }), linha({ medida: 'FD', quantidade_minima: 10 }), linha({ medida: null, quantidade_minima: 50, preco_unidade_cents: 850 })], { produtoId: P1, tabelaId: T, hoje: HOJE });
        expect(r.map((f) => [f.medida, f.quantidade_minima])).toEqual([
            [null, 50],
            ['FD', 10],
            ['FD', 20],
        ]);
    });
    it('RN-VEN-23: cliente sem tabela só recebe as faixas gerais', () => {
        const r = faixasDoProduto([linha({ tabela_preco_id: T }), linha({ quantidade_minima: 20 })], { produtoId: P1, tabelaId: null, hoje: HOJE });
        expect(r.map((f) => f.quantidade_minima)).toEqual([20]);
    });
    it('contrato: a faixa publicada passa no schema', () => {
        for (const f of faixasDoProduto([linha()], { produtoId: P1, tabelaId: T, hoje: HOJE }))
            expect(FaixaEscalonadaSchema.safeParse(f).success).toBe(true);
    });
});
describe('catalogo.precos_cliente@1: faixas[] (RN-VEN-23, RN-CAT-05, RN-CAT-06)', () => {
    const itens = [{ price_table_id: T, product_id: P1, price_cents: 1000 }];
    const base = { produtoIds: [P1], tabelaId: T, itens, agora: '2026-11-06T15:00:00.000Z', em: '2026-11-06T15:00:00.000Z', verPreco: true, faixas: [linha()] };
    it('RN-VEN-23: o item com preço leva as faixas vigentes em `em`', () => {
        const r = precosDoCliente(base);
        expect(r.itens[0]).toEqual({ produto_id: P1, preco_cents: 1000, motivo_sem_preco: null, faixas: [{ medida: null, quantidade_minima: 10, preco_unidade_cents: 900 }] });
        expect(PrecosClienteSaidaSchema.safeParse(r).success).toBe(true);
    });
    it('RN-VEN-23: a vigência usa o `em` (limitado a 7 dias, P-4): faixa que começa depois de `em` não vai', () => {
        const r = precosDoCliente({ ...base, em: '2026-11-01T15:00:00.000Z', faixas: [linha({ vigencia_inicio: '2026-11-03' })] });
        expect(r.itens[0]).not.toHaveProperty('faixas');
    });
    it('RN-VEN-23: o dia da vigência é o do fuso do tenant (às 22h de 05/11 em Manaus a faixa que vai até 05/11 ainda vale)', () => {
        const faixas = [linha({ vigencia_fim: '2026-11-05' })];
        const instante = { agora: '2026-11-06T02:00:00.000Z', em: '2026-11-06T02:00:00.000Z', faixas };
        expect(precosDoCliente({ ...base, ...instante, fuso: 'America/Manaus' }).itens[0].faixas).toHaveLength(1);
        expect(precosDoCliente({ ...base, ...instante, fuso: 'UTC' }).itens[0]).not.toHaveProperty('faixas');
    });
    it('RN-CAT-05: perfil sem direito a preço não recebe faixa nenhuma', () => {
        const r = precosDoCliente({ ...base, verPreco: false });
        expect(r).toEqual({ tabela_preco_id: null, itens: [{ produto_id: P1, preco_cents: null, motivo_sem_preco: MOTIVO_PERFIL_SEM_PRECO }] });
    });
    it('RN-CAT-06: item sem preço na tabela do cliente não recebe faixa (não é vendável); cliente sem tabela também não', () => {
        expect(precosDoCliente({ ...base, itens: [] }).itens[0]).not.toHaveProperty('faixas');
        expect(precosDoCliente({ ...base, tabelaId: null }).itens[0]).not.toHaveProperty('faixas');
    });
    it('compatibilidade: sem faixas na entrada a saída é a do consumidor antigo, e `embalagens` nunca é preenchido (RN-VEN-15 nova)', () => {
        const { faixas: _f, ...semFaixas } = base;
        const r = precosDoCliente({ ...semFaixas, itens: [...itens, { price_table_id: T, product_id: P1, price_cents: 11000, unit: 'CX' }] });
        expect(r.itens[0]).toEqual({ produto_id: P1, preco_cents: 1000, motivo_sem_preco: null });
    });
});
describe('RN-VEN-23: cadastro da faixa no BKO', () => {
    const ok = { medida: null, quantidade_minima: 10, preco_unidade_cents: 900, vigencia_inicio: '2026-11-01', vigencia_fim: null };
    it('RN-VEN-23: faixa válida passa', () => {
        expect(validarFaixa(ok)).toEqual({ ok: true });
        expect(validarFaixa({ ...ok, medida: 'FD', vigencia_fim: '2026-12-31' })).toEqual({ ok: true });
    });
    it('RN-VEN-23: quantidade mínima inteira e maior que zero; preço maior que zero', () => {
        expect(validarFaixa({ ...ok, quantidade_minima: 0 })).toMatchObject({ ok: false, campo: 'quantidade_minima' });
        expect(validarFaixa({ ...ok, quantidade_minima: 1.5 })).toMatchObject({ ok: false, campo: 'quantidade_minima' });
        expect(validarFaixa({ ...ok, preco_unidade_cents: 0 })).toMatchObject({ ok: false, campo: 'preco_unidade_cents' });
    });
    it('RN-VEN-23: fim da vigência não pode ser anterior ao início; datas em AAAA-MM-DD válidas', () => {
        expect(validarFaixa({ ...ok, vigencia_fim: '2026-10-31' })).toMatchObject({ ok: false, campo: 'vigencia_fim' });
        expect(validarFaixa({ ...ok, vigencia_inicio: '01/11/2026' })).toMatchObject({ ok: false, campo: 'vigencia_inicio' });
        expect(validarFaixa({ ...ok, vigencia_inicio: '2026-02-30' })).toMatchObject({ ok: false, campo: 'vigencia_inicio' });
    });
    it('RN-VEN-23: a medida é uma sigla de 1 a 4 letras maiúsculas ou vazia (unidade base)', () => {
        expect(validarFaixa({ ...ok, medida: 'fd' })).toMatchObject({ ok: false, campo: 'medida' });
        expect(validarFaixa({ ...ok, medida: 'CAIXAS' })).toMatchObject({ ok: false, campo: 'medida' });
    });
    it('P4: faixa mais cara que o preço da tabela é avisada (não sobe o preço no pedido)', () => {
        expect(faixaMaisCaraQueATabela(1100, 1000)).toBe(true);
        expect(faixaMaisCaraQueATabela(1000, 1000)).toBe(false);
        expect(faixaMaisCaraQueATabela(900, 1000)).toBe(false);
        expect(faixaMaisCaraQueATabela(900, null)).toBe(false);
    });
});
describe('RN-VEN-23: unicidade da faixa no cadastro', () => {
    const nova = { produto_id: P1, medida: null, quantidade_minima: 10, tabela_preco_id: null, vigencia_inicio: '2026-11-01' };
    it('RN-VEN-23: a chave é produto, medida, mínimo, tabela e início', () => {
        expect(chaveDaFaixa(nova)).not.toBe(chaveDaFaixa({ ...nova, medida: 'FD' }));
        expect(chaveDaFaixa(nova)).not.toBe(chaveDaFaixa({ ...nova, tabela_preco_id: T }));
        expect(chaveDaFaixa(nova)).toBe(chaveDaFaixa({ ...nova }));
    });
    it('RN-VEN-23: outra faixa viva com a mesma chave é conflito; a própria (mesmo id) não', () => {
        expect(conflitoDeFaixa('a', nova, [{ ...nova, id: 'b' }])).toMatch(/Já existe uma faixa/);
        expect(conflitoDeFaixa('a', nova, [{ ...nova, id: 'a' }])).toBeNull();
        expect(conflitoDeFaixa('a', nova, [{ ...nova, id: 'b', quantidade_minima: 20 }])).toBeNull();
    });
});
