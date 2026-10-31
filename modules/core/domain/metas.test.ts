import { describe, expect, it } from 'vitest';
import { indicadoresDoPeriodo, necessidadeDiaria, realizadoDaMeta, type PedidoApuravel } from './metas';

const ped = (over: Partial<PedidoApuravel>): PedidoApuravel => ({
  vendedor_id: 'u1',
  data: '2026-10-05',
  total_cents: 100_00,
  aprovado: true,
  faturado: false,
  cancelado: false,
  ...over,
});

describe('realizado da meta (RN-CORE-21)', () => {
  it('RN-CORE-21: base aprovado soma aprovados e faturados do vendedor no período', () => {
    const r = realizadoDaMeta([ped({}), ped({ aprovado: false, faturado: true, total_cents: 50_00 }), ped({ aprovado: false })], { usuario_id: 'u1', periodo: '2026-10', base: 'aprovado' });
    expect(r).toBe(150_00);
  });
  it('RN-CORE-21: base faturado ignora o que só foi aprovado', () => {
    const r = realizadoDaMeta([ped({}), ped({ aprovado: false, faturado: true, total_cents: 50_00 })], { usuario_id: 'u1', periodo: '2026-10', base: 'faturado' });
    expect(r).toBe(50_00);
  });
  it('RN-CORE-21: líquido de cancelamentos — cancelado sai e cancelamento parcial abate', () => {
    const r = realizadoDaMeta([ped({ cancelado: true }), ped({ total_cents: 200_00, cancelado_cents: 30_00 })], { usuario_id: 'u1', periodo: '2026-10', base: 'aprovado' });
    expect(r).toBe(170_00);
  });
  it('RN-CORE-21: pedido feito pelo gestor em nome do vendedor conta para o vendedor, não para o gestor', () => {
    const emNome = ped({ criado_por: 'gestor1', total_cents: 80_00 });
    expect(realizadoDaMeta([emNome], { usuario_id: 'u1', periodo: '2026-10', base: 'aprovado' })).toBe(80_00);
    expect(realizadoDaMeta([emNome], { usuario_id: 'gestor1', periodo: '2026-10', base: 'aprovado' })).toBe(0);
  });
  it('RN-CORE-21: pedido de outro mês não entra', () => {
    expect(realizadoDaMeta([ped({ data: '2026-09-30' }), ped({ data: '2026-11-01' })], { usuario_id: 'u1', periodo: '2026-10', base: 'aprovado' })).toBe(0);
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
  it('RN-CORE-20: positivados vem dos pedidos na base de apuração (clientes distintos)', () => {
    const r = indicadoresDoPeriodo({
      periodo: '2026-10',
      usuario_id: 'u1',
      paradas,
      visitas,
      hoje: '2026-10-08',
      pedidos: [
        { ...ped({}), cliente_id: 'c1' },
        { ...ped({}), cliente_id: 'c1' },
        { ...ped({ cancelado: true }), cliente_id: 'c2' },
        { ...ped({ aprovado: false }), cliente_id: 'c3' },
        { ...ped({}), cliente_id: 'c4' },
      ],
      base: 'aprovado',
    });
    expect(r.positivados).toBe(2);
    expect(r.realizado_cents).toBe(300_00);
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
      hoje: '2026-10-26', // seg 26, ter 27, qua 28, qui 29, sex 30 = 5 dias
      pedidos: [{ ...ped({ total_cents: 500_00 }), cliente_id: 'c1' }],
      base: 'aprovado',
      meta_cents: 1_000_00,
    });
    expect(r.dias_uteis_restantes).toBe(5);
    expect(r.necessidade_diaria_cents).toBe(100_00);
  });
  it('feriados reduzem os dias úteis restantes', () => {
    const r = indicadoresDoPeriodo({ periodo: '2026-10', usuario_id: 'u1', paradas: [], visitas: [], hoje: '2026-10-26', feriados: ['2026-10-28'] });
    expect(r.dias_uteis_restantes).toBe(4);
  });
});
