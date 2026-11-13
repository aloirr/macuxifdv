/**
 * T-0170 — os 4 cards de Resultados (`resultadosDoPeriodo`, RN-CORE-42, RN-CORE-21/26/27, D1–D7), sem banco.
 * Mês sintético e oráculo: docs/testes/T-0170-performance.md §1.2, §3 e §3.2 (R-1 a R-15, V-1, V-2). Valores contados à
 * mão; Gap = máx(0, meta − real), Meta/dia = ⌈Gap ÷ restantes⌉, Real/dia = round(real ÷ decorridos), atingimento em pb.
 * Calendário: segunda a sexta, feriados nacionais 02/11 e 20/11; hoje = sexta 13/11/2026 (DU 9 de 19, 11 restantes).
 *
 * Divergências com as respostas do Alexandre (A-3 e A-4, 13/11/2026) ficam em `it.fails` e foram por recado ao
 * modulo-core: o testes não corrige o domain.
 */
import { describe, expect, it } from 'vitest';

import type { IndicadorResultado, RealizadoServidor, ResultadoIndicador } from '../../modules/core/contracts/performance';
import type { CalendarioTenant } from '../../modules/core/domain/meta-do-dia';
import {
  resultadosDoPeriodo,
  type EntradaResultados,
  type MetaDoMes,
  type VisitaContavel,
} from '../../modules/core/domain/performance/resultados';

const CAL: CalendarioTenant = { dias_uteis_semana: [1, 2, 3, 4, 5], feriados: [] };

/** Visitas contadas por dia no mês sintético (§1.3): 59 até hoje, 55 até ontem, 27 na semana 09–13/11. */
const POR_DIA: ReadonlyArray<readonly [string, number]> = [
  ['2026-11-03', 8], ['2026-11-04', 8], ['2026-11-05', 6], ['2026-11-06', 7], ['2026-11-07', 3],
  ['2026-11-09', 8], ['2026-11-11', 7], ['2026-11-12', 8], ['2026-11-13', 4],
];
const VISITAS: VisitaContavel[] = [
  ...POR_DIA.flatMap(([data, n]) => Array.from({ length: n }, (_, i) => ({ cliente_id: `${data}-c${i + 1}`, data_local: data }))),
  // 11/11: segunda visita ao mesmo cliente no dia (conta 1, RN-CORE-20).
  { cliente_id: '2026-11-11-c1', data_local: '2026-11-11' },
  // 09/11: visita removida (fora de tudo).
  { cliente_id: '2026-11-09-removida', data_local: '2026-11-09', deleted_at: '2026-11-09T22:00:00.000Z' },
];
const ateDia = (data: string) => VISITAS.filter((v) => v.data_local <= data);

const METAS_NOV: MetaDoMes[] = [
  { periodo: '2026-11', indicador: 'venda_cents', valor: 18_000_000 },
  { periodo: '2026-11', indicador: 'positivacao', valor: 70 },
  { periodo: '2026-11', indicador: 'visitas', valor: 200 },
  { periodo: '2026-11', indicador: 'itens_por_pedido', valor: 800 },
];

const realizado = (o: Partial<RealizadoServidor> = {}): RealizadoServidor => ({
  tipo_meta_venda: 'pedido',
  venda_cents: 8_460_000,
  venda_ate_ontem_cents: 8_100_000,
  positivacao: 38,
  positivacao_ate_ontem: 36,
  pedidos: 25,
  itens_distintos: 160,
  por_mes: [],
  ...o,
});

const entrada = (o: Partial<EntradaResultados> = {}): EntradaResultados => ({
  de: '2026-11-01',
  ate: '2026-11-30',
  hoje: '2026-11-13',
  calendario: CAL,
  perfil: 'vendedor',
  metas: METAS_NOV,
  realizado: realizado(),
  visitas: VISITAS,
  ...o,
});

const card = (l: readonly ResultadoIndicador[], ind: IndicadorResultado): ResultadoIndicador => {
  const c = l.find((x) => x.indicador === ind);
  if (!c) throw new Error(`card ausente: ${ind}`);
  return c;
};

describe('T-0170 · Resultados do mês, hoje 13/11 (RN-CORE-42)', () => {
  const r = resultadosDoPeriodo(entrada());

  it('R-1 · RN-CORE-42/21/22: Vendas 47,0%, Gap 9.540.000, Meta/dia ⌈9.540.000 ÷ 11⌉, Real/dia 8.460.000 ÷ 9', () => {
    expect(card(r, 'venda_cents')).toEqual({
      indicador: 'venda_cents', situacao: 'a_cumprir', meta: 18_000_000, realizado: 8_460_000,
      atingimento_pb: 4700, gap: 9_540_000, meta_dia: 867_273, real_dia: 940_000,
    });
  });

  it('R-2 · RN-CORE-42/20: Positivação 38/70, Meta/dia ⌈32 ÷ 11⌉ = 3, Real/dia round(38 ÷ 9) = 4', () => {
    expect(card(r, 'positivacao')).toEqual({
      indicador: 'positivacao', situacao: 'a_cumprir', meta: 70, realizado: 38,
      atingimento_pb: 5429, gap: 32, meta_dia: 3, real_dia: 4,
    });
  });

  it('R-3 · RN-CORE-42/20, D3: Visitas = 59 pares cliente × dia (extras e sábado sim, removida não, G1 duas vezes = 1)', () => {
    expect(card(r, 'visitas')).toEqual({
      indicador: 'visitas', situacao: 'a_cumprir', meta: 200, realizado: 59,
      atingimento_pb: 2950, gap: 141, meta_dia: 13, real_dia: 7,
    });
  });

  it('R-4 · RN-CORE-42, D2: Itens por pedido 6,40; Meta/pedido 8 + 1,6 × 9 ÷ 11 = 9,31 → 9,4; sem Real/dia', () => {
    expect(card(r, 'itens_por_pedido')).toEqual({
      indicador: 'itens_por_pedido', situacao: 'a_cumprir', meta: 800, realizado: 640,
      atingimento_pb: 8000, gap: 160, meta_dia: 940, real_dia: null,
    });
  });
});

describe('T-0170 · variações dos Resultados (RN-CORE-42)', () => {
  it('R-5 · RN-CORE-42/26: meta batida (positivação 72/70): batida, Gap 0, sem Meta/dia, atingimento passa de 10000', () => {
    const c = card(resultadosDoPeriodo(entrada({ realizado: realizado({ positivacao: 72 }) })), 'positivacao');
    expect(c).toMatchObject({ situacao: 'batida', atingimento_pb: 10_286, gap: 0, meta_dia: null, real_dia: 8 });
  });

  it('R-6 · RN-CORE-42: itens batida (170 ÷ 20 = 8,50): batida, Gap 0, sem Meta/pedido', () => {
    const c = card(
      resultadosDoPeriodo(entrada({ realizado: realizado({ pedidos: 20, itens_distintos: 170 }) })),
      'itens_por_pedido',
    );
    expect(c).toMatchObject({ situacao: 'batida', realizado: 850, atingimento_pb: 10_625, gap: 0, meta_dia: null });
  });

  const semPedido = () =>
    card(resultadosDoPeriodo(entrada({ realizado: realizado({ pedidos: 0, itens_distintos: 0 }) })), 'itens_por_pedido');

  it('R-7 · RN-CORE-42: sem pedido no período, a Meta/pedido é a própria meta (800) e o card fica a cumprir', () => {
    expect(semPedido()).toMatchObject({ situacao: 'a_cumprir', meta: 800, meta_dia: 800 });
  });

  // D-T0170-R7 (A-3, resposta de 13/11: "0"): sem pedido, Itens por pedido mostra 0, não "—". Transição da T-0170 (um
  // agente por PR): aceita o domain antigo (nulos) e o corrigido (0, 0, 800) até o PR do Core entrar; o PR seguinte do
  // testes deixa só o valor corrigido.
  it('R-7 · RN-CORE-42 (A-3): sem pedido, realizado 0, atingimento 0 e Gap 800 (transição: antigo nulo)', () => {
    const { realizado: real, atingimento_pb, gap } = semPedido();
    expect([
      { realizado: 0, atingimento_pb: 0, gap: 800 },
      { realizado: null, atingimento_pb: null, gap: null },
    ]).toContainEqual({ realizado: real, atingimento_pb, gap });
  });

  it('R-8 · RN-CORE-42: Mês passado (outubro, 21 DU) encerrado: sem Meta/dia, Real/dia 15.120.000 ÷ 21', () => {
    const c = card(
      resultadosDoPeriodo(
        entrada({
          de: '2026-10-01',
          ate: '2026-10-31',
          metas: [{ periodo: '2026-10', indicador: 'venda_cents', valor: 17_000_000 }],
          realizado: realizado({ venda_cents: 15_120_000, venda_ate_ontem_cents: null }),
        }),
      ),
      'venda_cents',
    );
    expect(c).toEqual({
      indicador: 'venda_cents', situacao: 'a_cumprir', meta: 17_000_000, realizado: 15_120_000,
      atingimento_pb: 8894, gap: 1_880_000, meta_dia: null, real_dia: 720_000,
    });
  });

  it('R-9 · RN-CORE-41/42: dia 1 num domingo: sem Real/dia (0 decorridos), Meta/dia ⌈18.000.000 ÷ 19⌉', () => {
    const c = card(
      resultadosDoPeriodo(
        entrada({ hoje: '2026-11-01', visitas: [], realizado: realizado({ venda_cents: 0, venda_ate_ontem_cents: 0 }) }),
      ),
      'venda_cents',
    );
    expect(c).toMatchObject({ realizado: 0, atingimento_pb: 0, gap: 18_000_000, meta_dia: 947_369, real_dia: null });
  });

  describe('R-10 · período Hoje (13/11): a meta é a meta do dia da RN-CORE-26', () => {
    const hoje = () =>
      resultadosDoPeriodo(
        entrada({
          de: '2026-11-13',
          ate: '2026-11-13',
          realizado: realizado({ venda_cents: 360_000, positivacao: 2, pedidos: 2, itens_distintos: 15 }),
        }),
      );

    it('Vendas: meta ⌈(18.000.000 − 8.100.000) ÷ 11⌉ = 900.000; realizado 360.000; 40,0%; sem Meta/dia', () => {
      expect(card(hoje(), 'venda_cents')).toMatchObject({
        situacao: 'a_cumprir', meta: 900_000, realizado: 360_000, atingimento_pb: 4000, gap: 540_000, meta_dia: null,
      });
    });

    it('Positivação: meta ⌈(70 − 36) ÷ 11⌉ = 4; realizado 2; 50,0%', () => {
      expect(card(hoje(), 'positivacao')).toMatchObject({ meta: 4, realizado: 2, atingimento_pb: 5000, meta_dia: null });
    });

    it('Visitas: meta ⌈(200 − 55) ÷ 11⌉ = 14; realizado 4; 28,6%', () => {
      expect(card(hoje(), 'visitas')).toMatchObject({ meta: 14, realizado: 4, atingimento_pb: 2857, meta_dia: null });
    });

    // Divergência D-T0170-A4 (A-4, Alexandre 13/11: "Meta do dia", conta confirmada): em Hoje a meta de Itens por pedido é
    // 800 + (800 − 630) × 8 ÷ 11 = 923,6 → 930, com o realizado até ontem (23 pedidos, 145 itens). A função usa a meta do
    // mês (800) e o contrato não traz pedidos e itens até ontem. Recado ao modulo-core.
    it.fails('Itens por pedido (A-4): meta do dia 930; realizado 750; atingimento 8065', () => {
      expect(card(hoje(), 'itens_por_pedido')).toMatchObject({ meta: 930, realizado: 750, atingimento_pb: 8065, gap: 180 });
    });
  });

  describe('R-11 · Esta semana (09–15/11, D7): meta proporcional a 5 de 19 DU, sem Meta/dia', () => {
    const semana = () =>
      resultadosDoPeriodo(
        entrada({
          de: '2026-11-09',
          ate: '2026-11-15',
          realizado: realizado({ venda_cents: 2_000_000, positivacao: 15, pedidos: 12, itens_distintos: 84 }),
        }),
      );

    it('Vendas round(18.000.000 × 5 ÷ 19), Positivação round(70 × 5 ÷ 19), Visitas round(200 × 5 ÷ 19) com 27', () => {
      const r = semana();
      expect(card(r, 'venda_cents')).toMatchObject({ meta: 4_736_842, atingimento_pb: 4222, gap: 2_736_842, meta_dia: null });
      expect(card(r, 'positivacao')).toMatchObject({ meta: 18, realizado: 15, atingimento_pb: 8333, gap: 3, meta_dia: null });
      expect(card(r, 'visitas')).toMatchObject({ meta: 53, realizado: 27, atingimento_pb: 5094, meta_dia: null });
    });

    // Divergência D-T0170-A4: na semana, a meta de Itens por pedido é a meta do dia de hoje (930); a função usa a média
    // ponderada pelos DU (800). Recado ao modulo-core.
    it.fails('Itens por pedido (A-4): meta do dia 930; realizado 700; atingimento 7527', () => {
      expect(card(semana(), 'itens_por_pedido')).toMatchObject({ meta: 930, realizado: 700, atingimento_pb: 7527, gap: 230 });
    });
  });

  it('R-12 · D7: um dia escolhido (10/11, falta): metas de 1 de 19 DU, realizado 0, sem Meta/dia', () => {
    const r = resultadosDoPeriodo(
      entrada({
        de: '2026-11-10',
        ate: '2026-11-10',
        realizado: realizado({ venda_cents: 0, positivacao: 0, pedidos: 0, itens_distintos: 0 }),
      }),
    );
    expect(card(r, 'venda_cents')).toMatchObject({ meta: 947_368, realizado: 0, atingimento_pb: 0, meta_dia: null });
    expect(card(r, 'visitas')).toMatchObject({ meta: 11, realizado: 0, atingimento_pb: 0, meta_dia: null });
    expect(card(r, 'positivacao')).toMatchObject({ meta: 4, realizado: 0, atingimento_pb: 0, meta_dia: null });
  });

  it('R-13 · RN-PRO-01: promotor vê só Visitas; Vendas, Positivação e Itens sem dado', () => {
    const r = resultadosDoPeriodo(entrada({ perfil: 'promotor' }));
    expect(r.map((c) => [c.indicador, c.situacao])).toEqual([
      ['venda_cents', 'sem_dado'], ['positivacao', 'sem_dado'], ['visitas', 'a_cumprir'], ['itens_por_pedido', 'sem_dado'],
    ]);
    expect(card(r, 'visitas').realizado).toBe(59);
  });

  it('R-14 · RN-CORE-27: Vendedor desligado sem notas: Vendas, Positivação e Itens sem dado (nunca 0)', () => {
    const r = resultadosDoPeriodo(
      entrada({
        realizado: realizado({
          venda_cents: null, venda_ate_ontem_cents: null, positivacao: null, positivacao_ate_ontem: null,
          pedidos: null, itens_distintos: null,
        }),
      }),
    );
    for (const ind of ['venda_cents', 'positivacao', 'itens_por_pedido'] as const)
      expect(card(r, ind)).toMatchObject({ situacao: 'sem_dado', realizado: null, meta: null });
    expect(card(r, 'visitas')).toMatchObject({ situacao: 'a_cumprir', realizado: 59 });
  });

  it('R-15 · §2.3: mês sem meta: os 4 sem meta, com o realizado visível', () => {
    const r = resultadosDoPeriodo(entrada({ metas: [] }));
    expect(r.map((c) => c.situacao)).toEqual(['sem_meta', 'sem_meta', 'sem_meta', 'sem_meta']);
    expect(card(r, 'venda_cents')).toMatchObject({ realizado: 8_460_000, atingimento_pb: null, gap: null, meta_dia: null });
    expect(card(r, 'visitas').realizado).toBe(59);
  });
});

describe('T-0170 · virada do dia sem sinal nos Resultados (RN-CORE-26, §7.1 do desenho)', () => {
  const copia12 = realizado({ venda_cents: 8_100_000, positivacao: 36 });

  it('V-1 · com a cópia de 12/11, no próprio 12/11: Meta/dia 825.000 e Real/dia 1.012.500 (8 decorridos, 12 restantes)', () => {
    const c = card(resultadosDoPeriodo(entrada({ hoje: '2026-11-12', realizado: copia12, visitas: ateDia('2026-11-12') })), 'venda_cents');
    expect(c).toMatchObject({ meta_dia: 825_000, real_dia: 1_012_500 });
  });

  it('V-1 · a mesma cópia em 13/11 offline: recalcula com o hoje do aparelho (9 decorridos, 11 restantes)', () => {
    const r = resultadosDoPeriodo(entrada({ realizado: copia12, visitas: ateDia('2026-11-12') }));
    expect(card(r, 'venda_cents')).toMatchObject({ atingimento_pb: 4500, gap: 9_900_000, meta_dia: 900_000, real_dia: 900_000 });
    expect(card(r, 'positivacao')).toMatchObject({ atingimento_pb: 5143, gap: 34, meta_dia: 4, real_dia: 4 });
    expect(card(r, 'visitas')).toMatchObject({ realizado: 55, atingimento_pb: 2750, gap: 145, meta_dia: 14, real_dia: 6 });
  });

  it('V-1 · a Meta/dia offline de 13/11 é a meta do dia de Hoje (R-10): 900.000, 4 e 14', () => {
    const mes = resultadosDoPeriodo(entrada({ realizado: copia12, visitas: ateDia('2026-11-12') }));
    const hoje = resultadosDoPeriodo(entrada({ de: '2026-11-13', ate: '2026-11-13', visitas: ateDia('2026-11-12') }));
    for (const ind of ['venda_cents', 'positivacao', 'visitas'] as const)
      expect(card(mes, ind).meta_dia).toBe(card(hoje, ind).meta);
  });

  it('V-2 · cópia de 13/11 em sábado 14/11 offline: 9 decorridos, 10 restantes: Meta/dia 954.000, Real/dia 940.000', () => {
    const c = card(resultadosDoPeriodo(entrada({ hoje: '2026-11-14' })), 'venda_cents');
    expect(c).toMatchObject({ meta_dia: 954_000, real_dia: 940_000 });
  });
});
