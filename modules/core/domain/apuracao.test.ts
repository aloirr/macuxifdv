import { describe, expect, it } from 'vitest';
import {
  dataDoFechamento,
  periodoFechado,
  positivadosDoPeriodo,
  realizadoPartido,
  realizadoPorTipo,
  situacaoDoPeriodo,
  type FaturamentoApuravel,
  type PedidoDaMeta,
} from './apuracao';

const MANAUS = 'America/Manaus';
const V1 = '00000000-0000-4000-8000-000000000001';
const V2 = '00000000-0000-4000-8000-000000000002';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';

const pedido = (extra: Partial<PedidoDaMeta> = {}): PedidoDaMeta => ({
  vendedor_id: V1,
  cliente_id: C1,
  // 31/10 às 22h no fuso de Manaus (UTC-4) = 01/11 02h UTC: o mês certo depende do fuso do tenant
  emitido_em: '2026-11-01T02:00:00Z',
  status: 'aprovado',
  total_cents: 10_000,
  ...extra,
});
const faturamento = (extra: Partial<FaturamentoApuravel> = {}): FaturamentoApuravel => ({
  vendedor_id: V1,
  cliente_id: C1,
  faturado_em: '2026-11-03T15:00:00Z',
  valor_cents: 7_000,
  ...extra,
});

describe('RN-CORE-21: meta de pedido conta os aprovados na data de emissão', () => {
  it('RN-CORE-21: pedido emitido em 31/10 e aprovado em 02/11 conta em outubro, não em novembro', () => {
    const p = pedido({ aprovado_em: '2026-11-02T14:00:00Z' });
    expect(realizadoPorTipo('pedido', { pedidos: [p] }, { usuario_id: V1, periodo: '2026-10', fuso: MANAUS })).toBe(10_000);
    expect(realizadoPorTipo('pedido', { pedidos: [p] }, { usuario_id: V1, periodo: '2026-11', fuso: MANAUS })).toBe(0);
  });

  it('RN-CORE-21: aprovado, integrado e faturado contam', () => {
    const pedidos = (['aprovado', 'integrado', 'faturado'] as const).map((status) => pedido({ status }));
    expect(realizadoPorTipo('pedido', { pedidos }, { usuario_id: V1, periodo: '2026-10', fuso: MANAUS })).toBe(30_000);
  });

  it('RN-CORE-21: aguardando aprovação, rejeitado, cancelado e orçamento não contam', () => {
    const pedidos = (['aguardando', 'rejeitado', 'cancelado', 'orcamento'] as const).map((status) => pedido({ status }));
    expect(realizadoPorTipo('pedido', { pedidos }, { usuario_id: V1, periodo: '2026-10', fuso: MANAUS })).toBe(0);
  });

  it('RN-CORE-21: a data de emissão é a do fuso do tenant (22h de Manaus em 31/10 é 01/11 em UTC)', () => {
    const p = pedido();
    expect(realizadoPorTipo('pedido', { pedidos: [p] }, { usuario_id: V1, periodo: '2026-10', fuso: MANAUS })).toBe(10_000);
    expect(realizadoPorTipo('pedido', { pedidos: [p] }, { usuario_id: V1, periodo: '2026-10', fuso: 'UTC' })).toBe(0);
  });

  it('RN-CORE-21: pedido em nome do vendedor conta para o vendedor, não para quem digitou; outro vendedor não entra', () => {
    const feito = pedido({ vendedor_id: V1, criado_por: V2 });
    const outro = pedido({ vendedor_id: V2, total_cents: 99 });
    expect(realizadoPorTipo('pedido', { pedidos: [feito, outro] }, { usuario_id: V1, periodo: '2026-10', fuso: MANAUS })).toBe(10_000);
  });

  it('RN-CORE-21: líquido de cancelamento parcial; o frete (incluído no total) não entra no realizado', () => {
    const p = pedido({ total_cents: 10_000, cancelado_cents: 2_500, frete_cents: 800 });
    expect(realizadoPorTipo('pedido', { pedidos: [p] }, { usuario_id: V1, periodo: '2026-10', fuso: MANAUS })).toBe(6_700);
  });
});

describe('RN-CORE-21: meta de faturamento conta o valor faturado na data do faturamento', () => {
  it('RN-CORE-21: pedido de outubro faturado em novembro conta em novembro, na meta de faturamento', () => {
    const f = faturamento();
    expect(realizadoPorTipo('faturamento', { faturamentos: [f] }, { usuario_id: V1, periodo: '2026-11', fuso: MANAUS })).toBe(7_000);
    expect(realizadoPorTipo('faturamento', { faturamentos: [f] }, { usuario_id: V1, periodo: '2026-10', fuso: MANAUS })).toBe(0);
  });

  it('RN-CORE-21: faturamento parcial soma cada retorno; devolução e cancelamento abatem; nunca fica negativo', () => {
    const lista = [faturamento({ valor_cents: 4_000 }), faturamento({ valor_cents: 3_000, faturado_em: '2026-11-10T15:00:00Z' }), faturamento({ valor_cents: 500, devolvido_cents: 800 })];
    expect(realizadoPorTipo('faturamento', { faturamentos: lista }, { usuario_id: V1, periodo: '2026-11', fuso: MANAUS })).toBe(7_000);
  });

  it('RN-CORE-21: a meta de faturamento ignora os pedidos aprovados e a de pedido ignora os faturamentos', () => {
    expect(realizadoPorTipo('faturamento', { pedidos: [pedido()] }, { usuario_id: V1, periodo: '2026-10', fuso: MANAUS })).toBe(0);
    expect(realizadoPorTipo('pedido', { faturamentos: [faturamento()] }, { usuario_id: V1, periodo: '2026-11', fuso: MANAUS })).toBe(0);
  });
});

describe('RN-CORE-20: positivado pela mesma regra da meta de pedido', () => {
  it('RN-CORE-20: conta clientes distintos com pedido aprovado emitido no período; aprovação tardia não muda o mês', () => {
    const pedidos = [
      pedido({ cliente_id: C1, aprovado_em: '2026-11-02T14:00:00Z' }),
      pedido({ cliente_id: C1, total_cents: 500 }),
      pedido({ cliente_id: C2, status: 'aguardando' }),
      pedido({ cliente_id: C2, status: 'rejeitado' }),
    ];
    expect(positivadosDoPeriodo(pedidos, { usuario_id: V1, periodo: '2026-10', fuso: MANAUS })).toBe(1);
    expect(positivadosDoPeriodo(pedidos, { usuario_id: V1, periodo: '2026-11', fuso: MANAUS })).toBe(0);
  });
});

describe('RN-CORE-21: fechamento no 2º dia útil do mês seguinte', () => {
  it('RN-CORE-21: outubro/2026 fecha em 04/11 (01/11 é domingo, 02/11 é Finados, feriado do tenant)', () => {
    // 02/11 segunda (feriado), 03/11 terça = 1º dia útil, 04/11 quarta = 2º dia útil
    expect(dataDoFechamento('2026-10', ['2026-11-02'])).toBe('2026-11-04');
  });

  it('RN-CORE-21: sem feriado, o 2º dia útil de novembro/2026 é 03/11 (01/11 é domingo)', () => {
    expect(dataDoFechamento('2026-10')).toBe('2026-11-03');
  });

  it('RN-CORE-21: virada de ano (01/01/2027 é sexta) e feriado no começo do mês', () => {
    expect(dataDoFechamento('2026-12')).toBe('2027-01-04');
    expect(dataDoFechamento('2026-12', ['2027-01-01'])).toBe('2027-01-05');
  });

  it('RN-CORE-21: até o fechamento o período é "parcial"; no dia do fechamento e depois, "fechado"', () => {
    expect(situacaoDoPeriodo('2026-10', '2026-11-03', ['2026-11-02'])).toBe('parcial');
    expect(situacaoDoPeriodo('2026-10', '2026-11-04', ['2026-11-02'])).toBe('fechado');
    expect(periodoFechado('2026-10', '2026-12-01')).toBe(true);
  });

  it('RN-CORE-21: o mês corrente e os futuros são sempre parciais', () => {
    expect(situacaoDoPeriodo('2026-11', '2026-11-15')).toBe('parcial');
    expect(situacaoDoPeriodo('2026-12', '2026-11-15')).toBe('parcial');
  });
});

describe('RN-CORE-26: realizado partido em até ontem × hoje, no fuso do tenant', () => {
  const o = { usuario_id: V1, periodo: '2026-11', fuso: MANAUS, hoje: '2026-11-10' };
  it('RN-CORE-26: pedido emitido em 09/11 às 23h30 em Manaus (10/11 03h30 UTC) conta em "até ontem" no dia 10', () => {
    const p = pedido({ emitido_em: '2026-11-10T03:30:00Z', total_cents: 5_000 });
    const r = realizadoPartido('pedido', { pedidos: [p] }, o);
    expect(r.venda_cents).toEqual({ ate_ontem: 5_000, hoje: 0 });
  });
  it('RN-CORE-26: pedido emitido hoje (10/11 10h em Manaus) conta em "hoje"; pedido de amanhã não conta', () => {
    const hoje = pedido({ emitido_em: '2026-11-10T14:00:00Z', total_cents: 7_000 });
    const amanha = pedido({ emitido_em: '2026-11-11T14:00:00Z', total_cents: 900 });
    expect(realizadoPartido('pedido', { pedidos: [hoje, amanha] }, o).venda_cents).toEqual({ ate_ontem: 0, hoje: 7_000 });
  });
  it('RN-CORE-26: pedido emitido em 31/10 e aprovado em 02/11 não entra em novembro', () => {
    const p = pedido({ emitido_em: '2026-10-31T20:00:00Z', aprovado_em: '2026-11-02T14:00:00Z' });
    const r = realizadoPartido('pedido', { pedidos: [p] }, o);
    expect(r.venda_cents).toEqual({ ate_ontem: 0, hoje: 0 });
    expect(r.positivacao).toEqual({ ate_ontem: 0, hoje: 0 });
  });
  it('RN-CORE-26: meta de faturamento usa faturado_em', () => {
    const f = [faturamento({ faturado_em: '2026-11-05T15:00:00Z', valor_cents: 4_000 }), faturamento({ faturado_em: '2026-11-10T15:00:00Z', valor_cents: 3_000 })];
    const p = pedido({ emitido_em: '2026-11-10T15:00:00Z', total_cents: 99_000 });
    expect(realizadoPartido('faturamento', { pedidos: [p], faturamentos: f }, o).venda_cents).toEqual({ ate_ontem: 4_000, hoje: 3_000 });
  });
  it('RN-CORE-26: o cliente positivado ontem que comprou de novo hoje não conta em positivacao.hoje; o novo conta', () => {
    const ontem = pedido({ emitido_em: '2026-11-09T14:00:00Z', cliente_id: C1 });
    const hojeC1 = pedido({ emitido_em: '2026-11-10T14:00:00Z', cliente_id: C1 });
    const hojeC2 = pedido({ emitido_em: '2026-11-10T15:00:00Z', cliente_id: C2 });
    expect(realizadoPartido('pedido', { pedidos: [ontem, hojeC1] }, o).positivacao).toEqual({ ate_ontem: 1, hoje: 0 });
    expect(realizadoPartido('pedido', { pedidos: [ontem, hojeC1, hojeC2] }, o).positivacao).toEqual({ ate_ontem: 1, hoje: 1 });
  });
  it('RN-CORE-26: só o vendedor da meta entra', () => {
    const outro = pedido({ vendedor_id: V2, emitido_em: '2026-11-10T14:00:00Z' });
    expect(realizadoPartido('pedido', { pedidos: [outro] }, o).venda_cents).toEqual({ ate_ontem: 0, hoje: 0 });
  });
});
