import { describe, expect, it } from 'vitest';
import { CALENDARIO_PADRAO, diasUteisRestantes } from './meta-do-dia';
import { baseDoPainel, baseDoTipoDaMeta, indicadoresDoPeriodo, necessidadeDiaria, painelDeMetas, painelDoUsuario, realizadoDosDiarios, tipoDaMetaDeVenda } from './metas';

describe('base das vendas pelo tipo da meta (RN-CORE-21)', () => {
  it('RN-CORE-21: meta de pedido = pedidos aprovados; meta de faturamento = notas faturadas', () => {
    expect(baseDoTipoDaMeta('pedido')).toBe('aprovado');
    expect(baseDoTipoDaMeta('faturamento')).toBe('faturado');
  });
  it('RN-CORE-21: o tipo vem da meta de venda do usuário; sem meta de venda vale pedido', () => {
    const metas = [
      { usuario_id: 'u1', indicador: 'visitas', tipo: 'pedido' },
      { usuario_id: 'u1', indicador: 'venda_cents', tipo: 'faturamento' },
      { usuario_id: 'u2', indicador: 'venda_cents', tipo: 'pedido' },
      { usuario_id: 'u3', indicador: 'visitas', tipo: 'faturamento' },
    ];
    expect(tipoDaMetaDeVenda(metas, 'u1')).toBe('faturamento');
    expect(tipoDaMetaDeVenda(metas, 'u2')).toBe('pedido');
    expect(tipoDaMetaDeVenda(metas, 'u3')).toBe('pedido');
    expect(tipoDaMetaDeVenda(metas, 'u4')).toBe('pedido');
  });
  it('RN-CORE-21: a base do painel é a das metas mostradas; tipos diferentes = misto; sem pessoa = pedidos aprovados', () => {
    expect(baseDoPainel(['pedido', 'pedido'])).toBe('aprovado');
    expect(baseDoPainel(['faturamento'])).toBe('faturado');
    expect(baseDoPainel(['faturamento', 'pedido'])).toBe('misto');
    expect(baseDoPainel([])).toBe('aprovado');
  });
  it('RN-CORE-21: o realizado segue o tipo da meta, com a virada do mês no fuso de Manaus (emissão para pedido, faturamento para faturamento)', () => {
    // 31/10 22h em Manaus (01/11 02h UTC): o pedido conta em outubro; faturado em 01/11 01h em Manaus (05h UTC) conta em novembro
    const pedidos = [
      { vendedor_id: 'u1', criado_por: 'u1', cliente_id: 'c1', emitido_em: '2026-11-01T02:00:00Z', aprovado_em: '2026-11-02T13:00:00Z', status: 'aprovado' as const, total_cents: 300_00, frete_cents: null, cancelado_cents: null },
      { vendedor_id: 'u1', criado_por: 'u1', cliente_id: 'c2', emitido_em: '2026-10-15T15:00:00Z', aprovado_em: '2026-10-15T15:00:00Z', status: 'faturado' as const, total_cents: 100_00, frete_cents: null, cancelado_cents: null },
    ];
    const faturamentos = [
      { vendedor_id: 'u1', cliente_id: 'c2', faturado_em: '2026-10-20T15:00:00Z', valor_cents: 80_00, cancelado_cents: null, devolvido_cents: 10_00 },
      { vendedor_id: 'u1', cliente_id: 'c1', faturado_em: '2026-11-01T05:00:00Z', valor_cents: 300_00, cancelado_cents: null, devolvido_cents: null },
    ];
    const linhas = { periodo: '2026-10', usuario_id: 'u1', hoje: '2026-10-31', paradas: [], visitas: [], diarios: [], metas: [{ usuario_id: 'u1', periodo: '2026-10', indicador: 'venda_cents' as const, valor: 1_000_00 }] };
    const comTipo = (tipo: 'pedido' | 'faturamento') => painelDoUsuario({ ...linhas, apuracao: { tipo, fuso: 'America/Manaus', pedidos, faturamentos } }).indicadores;
    expect(comTipo('pedido').realizado_cents).toBe(400_00);
    expect(comTipo('faturamento').realizado_cents).toBe(70_00);
    // RN-CORE-20: positivado por pedido aprovado emitido no período, qualquer que seja o tipo da meta
    expect(comTipo('pedido').positivados).toBe(2);
    expect(comTipo('faturamento').positivados).toBe(2);
  });
});

describe('necessidade diária (RN-CORE-22)', () => {
  it('RN-CORE-22: (meta − realizado) ÷ dias úteis restantes, arredondado para cima em centavos', () => {
    expect(necessidadeDiaria(1_000_00, 400_00, 7)).toBe(85_72);
  });
  it('RN-CORE-22: meta batida → necessidade zero (nunca negativa)', () => {
    expect(necessidadeDiaria(1_000_00, 1_200_00, 7)).toBe(0);
  });
  it('RN-CORE-22: sem dias úteis restantes devolve null (sem divisão por zero)', () => {
    expect(necessidadeDiaria(1_000_00, 400_00, 0)).toBeNull();
  });
});

describe('indicadores do período (RN-CORE-20)', () => {
  const paradas = [
    { rota_parada_id: 'p1', cliente_id: 'c1', data: '2026-10-05' },
    { rota_parada_id: 'p2', cliente_id: 'c2', data: '2026-10-05' },
    { rota_parada_id: 'p3', cliente_id: 'c3', data: '2026-10-06' },
    { rota_parada_id: 'p4', cliente_id: 'c4', data: '2026-10-06' },
    { rota_parada_id: 'p9', cliente_id: 'c9', data: '2026-09-30' },
  ];
  const visitas = [
    { cliente_id: 'c1', data_local: '2026-10-05' },
    { cliente_id: 'c1', data_local: '2026-10-05' }, // check-in repetido no dia conta uma vez
    { cliente_id: 'c3', data_local: '2026-10-06' },
    { cliente_id: 'c7', data_local: '2026-10-06' }, // visita extra não entra na cobertura
    { cliente_id: 'c2', data_local: '2026-10-07' }, // dia errado
  ];

  it('RN-CORE-20: visitado = check-in no dia da parada; cobertura = visitados ÷ planejados em pontos-base', () => {
    const r = indicadoresDoPeriodo({ periodo: '2026-10', usuario_id: 'u1', paradas, visitas, hoje: '2026-10-08' });
    expect(r.planejados).toBe(4);
    expect(r.visitados).toBe(2);
    expect(r.cobertura_pct).toBe(5000);
  });
  it('RN-CORE-20: sem planejados a cobertura é 0, sem dividir por zero', () => {
    expect(indicadoresDoPeriodo({ periodo: '2026-10', usuario_id: 'u1', paradas: [], visitas, hoje: '2026-10-08' }).cobertura_pct).toBe(0);
  });
  it('sem pedidos disponíveis (ainda não há no servidor) positivados e realizado ficam nulos', () => {
    const r = indicadoresDoPeriodo({ periodo: '2026-10', usuario_id: 'u1', paradas, visitas, hoje: '2026-10-08' });
    expect(r.positivados).toBeNull();
    expect(r.realizado_cents).toBeNull();
    expect(r.necessidade_diaria_cents).toBeNull();
  });
  it('RN-CORE-22: necessidade diária usa dias úteis restantes (hoje conta) e a meta de venda', () => {
    const r = indicadoresDoPeriodo({
      periodo: '2026-10',
      usuario_id: 'u1',
      paradas,
      visitas,
      hoje: '2026-10-26', // RN-CORE-26: seg a sáb do tenant: 26..31 = 6 dias
      apurado: { realizado_cents: 500_00, positivados: 1 },
      meta_cents: 1_000_00,
    });
    expect(r.dias_uteis_restantes).toBe(6);
    expect(r.necessidade_diaria_cents).toBe(Math.ceil(500_00 / 6));
  });
  it('feriados reduzem os dias úteis restantes', () => {
    const r = indicadoresDoPeriodo({ periodo: '2026-10', usuario_id: 'u1', paradas: [], visitas: [], hoje: '2026-10-26', feriados: ['2026-10-28'] });
    expect(r.dias_uteis_restantes).toBe(5);
  });
  it('RN-CORE-26: dias úteis da necessidade diária vêm do calendário do tenant (seg–sáb por padrão), o mesmo do Início', () => {
    const base = { periodo: '2026-11', usuario_id: 'u1', paradas: [], visitas: [], hoje: '2026-11-10' };
    expect(indicadoresDoPeriodo(base).dias_uteis_restantes).toBe(diasUteisRestantes('2026-11', '2026-11-10', CALENDARIO_PADRAO));
    expect(indicadoresDoPeriodo(base).dias_uteis_restantes).toBe(18);
    expect(indicadoresDoPeriodo({ ...base, calendario: { dias_uteis_semana: [1, 2, 3, 4, 5] } }).dias_uteis_restantes).toBe(15);
  });
});

describe('read-model diário e painel de metas (RN-CORE-20 a 22; T-0020 fase 1)', () => {
  const diario = (data: string, vendido: number, cancelado = 0, usuario_id = 'u1') => ({ usuario_id, data, pedidos: 1, vendido_cents: vendido, cancelado_cents: cancelado });
  const paradas = [
    { cliente_id: 'c1', data: '2026-10-05' },
    { cliente_id: 'c2', data: '2026-10-05' },
    { cliente_id: 'c3', data: '2026-10-06' },
    { cliente_id: 'c4', data: '2026-10-07' },
  ];
  const visitas = [
    { cliente_id: 'c1', data_local: '2026-10-05' },
    { cliente_id: 'c3', data_local: '2026-10-06' },
    { cliente_id: 'c9', data_local: '2026-10-06' },
  ];

  it('RN-CORE-21: realizado dos diários é líquido de cancelamentos, só do usuário e do período', () => {
    const r = realizadoDosDiarios([diario('2026-10-02', 500_00, 100_00), diario('2026-10-03', 200_00), diario('2026-09-30', 900_00), diario('2026-10-03', 700_00, 0, 'u2')], { usuario_id: 'u1', periodo: '2026-10' });
    expect(r).toBe(600_00);
  });
  it('RN-CORE-21: cancelado maior que vendido no dia nunca deixa o dia negativo', () => {
    expect(realizadoDosDiarios([diario('2026-10-02', 50_00, 80_00)], { usuario_id: 'u1', periodo: '2026-10' })).toBe(0);
  });
  it('RN-CORE-20/22: sem pedidos nem diários o realizado e a positivação são nulos ("aguardando pedidos")', () => {
    const r = indicadoresDoPeriodo({ periodo: '2026-10', usuario_id: 'u1', paradas, visitas, hoje: '2026-10-07', meta_cents: 1_000_00 });
    expect(r).toMatchObject({ planejados: 4, visitados: 2, cobertura_pct: 5000, positivados: null, realizado_cents: null, necessidade_diaria_cents: null });
  });
  it('RN-CORE-21/22: com diários o realizado entra e a necessidade diária usa os dias úteis restantes', () => {
    const r = indicadoresDoPeriodo({ periodo: '2026-10', usuario_id: 'u1', paradas, visitas, hoje: '2026-10-07', meta_cents: 1_000_00, diarios: [diario('2026-10-02', 400_00)] });
    expect(r.realizado_cents).toBe(400_00);
    expect(r.positivados).toBeNull();
    expect(r.necessidade_diaria_cents).toBe(necessidadeDiaria(1_000_00, 400_00, r.dias_uteis_restantes));
  });
  it('RN-CORE-20: o painel compara cada meta com o realizado do mesmo indicador (cobertura em pontos-base)', () => {
    const p = painelDeMetas(
      { periodo: '2026-10', usuario_id: 'u1', paradas, visitas, hoje: '2026-10-07', diarios: [diario('2026-10-02', 400_00)] },
      [
        { indicador: 'venda_cents', valor: 1_000_00 },
        { indicador: 'visitas', valor: 4 },
        { indicador: 'cobertura_pct', valor: 8000 },
        { indicador: 'positivacao', valor: 10 },
      ],
    );
    expect(p.indicadores.meta_cents).toBe(1_000_00);
    const por = Object.fromEntries(p.metas.map((m) => [m.indicador, m]));
    expect(por.venda_cents).toMatchObject({ meta: 1_000_00, realizado: 400_00, atingimento_pct: 4000 });
    expect(por.visitas).toMatchObject({ meta: 4, realizado: 2, atingimento_pct: 5000 });
    expect(por.cobertura_pct).toMatchObject({ meta: 8000, realizado: 5000, atingimento_pct: 6250 });
    expect(por.positivacao).toMatchObject({ meta: 10, realizado: null, atingimento_pct: null });
  });
  it('RN-CORE-20: meta zero não divide por zero (atingimento nulo)', () => {
    const p = painelDeMetas({ periodo: '2026-10', usuario_id: 'u1', paradas, visitas, hoje: '2026-10-07' }, [{ indicador: 'visitas', valor: 0 }]);
    expect(p.metas[0]?.atingimento_pct).toBeNull();
  });
  it('RN-CORE-20: o mesmo dado dá o mesmo número (app e BKO usam a mesma função)', () => {
    const e = { periodo: '2026-10', usuario_id: 'u1', paradas, visitas, hoje: '2026-10-07', diarios: [diario('2026-10-02', 400_00)] };
    const m = [{ indicador: 'venda_cents' as const, valor: 1_000_00 }];
    expect(painelDeMetas(structuredClone(e), structuredClone(m))).toEqual(painelDeMetas(e, m));
  });
});

describe('painel do usuário a partir das linhas de sync (critério 2: mesmos números no app e no BKO)', () => {
  const base = {
    periodo: '2026-10',
    usuario_id: 'u1',
    hoje: '2026-10-07',
    paradas: [
      { usuario_id: 'u1', cliente_id: 'c1', data: '2026-10-05' },
      { usuario_id: 'u1', cliente_id: 'c2', data: '2026-10-05' },
      { usuario_id: 'u1', cliente_id: 'c3', data: '2026-10-06', deleted_at: '2026-10-06T00:00:00Z' },
      { usuario_id: 'u2', cliente_id: 'c4', data: '2026-10-06' },
    ],
    visitas: [
      { usuario_id: 'u1', cliente_id: 'c1', data_local: '2026-10-05' },
      { usuario_id: 'u2', cliente_id: 'c4', data_local: '2026-10-06' },
    ],
    diarios: [
      { usuario_id: 'u1', data: '2026-10-02', pedidos: 2, vendido_cents: 300_00, cancelado_cents: 50_00 },
      { usuario_id: 'u2', data: '2026-10-02', pedidos: 1, vendido_cents: 900_00, cancelado_cents: 0 },
    ],
    metas: [
      { usuario_id: 'u1', periodo: '2026-10', indicador: 'venda_cents' as const, valor: 1_000_00 },
      { usuario_id: 'u1', periodo: '2026-09', indicador: 'venda_cents' as const, valor: 5_00 },
      { usuario_id: 'u2', periodo: '2026-10', indicador: 'venda_cents' as const, valor: 7_00 },
    ],
  };
  it('RN-CORE-20/21: ignora removidas, outro usuário e outro mês', () => {
    const p = painelDoUsuario(base);
    expect(p.indicadores).toMatchObject({ planejados: 2, visitados: 1, cobertura_pct: 5000, realizado_cents: 250_00, meta_cents: 1_000_00 });
    expect(p.metas).toHaveLength(1);
  });
  it('RN-CORE-20: ordem das linhas não muda o resultado (app lê do SQLite, API do Postgres)', () => {
    const invertido = { ...base, paradas: [...base.paradas].reverse(), visitas: [...base.visitas].reverse(), diarios: [...base.diarios].reverse(), metas: [...base.metas].reverse() };
    expect(painelDoUsuario(invertido)).toEqual(painelDoUsuario(base));
  });
});

describe('T-0065 B: painel pela apuração do tipo da meta (RN-CORE-21)', () => {
  const linhas = {
    periodo: '2026-10',
    usuario_id: 'u1',
    hoje: '2026-10-20',
    paradas: [],
    visitas: [],
    diarios: [{ usuario_id: 'u1', data: '2026-10-02', pedidos: 1, vendido_cents: 9_999_00, cancelado_cents: 0 }],
    metas: [
      { usuario_id: 'u1', periodo: '2026-10', indicador: 'venda_cents' as const, valor: 1_000_00 },
      { usuario_id: 'u1', periodo: '2026-10', indicador: 'positivacao' as const, valor: 2 },
    ],
  };
  const pedido = (over: Record<string, unknown>) => ({ vendedor_id: 'u1', cliente_id: 'c1', emitido_em: '2026-10-31T15:00:00Z', status: 'aprovado', total_cents: 100_00, ...over });

  it('RN-CORE-21: meta de pedido conta aprovados pela data de emissão (31/10 aprovado em 02/11 fica em outubro) e positiva por cliente', () => {
    const p = painelDoUsuario({
      ...linhas,
      apuracao: { tipo: 'pedido', fuso: 'America/Manaus', pedidos: [pedido({ aprovado_em: '2026-11-02T12:00:00Z' }), pedido({ cliente_id: 'c2', status: 'aguardando_aprovacao' }), pedido({ cliente_id: 'c3', status: 'cancelado' })], faturamentos: [] },
    });
    expect(p.indicadores.realizado_cents).toBe(100_00);
    expect(p.indicadores.positivados).toBe(1);
    expect(p.metas.find((m) => m.indicador === 'positivacao')?.realizado).toBe(1);
  });

  it('RN-CORE-21: meta de faturamento usa a data do faturamento, líquida de devolução, e ignora o read-model diário', () => {
    const p = painelDoUsuario({
      ...linhas,
      apuracao: {
        tipo: 'faturamento',
        fuso: 'America/Manaus',
        pedidos: [pedido({})],
        faturamentos: [
          { vendedor_id: 'u1', faturado_em: '2026-10-10T15:00:00Z', valor_cents: 300_00, devolvido_cents: 50_00 },
          { vendedor_id: 'u1', faturado_em: '2026-11-03T15:00:00Z', valor_cents: 999_00 },
        ],
      },
    });
    expect(p.indicadores.realizado_cents).toBe(250_00);
    expect(p.indicadores.positivados).toBe(1);
  });

  it('RN-CORE-21: sem apuração (fonte de pedidos indisponível) mantém o read-model diário', () => {
    expect(painelDoUsuario(linhas).indicadores.realizado_cents).toBe(9_999_00);
  });
});

describe('T-0170 (A-4): Itens por pedido no painel de metas', () => {
  const linhas = {
    periodo: '2026-11',
    usuario_id: 'u1',
    hoje: '2026-11-20',
    paradas: [],
    visitas: [],
    diarios: [],
    metas: [
      { usuario_id: 'u1', periodo: '2026-11', indicador: 'itens_por_pedido' as const, valor: 800 },
      { usuario_id: 'u1', periodo: '2026-11', indicador: 'venda_cents' as const, valor: 1_000_00 },
    ],
  };
  const pedido = (itens?: number) => ({ vendedor_id: 'u1', cliente_id: 'c1', emitido_em: '2026-11-10T14:00:00Z', status: 'aprovado', total_cents: 100_00, ...(itens === undefined ? {} : { itens_distintos: itens }) });
  it('T-0170: com itens_distintos da consulta do Vendedor, realizado em centésimos e atingimento sobre a meta; linha depois das outras', () => {
    const p = painelDoUsuario({ ...linhas, apuracao: { tipo: 'pedido', fuso: 'America/Manaus', pedidos: [pedido(6), pedido(4)] } });
    expect(p.metas.map((m) => m.indicador)).toEqual(['venda_cents', 'itens_por_pedido']);
    expect(p.metas[1]).toEqual({ indicador: 'itens_por_pedido', meta: 800, realizado: 500, atingimento_pct: 6250 });
  });
  it('T-0170: sem itens_distintos ou sem a consulta do Vendedor, realizado nulo (sem dado)', () => {
    expect(painelDoUsuario({ ...linhas, apuracao: { tipo: 'pedido', fuso: 'America/Manaus', pedidos: [pedido()] } }).metas[1]).toMatchObject({ realizado: null, atingimento_pct: null });
    expect(painelDoUsuario(linhas).metas[1]).toMatchObject({ realizado: null, atingimento_pct: null });
  });
});
