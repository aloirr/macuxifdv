import { describe, expect, it } from 'vitest';
import { RealizadoServidorSchema, ResultadoIndicadorSchema, } from '../../contracts/performance';
import { resultadosDoPeriodo, visitasContadas, } from './resultados';
const SEG_SEX = { dias_uteis_semana: [1, 2, 3, 4, 5] };
const realizado = (r = {}) => ({
    tipo_meta_venda: 'pedido',
    venda_cents: 0,
    positivacao: 0,
    positivacao_ate_ontem: 0,
    venda_ate_ontem_cents: 0,
    pedidos: 0,
    itens_distintos: 0,
    por_mes: [],
    ...r,
});
const meta = (periodo, indicador, valor) => ({
    periodo,
    indicador,
    valor,
});
const v = (cliente_id, data_local, extra = {}) => ({
    cliente_id,
    data_local,
    ...extra,
});
/** n visitas contadas no dia (clientes c1..cn). */
const visitasNoDia = (data, n, prefixo = 'c') => Array.from({ length: n }, (_, i) => v(`${prefixo}${i + 1}`, data));
const ABRIL = {
    de: '2026-04-01',
    ate: '2026-04-30',
    hoje: '2026-04-14',
    calendario: SEG_SEX,
    perfil: 'vendedor',
};
const METAS_ABRIL = [
    meta('2026-04', 'venda_cents', 18_000_000),
    meta('2026-04', 'positivacao', 70),
    meta('2026-04', 'visitas', 200),
    meta('2026-04', 'itens_por_pedido', 800),
];
function resultado(e, indicador) {
    const r = resultadosDoPeriodo(e).find((x) => x.indicador === indicador);
    if (!r)
        throw new Error(`sem ${indicador}`);
    expect(ResultadoIndicadorSchema.parse(r)).toEqual(r);
    return r;
}
describe('RN-CORE-42: exemplo conferível da §2.2 (DU 9 de 20, 12 restantes)', () => {
    // Abril/2026 seg–sex: 20 dias úteis (sem 03/04 e 21/04); terça 14/04 é o DU 9, com 12 restantes (D1).
    const e = {
        ...ABRIL,
        metas: METAS_ABRIL,
        realizado: realizado({ venda_cents: 8_460_000, positivacao: 38, pedidos: 10, itens_distintos: 64 }),
        visitas: [],
    };
    it('RN-CORE-42: Faturamento 84.600,00 de 180.000,00: Gap 95.400,00, Meta/dia 795.000, Real/dia 940.000, 47,0%', () => {
        expect(resultado(e, 'venda_cents')).toEqual({
            indicador: 'venda_cents',
            situacao: 'a_cumprir',
            meta: 18_000_000,
            realizado: 8_460_000,
            atingimento_pb: 4700,
            gap: 9_540_000,
            meta_dia: 795_000,
            real_dia: 940_000,
        });
    });
    it('RN-CORE-42: Positivação 38/70: Gap 32, Meta/dia ⌈32 ÷ 12⌉ = 3, Real/dia round(38 ÷ 9) = 4', () => {
        const r = resultado(e, 'positivacao');
        expect([r.gap, r.meta_dia, r.real_dia, r.atingimento_pb]).toEqual([32, 3, 4, 5429]);
    });
    it('RN-CORE-42 (D2): Itens por pedido 6,40 de 8,00: Meta/pedido = 8 + 1,6 × 9 ÷ 12 = 9,2 (920), sem Real/dia', () => {
        const r = resultado(e, 'itens_por_pedido');
        expect(r).toMatchObject({
            realizado: 640,
            meta: 800,
            gap: 160,
            meta_dia: 920,
            real_dia: null,
            atingimento_pb: 8000,
            situacao: 'a_cumprir',
        });
    });
    it('RN-CORE-42: Meta/pedido arredonda para cima em décimos (com 11 restantes, 9,31 vira 9,4)', () => {
        // Mesmo mês com um feriado do tenant em 30/04: 19 dias úteis, 11 restantes, 9 decorridos.
        const r = resultado({ ...e, calendario: { ...SEG_SEX, feriados: ['2026-04-30'] } }, 'itens_por_pedido');
        expect(r.meta_dia).toBe(940);
        expect(r.meta_dia % 10).toBe(0);
    });
});
describe('RN-CORE-42: Gap, Meta/dia e Real/dia (§2.1)', () => {
    it('RN-CORE-42: meta batida: "batida", Gap 0, Meta/dia nula, atingimento passa de 100%', () => {
        const r = resultado({ ...ABRIL, metas: METAS_ABRIL, realizado: realizado({ venda_cents: 19_800_000 }), visitas: [] }, 'venda_cents');
        expect(r).toMatchObject({
            situacao: 'batida',
            gap: 0,
            meta_dia: null,
            atingimento_pb: 11_000,
            real_dia: 2_200_000,
        });
    });
    it('RN-CORE-42: realizado igual à meta é batida', () => {
        expect(resultado({ ...ABRIL, metas: METAS_ABRIL, realizado: realizado({ positivacao: 70 }), visitas: [] }, 'positivacao').situacao).toBe('batida');
    });
    it('RN-CORE-42: Itens batida: Meta/pedido nula', () => {
        const r = resultado({
            ...ABRIL,
            metas: METAS_ABRIL,
            realizado: realizado({ pedidos: 10, itens_distintos: 85 }),
            visitas: [],
        }, 'itens_por_pedido');
        expect(r).toMatchObject({ situacao: 'batida', realizado: 850, gap: 0, meta_dia: null });
    });
    it('RN-CORE-42: sem dia útil restante (sábado 31/10 em seg–sex): Meta/dia nula e o Gap continua', () => {
        const r = resultado({
            de: '2026-10-01',
            ate: '2026-10-31',
            hoje: '2026-10-31',
            calendario: SEG_SEX,
            perfil: 'vendedor',
            metas: [meta('2026-10', 'venda_cents', 1_000_000)],
            realizado: realizado({ venda_cents: 400_000 }),
            visitas: [],
        }, 'venda_cents');
        expect(r).toMatchObject({ gap: 600_000, meta_dia: null, situacao: 'a_cumprir' });
    });
    it('RN-CORE-42: nenhum dia útil decorrido (domingo 01/11): Real/dia nulo', () => {
        const r = resultado({
            de: '2026-11-01',
            ate: '2026-11-30',
            hoje: '2026-11-01',
            calendario: SEG_SEX,
            perfil: 'vendedor',
            metas: [meta('2026-11', 'venda_cents', 1_900_000)],
            realizado: realizado({ venda_cents: 0 }),
            visitas: [],
        }, 'venda_cents');
        expect(r.real_dia).toBeNull();
        expect(r.meta_dia).toBe(100_000); // ⌈1.900.000 ÷ 19⌉
    });
    it('RN-CORE-42: período encerrado (mês passado): sem Meta/dia nem Meta/pedido; Real/dia sobre todos os dias úteis', () => {
        const e = {
            de: '2026-10-01',
            ate: '2026-10-31',
            hoje: '2026-11-12',
            calendario: SEG_SEX,
            perfil: 'vendedor',
            metas: [meta('2026-10', 'venda_cents', 21_000_000), meta('2026-10', 'itens_por_pedido', 800)],
            realizado: realizado({ venda_cents: 10_500_000, pedidos: 4, itens_distintos: 20 }),
            visitas: [],
        };
        expect(resultado(e, 'venda_cents')).toMatchObject({ meta_dia: null, real_dia: 500_000, gap: 10_500_000 });
        expect(resultado(e, 'itens_por_pedido')).toMatchObject({ meta_dia: null, realizado: 500 });
    });
    it('RN-CORE-42: mês sem meta cadastrada: sem_meta, com o realizado', () => {
        const r = resultado({ ...ABRIL, metas: [], realizado: realizado({ venda_cents: 100 }), visitas: [] }, 'venda_cents');
        expect(r).toMatchObject({
            situacao: 'sem_meta',
            meta: null,
            realizado: 100,
            gap: null,
            atingimento_pb: null,
            meta_dia: null,
            real_dia: 11,
        });
    });
    it('RN-CORE-42: meta removida (deleted_at) não vale', () => {
        const r = resultado({
            ...ABRIL,
            metas: [{ ...meta('2026-04', 'venda_cents', 100), deleted_at: '2026-04-02T00:00:00Z' }],
            realizado: realizado(),
            visitas: [],
        }, 'venda_cents');
        expect(r.situacao).toBe('sem_meta');
    });
    it('RN-CORE-42 (D2, A-3): Itens sem pedido no período: realizado 0, atingimento 0, Gap = meta e Meta/pedido = a própria meta', () => {
        const r = resultado({ ...ABRIL, metas: METAS_ABRIL, realizado: realizado({ pedidos: 0, itens_distintos: 0 }), visitas: [] }, 'itens_por_pedido');
        expect(r).toMatchObject({
            situacao: 'a_cumprir',
            realizado: 0,
            gap: 800,
            atingimento_pb: 0,
            meta_dia: 800,
            real_dia: null,
        });
    });
    it('RN-CORE-42 (A-3): Itens sem pedido e sem meta: realizado 0, sem_meta', () => {
        const r = resultado({ ...ABRIL, metas: [], realizado: realizado({ pedidos: 0, itens_distintos: 0 }), visitas: [] }, 'itens_por_pedido');
        expect(r).toMatchObject({ situacao: 'sem_meta', realizado: 0, meta: null });
    });
    it('RN-CORE-42: Real/dia arredonda meio para cima (100 ÷ 8 = 12,5 → 13)', () => {
        const e = {
            de: '2026-04-01',
            ate: '2026-04-30',
            hoje: '2026-04-13',
            calendario: SEG_SEX,
            perfil: 'vendedor',
        };
        expect(resultado({ ...e, metas: METAS_ABRIL, realizado: realizado({ venda_cents: 100 }), visitas: [] }, 'venda_cents').real_dia).toBe(13);
    });
});
describe('RN-CORE-42 (D3): Visitas = cliente × dia com check-in, extras incluídas', () => {
    it('RN-CORE-42: duas visitas ao mesmo cliente no mesmo dia contam 1; extra conta; removida e fora do período não contam', () => {
        const visitas = [
            v('a', '2026-04-13'),
            v('a', '2026-04-13'),
            v('a', '2026-04-14'),
            v('b', '2026-04-14'), // visita extra (fora da rota): conta igual
            v('c', '2026-04-14', { deleted_at: '2026-04-14T15:00:00Z' }),
            v('d', '2026-03-31'),
        ];
        expect(visitasContadas(visitas, '2026-04-01', '2026-04-14')).toBe(3);
        const r = resultado({ ...ABRIL, metas: METAS_ABRIL, realizado: realizado(), visitas }, 'visitas');
        expect(r).toMatchObject({
            realizado: 3,
            meta: 200,
            gap: 197,
            meta_dia: 17,
            real_dia: 0,
            situacao: 'a_cumprir',
        });
    });
    it('RN-CORE-42: o card de Visitas anda com as visitas locais, mesmo sem a cópia do servidor', () => {
        const r = resultado({ ...ABRIL, metas: METAS_ABRIL, realizado: null, visitas: visitasNoDia('2026-04-14', 2) }, 'visitas');
        expect(r.realizado).toBe(2);
        expect(resultado({ ...ABRIL, metas: METAS_ABRIL, realizado: null, visitas: [] }, 'venda_cents').situacao).toBe('sem_dado');
    });
});
describe('RN-CORE-42: perfil e fonte (§2.4)', () => {
    it('RN-CORE-42: promotor: só Visitas; Faturamento, Positivação e Itens ficam sem_dado (RN-PRO-01)', () => {
        const l = resultadosDoPeriodo({
            ...ABRIL,
            perfil: 'promotor',
            metas: METAS_ABRIL,
            realizado: realizado({ venda_cents: 5 }),
            visitas: visitasNoDia('2026-04-14', 1),
        });
        expect(l.map((r) => [r.indicador, r.situacao])).toEqual([
            ['venda_cents', 'sem_dado'],
            ['positivacao', 'sem_dado'],
            ['visitas', 'a_cumprir'],
            ['itens_por_pedido', 'sem_dado'],
        ]);
        expect(l[0]).toMatchObject({ meta: null, realizado: null });
    });
    it('RN-CORE-42: Vendedor desligado sem notas: Faturamento e Positivação sem_dado; Itens sem_dado', () => {
        const r = realizado({ venda_cents: null, positivacao: null, pedidos: null, itens_distintos: null });
        const l = resultadosDoPeriodo({ ...ABRIL, metas: METAS_ABRIL, realizado: r, visitas: [] });
        expect(l.filter((x) => x.situacao === 'sem_dado').map((x) => x.indicador)).toEqual([
            'venda_cents',
            'positivacao',
            'itens_por_pedido',
        ]);
    });
    it('RN-CORE-42: Vendedor desligado com notas do ERP (RN-CORE-27): Faturamento e Positivação seguem; Itens sem_dado', () => {
        const r = realizado({ venda_cents: 900, positivacao: 3, pedidos: null, itens_distintos: null });
        const l = resultadosDoPeriodo({ ...ABRIL, metas: METAS_ABRIL, realizado: r, visitas: [] });
        expect(l.map((x) => x.situacao)).toEqual(['a_cumprir', 'a_cumprir', 'a_cumprir', 'sem_dado']);
    });
    it('RN-CORE-42: a lista sai sempre na ordem de INDICADORES_RESULTADO', () => {
        expect(resultadosDoPeriodo({ ...ABRIL, metas: [], realizado: null, visitas: [] }).map((r) => r.indicador)).toEqual(['venda_cents', 'positivacao', 'visitas', 'itens_por_pedido']);
    });
});
describe('RN-CORE-42 (D7): período Hoje usa a meta do dia (RN-CORE-26)', () => {
    const HOJE = {
        de: '2026-04-14',
        ate: '2026-04-14',
        hoje: '2026-04-14',
        calendario: SEG_SEX,
        perfil: 'vendedor',
    };
    it('RN-CORE-42: Faturamento: ⌈(180.000,00 − 84.600,00 até ontem) ÷ 12⌉ = 795.000; realizado de hoje; sem Meta/dia', () => {
        const r = resultado({
            ...HOJE,
            metas: METAS_ABRIL,
            realizado: realizado({ venda_cents: 500_000, venda_ate_ontem_cents: 8_460_000 }),
            visitas: [],
        }, 'venda_cents');
        expect(r).toMatchObject({
            meta: 795_000,
            realizado: 500_000,
            gap: 295_000,
            atingimento_pb: 6289,
            meta_dia: null,
            real_dia: 500_000,
            situacao: 'a_cumprir',
        });
    });
    it('RN-CORE-42: Positivação usa a positivação até ontem do servidor', () => {
        const r = resultado({
            ...HOJE,
            metas: METAS_ABRIL,
            realizado: realizado({ positivacao: 3, positivacao_ate_ontem: 38 }),
            visitas: [],
        }, 'positivacao');
        expect(r).toMatchObject({ meta: 3, realizado: 3, situacao: 'batida', gap: 0 });
    });
    it('RN-CORE-42: Visitas: meta do dia sobre as visitas do mês até ontem (90 de 200 → ⌈110 ÷ 12⌉ = 10)', () => {
        const visitas = [
            ...Array.from({ length: 9 }, (_, d) => visitasNoDia(`2026-04-0${d + 1}`, 10, `d${d}-`)).flat(),
            ...visitasNoDia('2026-04-14', 4),
        ];
        const r = resultado({ ...HOJE, metas: METAS_ABRIL, realizado: realizado(), visitas }, 'visitas');
        expect(r).toMatchObject({ meta: 10, realizado: 4, gap: 6, atingimento_pb: 4000 });
    });
    it('RN-CORE-42: mês já batido até ontem: meta do dia 0 e "batida", nunca negativa', () => {
        const r = resultado({
            ...HOJE,
            metas: METAS_ABRIL,
            realizado: realizado({ venda_cents: 0, venda_ate_ontem_cents: 20_000_000 }),
            visitas: [],
        }, 'venda_cents');
        expect(r).toMatchObject({ meta: 0, situacao: 'batida', gap: 0, atingimento_pb: null });
    });
    it('RN-CORE-42: Hoje num dia não útil (domingo): sem meta do dia', () => {
        const r = resultado({
            ...HOJE,
            de: '2026-04-12',
            ate: '2026-04-12',
            hoje: '2026-04-12',
            metas: METAS_ABRIL,
            realizado: realizado({ venda_cents: 10 }),
            visitas: [],
        }, 'venda_cents');
        expect(r).toMatchObject({ situacao: 'sem_meta', meta: null, realizado: 10, real_dia: null });
    });
    // A-4: meta do dia de itens = meta + (meta − real até ontem) × DU antes de hoje ÷ DU restantes contando hoje, para cima em
    // décimos. Abril, hoje 14/04: 8 DU antes de hoje e 12 restantes.
    const itensHoje = (r, e = {}) => resultado({
        ...HOJE,
        metas: METAS_ABRIL,
        realizado: realizado({ pedidos: 2, itens_distintos: 13, ...r }),
        visitas: [],
        ...e,
    }, 'itens_por_pedido');
    it('RN-CORE-42 (A-4): Itens em Hoje: meta do dia 800 + 170 × 8 ÷ 12 = 913,3 → 920 (até ontem 23 pedidos e 145 itens)', () => {
        expect(itensHoje({ pedidos_ate_ontem: 23, itens_distintos_ate_ontem: 145 })).toMatchObject({
            situacao: 'a_cumprir',
            meta: 920,
            realizado: 650,
            gap: 270,
            atingimento_pb: 7065,
            meta_dia: null,
            real_dia: null,
        });
    });
    it('RN-CORE-42 (A-4): Itens em Hoje sem pedido até ontem: a meta do mês', () => {
        expect(itensHoje({ pedidos_ate_ontem: 0, itens_distintos_ate_ontem: 0 })).toMatchObject({ meta: 800 });
    });
    it('RN-CORE-42 (A-4): Itens em Hoje sem o até ontem na cópia (nulo ou ausente): a meta do mês', () => {
        expect(itensHoje({ pedidos_ate_ontem: null, itens_distintos_ate_ontem: null })).toMatchObject({
            meta: 800,
        });
        expect(itensHoje({})).toMatchObject({ meta: 800 });
    });
    it('RN-CORE-42 (A-4): Itens em Hoje com o real até ontem na meta ou acima: a meta do mês (manter a média)', () => {
        expect(itensHoje({ pedidos_ate_ontem: 10, itens_distintos_ate_ontem: 80 })).toMatchObject({ meta: 800 });
        expect(itensHoje({ pedidos_ate_ontem: 10, itens_distintos_ate_ontem: 85 })).toMatchObject({ meta: 800 });
    });
    it('RN-CORE-42 (A-3, A-4): Itens em Hoje sem pedido hoje: realizado 0, Gap = meta do dia', () => {
        expect(itensHoje({ pedidos: 0, itens_distintos: 0, pedidos_ate_ontem: 23, itens_distintos_ate_ontem: 145 })).toMatchObject({ situacao: 'a_cumprir', meta: 920, realizado: 0, gap: 920, atingimento_pb: 0 });
    });
    it('RN-CORE-42 (A-4, RN-CORE-26): Itens em Hoje num dia não útil (domingo 12/04): sem meta do dia', () => {
        expect(itensHoje({ pedidos_ate_ontem: 23, itens_distintos_ate_ontem: 145 }, { de: '2026-04-12', ate: '2026-04-12', hoje: '2026-04-12' })).toMatchObject({ situacao: 'sem_meta', meta: null, realizado: 650 });
    });
    it('RN-CORE-42 (A-4): Itens em Hoje sem meta do mês: sem_meta', () => {
        expect(itensHoje({ pedidos_ate_ontem: 23, itens_distintos_ate_ontem: 145 }, { metas: [] })).toMatchObject({
            situacao: 'sem_meta',
            meta: null,
        });
    });
});
describe('RN-CORE-42 (A-4): pedidos e itens até ontem no contrato', () => {
    it('RN-CORE-42: a cópia do servidor aceita os dois campos, nulos sem fonte, e a cópia antiga sem eles', () => {
        expect(RealizadoServidorSchema.parse(realizado({ pedidos_ate_ontem: 23, itens_distintos_ate_ontem: 145 }))).toMatchObject({
            pedidos_ate_ontem: 23,
            itens_distintos_ate_ontem: 145,
        });
        expect(() => RealizadoServidorSchema.parse(realizado({ pedidos_ate_ontem: null, itens_distintos_ate_ontem: null }))).not.toThrow();
        expect(() => RealizadoServidorSchema.parse(realizado())).not.toThrow();
        expect(() => RealizadoServidorSchema.parse(realizado({ pedidos_ate_ontem: -1 }))).toThrow();
    });
});
describe('RN-CORE-42 (D7): período menor que o mês: meta proporcional aos dias úteis', () => {
    const NOV = [
        meta('2026-11', 'venda_cents', 19_000_000),
        meta('2026-11', 'positivacao', 70),
        meta('2026-11', 'itens_por_pedido', 700),
    ];
    it('RN-CORE-42: Esta semana (09 a 15/11, 5 de 19 dias úteis): 19.000.000 × 5 ÷ 19 = 5.000.000; sem Meta/dia', () => {
        const e = {
            de: '2026-11-09',
            ate: '2026-11-15',
            hoje: '2026-11-12',
            calendario: SEG_SEX,
            perfil: 'vendedor',
            metas: NOV,
            realizado: realizado({ venda_cents: 2_000_000, positivacao: 9, pedidos: 2, itens_distintos: 15 }),
            visitas: [],
        };
        expect(resultado(e, 'venda_cents')).toMatchObject({
            meta: 5_000_000,
            gap: 3_000_000,
            meta_dia: null,
            atingimento_pb: 4000,
        });
        expect(resultado(e, 'positivacao').meta).toBe(18); // round(70 × 5 ÷ 19 = 18,42)
        expect(resultado(e, 'itens_por_pedido')).toMatchObject({ meta: 700, realizado: 750, situacao: 'batida' });
    });
    // A-4: Esta semana com hoje útil (quinta 12/11: 7 DU antes de hoje, 12 restantes contando hoje): meta do dia de itens.
    const semana = (hoje, r = {}) => ({
        de: '2026-11-09',
        ate: '2026-11-15',
        hoje,
        calendario: SEG_SEX,
        perfil: 'vendedor',
        metas: NOV,
        realizado: realizado({
            pedidos: 2,
            itens_distintos: 15,
            pedidos_ate_ontem: 20,
            itens_distintos_ate_ontem: 100,
            ...r,
        }),
        visitas: [],
    });
    it('RN-CORE-42 (A-4): Itens em Esta semana: meta do dia 700 + 200 × 7 ÷ 12 = 816,7 → 820', () => {
        expect(resultado(semana('2026-11-12'), 'itens_por_pedido')).toMatchObject({
            situacao: 'a_cumprir',
            meta: 820,
            realizado: 750,
            gap: 70,
            atingimento_pb: 9146,
            meta_dia: null,
        });
    });
    it('RN-CORE-42 (A-4): Itens em Esta semana com hoje não útil (sábado 14/11): média ponderada pelos DU (700)', () => {
        expect(resultado(semana('2026-11-14'), 'itens_por_pedido')).toMatchObject({
            meta: 700,
            situacao: 'batida',
        });
    });
    it('RN-CORE-42 (A-4): a meta do dia de itens vale só em Hoje e Esta semana; outra semana fica na média ponderada', () => {
        // Semana passada (02 a 08/11), com hoje 12/11: não é Esta semana.
        expect(resultado({ ...semana('2026-11-12'), de: '2026-11-02', ate: '2026-11-08' }, 'itens_por_pedido')).toMatchObject({ meta: 700 });
        // De 10 a 16/11 (não é de segunda a domingo), com hoje dentro: também não.
        expect(resultado({ ...semana('2026-11-12'), de: '2026-11-10', ate: '2026-11-16' }, 'itens_por_pedido')).toMatchObject({ meta: 700 });
    });
    it('RN-CORE-42 (A-4): só Itens muda em Esta semana; Faturamento segue proporcional (5.000.000)', () => {
        expect(resultado(semana('2026-11-12', { venda_cents: 2_000_000 }), 'venda_cents')).toMatchObject({
            meta: 5_000_000,
        });
    });
    it('RN-CORE-42: semana que cruza o mês soma a parte de cada mês', () => {
        // 26/10 a 01/11: 5 dias úteis de outubro (21 no mês) e nenhum de novembro (01/11 é domingo).
        const e = {
            de: '2026-10-26',
            ate: '2026-11-01',
            hoje: '2026-11-12',
            calendario: SEG_SEX,
            perfil: 'vendedor',
            metas: [meta('2026-10', 'venda_cents', 21_000_000), ...NOV],
            realizado: realizado(),
            visitas: [],
        };
        expect(resultado(e, 'venda_cents').meta).toBe(5_000_000);
    });
    it('RN-CORE-42: Ontem num domingo: nenhum dia útil, sem meta', () => {
        const e = {
            de: '2026-11-08',
            ate: '2026-11-08',
            hoje: '2026-11-09',
            calendario: SEG_SEX,
            perfil: 'vendedor',
            metas: NOV,
            realizado: realizado({ venda_cents: 5 }),
            visitas: [],
        };
        expect(resultado(e, 'venda_cents')).toMatchObject({ situacao: 'sem_meta', meta: null, realizado: 5 });
    });
    it('RN-CORE-42: Ontem num dia útil: 1 dia de 19', () => {
        const e = {
            de: '2026-11-11',
            ate: '2026-11-11',
            hoje: '2026-11-12',
            calendario: SEG_SEX,
            perfil: 'vendedor',
            metas: NOV,
            realizado: realizado(),
            visitas: [],
        };
        expect(resultado(e, 'venda_cents').meta).toBe(1_000_000);
    });
});
describe('RN-CORE-42 (D7): período de vários meses', () => {
    const metas = [
        meta('2026-10', 'venda_cents', 21_000_000),
        meta('2026-11', 'venda_cents', 19_000_000),
        meta('2026-12', 'venda_cents', 22_000_000),
        meta('2026-10', 'positivacao', 60),
        meta('2026-11', 'positivacao', 70),
        meta('2026-10', 'itens_por_pedido', 800),
        meta('2026-11', 'itens_por_pedido', 600),
    ];
    const r = realizado({
        venda_cents: 30_000_000,
        positivacao: 80,
        pedidos: 40,
        itens_distintos: 280,
        por_mes: [
            { periodo: '2026-10', venda_cents: 20_000_000, positivacao: 55, pedidos: 30, itens_distintos: 210 },
            { periodo: '2026-11', venda_cents: 10_000_000, positivacao: 35, pedidos: 10, itens_distintos: 70 },
        ],
    });
    const ANO = {
        de: '2026-01-01',
        ate: '2026-12-31',
        hoje: '2026-11-12',
        calendario: SEG_SEX,
        perfil: 'vendedor',
        metas,
        realizado: r,
        visitas: [],
    };
    it('RN-CORE-42: Este ano: soma das metas dos meses até o mês de hoje (dezembro fica fora); sem Meta/dia', () => {
        expect(resultado(ANO, 'venda_cents')).toMatchObject({
            meta: 40_000_000,
            realizado: 30_000_000,
            gap: 10_000_000,
            meta_dia: null,
        });
    });
    it('RN-CORE-42: Positivação do ano = soma das positivações mensais (55 + 35 = 90), não a distinta do ano', () => {
        expect(resultado(ANO, 'positivacao')).toMatchObject({ meta: 130, realizado: 90 });
    });
    it('RN-CORE-42: Itens: Σ itens ÷ Σ pedidos (7,00) e meta média ponderada pelos pedidos de cada mês (7,50)', () => {
        expect(resultado(ANO, 'itens_por_pedido')).toMatchObject({ realizado: 700, meta: 750, meta_dia: null });
    });
    it('RN-CORE-42: ano sem nenhuma meta: sem_meta', () => {
        expect(resultado({ ...ANO, metas: [] }, 'venda_cents').situacao).toBe('sem_meta');
    });
});
