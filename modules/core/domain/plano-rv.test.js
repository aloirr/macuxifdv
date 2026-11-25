import { describe, expect, it } from 'vitest';
import { calcularRvDaPessoa, diasUteisDoMes, mesesFechadosDesde, planoJaValeuEmMesFechado, planoVigente, validarEdicaoPlanoRv, validarPlanoRv, } from './plano-rv';
const faixas = [
    { de_pct: 0, modo: 'zero', pagamento_pct: 0 },
    { de_pct: 80, modo: 'proporcional', pagamento_pct: 0 },
    { de_pct: 100, modo: 'fixo', pagamento_pct: 100 },
    { de_pct: 110, modo: 'fixo', pagamento_pct: 120 },
];
function plano(over = {}) {
    return {
        id: 'p1',
        nome: 'Plano 2026',
        vigencia_inicio: '2026-01',
        perfis: ['vendedor'],
        valor_maximo_cents: 100_000,
        regras: [
            { indicador: 'venda_cents', peso_pct: 60, gatilho: false, faixas: [...faixas] },
            { indicador: 'positivacao', peso_pct: 40, gatilho: false, faixas: [...faixas] },
        ],
        ...over,
    };
}
const diasMes = { total: 20, elapsed: 10, remaining: 10 };
describe('RN-CORE-29: cálculo da RV', () => {
    it.each([
        [79.9, 0],
        [80, 80],
        [100, 100],
        [110, 120],
    ])('RN-CORE-29: faixa nos limites, atingimento %s paga %s%%', (ating, pago) => {
        const r = calcularRvDaPessoa(plano(), { venda_cents: 1000 }, { venda_cents: ating * 10 }, diasMes, 'fechado');
        const linha = r.indicadores.find((i) => i.indicador === 'venda_cents');
        expect(linha.pagamento_pct).toBe(pago);
        expect(linha.valor_cents).toBe(Math.round((100_000 * 0.6 * pago) / 100));
    });
    it('RN-CORE-29: soma os indicadores em centavos e indicador sem meta paga 0', () => {
        const r = calcularRvDaPessoa(plano(), { venda_cents: 1000 }, { venda_cents: 1000, positivacao: 9 }, diasMes, 'fechado');
        expect(r.rv_cents).toBe(60_000);
        const pos = r.indicadores.find((i) => i.indicador === 'positivacao');
        expect(pos.sem_meta).toBe(true);
        expect(pos.valor_cents).toBe(0);
    });
    it('RN-CORE-29: gatilho abaixo da meta zera a RV e informa quem bloqueou', () => {
        const p = plano({
            regras: [
                { indicador: 'venda_cents', peso_pct: 100, gatilho: false, faixas: [...faixas] },
                { indicador: 'visitas', peso_pct: 0, gatilho: true, faixas: [] },
            ],
        });
        const r = calcularRvDaPessoa(p, { venda_cents: 10, visitas: 100 }, { venda_cents: 10, visitas: 99 }, diasMes, 'fechado');
        expect(r.rv_cents).toBe(0);
        expect(r.rv_bruta_cents).toBe(100_000);
        expect(r.bloqueada_por).toEqual(['visitas']);
    });
    it('RN-CORE-29: gatilho sem meta não bloqueia', () => {
        const p = plano({
            regras: [
                { indicador: 'venda_cents', peso_pct: 100, gatilho: false, faixas: [...faixas] },
                { indicador: 'visitas', peso_pct: 0, gatilho: true, faixas: [] },
            ],
        });
        const r = calcularRvDaPessoa(p, { venda_cents: 10 }, { venda_cents: 10 }, diasMes, 'fechado');
        expect(r.rv_cents).toBe(100_000);
        expect(r.bloqueada_por).toEqual([]);
    });
    it('RN-CORE-29: mês fechado paga pelo realizado e mês aberto pela projeção em dias úteis', () => {
        const p = plano();
        const fechado = calcularRvDaPessoa(p, { venda_cents: 1000 }, { venda_cents: 500 }, diasMes, 'fechado');
        expect(fechado.indicadores[0].pagamento_pct).toBe(0);
        const parcial = calcularRvDaPessoa(p, { venda_cents: 1000 }, { venda_cents: 500 }, diasMes, 'parcial');
        expect(parcial.indicadores[0].projetado_pct).toBe(100);
        expect(parcial.indicadores[0].pagamento_pct).toBe(100);
    });
    it('RN-CORE-29: positivação não é projetada no mês aberto', () => {
        const r = calcularRvDaPessoa(plano(), { positivacao: 10 }, { positivacao: 5 }, diasMes, 'parcial');
        const pos = r.indicadores.find((i) => i.indicador === 'positivacao');
        expect(pos.projetado_pct).toBe(50);
        expect(pos.pagamento_pct).toBe(0);
    });
});
describe('RN-CORE-29: gatilho no mês aberto', () => {
    const comGatilho = (ind) => plano({
        regras: [
            { indicador: 'venda_cents', peso_pct: 100, gatilho: false, faixas: [...faixas] },
            { indicador: ind, peso_pct: 0, gatilho: true, faixas: [] },
        ],
    });
    const metade = { total: 20, elapsed: 10, remaining: 10 };
    it('RN-CORE-29: gatilho de visitas 50/100 com metade dos dias úteis: parcial não bloqueia (vale pela projeção); fechado bloqueia', () => {
        const metas = { venda_cents: 10, visitas: 100 };
        const real = { venda_cents: 10, visitas: 50 };
        const parcial = calcularRvDaPessoa(comGatilho('visitas'), metas, real, metade, 'parcial');
        expect(parcial.bloqueada_por).toEqual([]);
        expect(parcial.rv_cents).toBe(parcial.rv_bruta_cents);
        expect(parcial.indicadores.find((i) => i.indicador === 'visitas').gatilho_ok).toBe(true);
        const fechado = calcularRvDaPessoa(comGatilho('visitas'), metas, real, metade, 'fechado');
        expect(fechado.bloqueada_por).toEqual(['visitas']);
        expect(fechado.rv_cents).toBe(0);
    });
    it('RN-CORE-29: gatilho de visitas abaixo da projeção bloqueia no parcial', () => {
        const r = calcularRvDaPessoa(comGatilho('visitas'), { venda_cents: 10, visitas: 100 }, { venda_cents: 10, visitas: 40 }, metade, 'parcial');
        expect(r.bloqueada_por).toEqual(['visitas']);
        expect(r.rv_cents).toBe(0);
        expect(r.rv_bruta_cents).toBeGreaterThan(0);
    });
    it('RN-CORE-29: gatilho de positivação 5/10 não é projetado: bloqueia no parcial pelo realizado', () => {
        const r = calcularRvDaPessoa(comGatilho('positivacao'), { venda_cents: 10, positivacao: 10 }, { venda_cents: 10, positivacao: 5 }, metade, 'parcial');
        expect(r.bloqueada_por).toEqual(['positivacao']);
        expect(r.rv_cents).toBe(0);
    });
});
describe('RN-CORE-30: plano e vigência', () => {
    it('RN-CORE-30: plano válido passa', () => {
        expect(validarPlanoRv(plano())).toEqual([]);
    });
    it('RN-CORE-30: pesos dos não-gatilho diferentes de 100 são recusados', () => {
        const p = plano();
        p.regras[0].peso_pct = 50;
        expect(validarPlanoRv(p).join(' ')).toMatch(/100/);
    });
    it('RN-CORE-30: faixas devem começar em 0%, sem repetir, até 300%', () => {
        const p = plano();
        p.regras[0].faixas = [{ de_pct: 10, modo: 'zero', pagamento_pct: 0 }];
        expect(validarPlanoRv(p).length).toBeGreaterThan(0);
        const q = plano();
        q.regras[0].faixas = [...faixas, { de_pct: 100, modo: 'fixo', pagamento_pct: 100 }];
        expect(validarPlanoRv(q).length).toBeGreaterThan(0);
        const r = plano();
        r.regras[0].faixas = [...faixas, { de_pct: 120, modo: 'fixo', pagamento_pct: 301 }];
        expect(validarPlanoRv(r).length).toBeGreaterThan(0);
    });
    it('RN-CORE-30: valor máximo > 0, indicador repetido e plano só de gatilhos são recusados', () => {
        expect(validarPlanoRv(plano({ valor_maximo_cents: 0 })).length).toBeGreaterThan(0);
        const dup = plano();
        dup.regras[1].indicador = 'venda_cents';
        expect(validarPlanoRv(dup).length).toBeGreaterThan(0);
        const soGatilho = plano({ regras: [{ indicador: 'visitas', peso_pct: 0, gatilho: true, faixas: [] }] });
        expect(validarPlanoRv(soGatilho).length).toBeGreaterThan(0);
    });
    it('RN-CORE-30: vigência vale do mês de início até o mês anterior ao próximo plano', () => {
        const a = plano({ id: 'a', vigencia_inicio: '2026-01' });
        const b = plano({ id: 'b', vigencia_inicio: '2026-07' });
        expect(planoVigente([a, b], '2025-12', 'vendedor')).toBeNull();
        expect(planoVigente([a, b], '2026-06', 'vendedor')?.id).toBe('a');
        expect(planoVigente([b, a], '2026-07', 'vendedor')?.id).toBe('b');
        expect(planoVigente([a, b], '2026-07', 'promotor')).toBeNull();
    });
    it('RN-CORE-30: plano que já valeu para mês fechado não muda; versão nova a partir do mês aberto', () => {
        const a = plano({ id: 'a', vigencia_inicio: '2026-01' });
        const b = plano({ id: 'b', vigencia_inicio: '2026-07' });
        const fechados = ['2026-01', '2026-02', '2026-03'];
        expect(planoJaValeuEmMesFechado([a, b], a, fechados)).toBe(true);
        expect(planoJaValeuEmMesFechado([a, b], b, fechados)).toBe(false);
        const alterado = { ...a, valor_maximo_cents: 200_000 };
        expect(validarEdicaoPlanoRv([a, b], a, alterado, fechados).join(' ')).toMatch(/versão nova/i);
        expect(validarEdicaoPlanoRv([a, b], b, { ...b, valor_maximo_cents: 5 }, fechados)).toEqual([]);
    });
    it('RN-CORE-30: mesmo mês de início de outro plano é recusado', () => {
        const a = plano({ id: 'a', vigencia_inicio: '2026-01' });
        const novo = plano({ id: 'n', vigencia_inicio: '2026-01' });
        expect(validarEdicaoPlanoRv([a], null, novo, []).length).toBeGreaterThan(0);
    });
});
describe('RN-CORE-29: calendário e meses fechados da RV', () => {
    it('RN-CORE-29: dias úteis do mês pelo calendário do tenant (dias da semana), contando só os já encerrados', () => {
        // novembro/2026 (01/11 é domingo): segunda a sexta = 21 úteis; hoje = quinta 05/11 -> encerrados 02, 03 e 04
        const seg_sex = diasUteisDoMes('2026-11', '2026-11-05', [1, 2, 3, 4, 5]);
        expect(seg_sex).toEqual({ total: 21, elapsed: 3, remaining: 18 });
        const seg_sab = diasUteisDoMes('2026-11', '2026-11-05', [1, 2, 3, 4, 5, 6]);
        expect(seg_sab).toEqual({ total: 25, elapsed: 3, remaining: 22 });
    });
    it('RN-CORE-29: mês passado tem tudo encerrado; mês futuro, nada', () => {
        expect(diasUteisDoMes('2026-10', '2026-11-05', [1, 2, 3, 4, 5]).remaining).toBe(0);
        expect(diasUteisDoMes('2026-12', '2026-11-05', [1, 2, 3, 4, 5]).elapsed).toBe(0);
    });
    it('RN-CORE-21/30: meses fechados desde o primeiro início; o mês só fecha no 2º dia útil do seguinte', () => {
        // 05/11 (quinta): outubro fecha no 2º dia útil de novembro = 03/11 -> fechado; novembro, não
        expect(mesesFechadosDesde('2026-08', '2026-11-05')).toEqual(['2026-08', '2026-09', '2026-10']);
        // 02/11 (segunda) é só o 1º dia útil: outubro ainda aberto
        expect(mesesFechadosDesde('2026-08', '2026-11-02')).toEqual(['2026-08', '2026-09']);
        expect(mesesFechadosDesde('2027-01', '2026-11-05')).toEqual([]);
    });
});
describe('RN-CORE-30: vigência nova não reescreve mês fechado', () => {
    const a = plano({ id: 'a', vigencia_inicio: '2026-01' });
    it('RN-CORE-30: plano novo que passaria a valer sobre mês fechado já coberto por outro plano é recusado', () => {
        const novo = plano({ id: 'n', vigencia_inicio: '2026-03' });
        expect(validarEdicaoPlanoRv([a], null, novo, ['2026-01', '2026-02', '2026-03', '2026-04']).join(' ')).toMatch(/mês aberto/i);
    });
    it('RN-CORE-30: vigência a partir do mês aberto é aceita', () => {
        const novo = plano({ id: 'n', vigencia_inicio: '2026-05' });
        expect(validarEdicaoPlanoRv([a], null, novo, ['2026-01', '2026-02', '2026-03', '2026-04'])).toEqual([]);
    });
    it('RN-CORE-30: o primeiro plano do tenant pode começar no passado (nenhum mês fechado tinha plano)', () => {
        expect(validarEdicaoPlanoRv([], null, plano({ id: 'n', vigencia_inicio: '2026-01' }), ['2026-01', '2026-02'])).toEqual([]);
    });
    it('RN-CORE-30: mover a vigência de um plano para trás, sobre mês fechado de outro plano, é recusado', () => {
        const b = plano({ id: 'b', vigencia_inicio: '2026-07' });
        const movido = { ...b, vigencia_inicio: '2026-03' };
        expect(validarEdicaoPlanoRv([a, b], b, movido, ['2026-01', '2026-02', '2026-03', '2026-04']).join(' ')).toMatch(/mês aberto/i);
    });
});
