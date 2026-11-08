import { describe, expect, it } from 'vitest';
import { ATENDIMENTO_POR_DESFECHO, PainelDia } from '../contracts';
import {
  CLIENTE_A,
  CLIENTE_B,
  CLIENTE_C,
  checkin,
  checkout,
  ev,
  gondola,
  maisMin,
  pedidoCriado,
  precoColetado,
  PROMOTOR,
  rupturaRegistrada,
  shareMedido,
  statusAlterado,
  tarefaConcluida,
  u,
  VENDEDOR,
  visitaLoja,
  type DesfechoTeste,
  meta,
} from './fixtures';
import { atendida, calcularMeta, diaLocal, faturadoDoPedido, faturamentoDoPeriodo, montarPainelDia, painelDoMes, statusDoDia, tradeDoPeriodo, vendasDoPeriodo, visitasDoPeriodo } from './painel';
import { aplicarEvento, aplicarEventos, estadoInicial, execucoesDaTarefa, type EventoRecebido } from './projecao';

const montar = (eventos: EventoRecebido[]) => aplicarEventos(estadoInicial(), eventos).estado;
const TODOS = new Set(['core', 'vendedor', 'promotor', 'pesquisa', 'treinamento']);
const AGORA = '2026-10-30T20:00:00Z';
const vend = { id: VENDEDOR, perfil: 'vendedor' } as const;
const prom = { id: PROMOTOR, perfil: 'promotor' } as const;
const trade = (st: ReturnType<typeof estadoInicial>, p: Parameters<typeof tradeDoPeriodo>[4] = {}) => tradeDoPeriodo(st, PROMOTOR, '2026-10-30', '2026-10-30', p);

/** Pedido criado e aprovado no instante `em`. */
function venda(n: number, o: { total: number; tabela?: number; cliente?: string; em: string; vendedor?: string; visita?: string | null }): EventoRecebido[] {
  return [
    pedidoCriado({ pedido: u(1000 + n), total: o.total, tabela: o.tabela ?? o.total, cliente: o.cliente, vendedor: o.vendedor, em: o.em, visita: o.visita }),
    statusAlterado({ pedido: u(1000 + n), vendedor: o.vendedor, para: 'aprovado', em: o.em }),
  ];
}

describe('RF-GES-02: vendas do dia — positivação, ticket médio e desconto', () => {
  const s = montar([
    ...venda(1, { total: 10_000, tabela: 10_000, cliente: CLIENTE_A, em: '2026-10-30T15:00:00Z' }),
    ...venda(2, { total: 9_000, tabela: 10_000, cliente: CLIENTE_A, em: '2026-10-30T16:00:00Z' }),
    ...venda(3, { total: 6_000, cliente: CLIENTE_B, em: '2026-10-29T16:00:00Z' }),
  ]);

  it('RN-CORE-20: soma o dia, positiva cliente distinto 1 vez, ticket = vendas ÷ pedidos', () => {
    expect(vendasDoPeriodo(s, VENDEDOR, '2026-10-30', '2026-10-30')).toEqual({
      vendas_cents: 19_000,
      pedidos: 2,
      clientes_positivados: 1,
      ticket_medio_cents: 9_500,
      desconto_medio_pct: 5,
    });
  });

  it('RN-VEN-03: desconto médio ponderado = 1 − Σ final ÷ Σ tabela (no dia 19.000 de 20.000 = 5%; em 2 dias 25.000 de 26.000 = 3,85%)', () => {
    expect(vendasDoPeriodo(s, VENDEDOR, '2026-10-29', '2026-10-30').desconto_medio_pct).toBe(3.85); // 1 − 25.000 ÷ 26.000
  });

  it('RN-VEN-02: ticket médio arredonda meio para cima em centavos', () => {
    const p = montar([...venda(1, { total: 100, em: '2026-10-30T15:00:00Z' }), ...venda(2, { total: 101, em: '2026-10-30T15:30:00Z', cliente: CLIENTE_B })]);
    expect(vendasDoPeriodo(p, VENDEDOR, '2026-10-30', '2026-10-30').ticket_medio_cents).toBe(101); // 100,5
  });

  it('dia sem venda: zeros e ticket/desconto null (nunca divide por zero)', () => {
    expect(vendasDoPeriodo(s, VENDEDOR, '2026-10-28', '2026-10-28')).toEqual({ vendas_cents: 0, pedidos: 0, clientes_positivados: 0, ticket_medio_cents: null, desconto_medio_pct: null });
  });

  it('datas armazenadas em UTC, dia no fuso do tenant: 02:00Z de 31/10 ainda é 30/10 em Manaus', () => {
    const p = montar(venda(1, { total: 7_000, em: '2026-10-31T02:00:00Z' }));
    expect(diaLocal('2026-10-31T02:00:00Z', 'America/Manaus')).toBe('2026-10-30');
    expect(vendasDoPeriodo(p, VENDEDOR, '2026-10-30', '2026-10-30').vendas_cents).toBe(7_000);
    expect(vendasDoPeriodo(p, VENDEDOR, '2026-10-31', '2026-10-31').vendas_cents).toBe(0);
    expect(vendasDoPeriodo(p, VENDEDOR, '2026-10-31', '2026-10-31', { fuso: 'UTC' }).vendas_cents).toBe(7_000);
  });

  it('RN-CORE-21: base de apuração configurável — faturado só conta quando faturar', () => {
    const p = montar(venda(1, { total: 7_000, em: '2026-10-30T15:00:00Z' }));
    expect(vendasDoPeriodo(p, VENDEDOR, '2026-10-30', '2026-10-30', { base_apuracao: 'faturado' }).vendas_cents).toBe(0);
    const f = aplicarEventos(p, [statusAlterado({ pedido: u(1001), para: 'faturado_total', em: '2026-11-03T12:00:00Z' })]).estado;
    expect(vendasDoPeriodo(f, VENDEDOR, '2026-11-03', '2026-11-03', { base_apuracao: 'faturado' }).vendas_cents).toBe(7_000);
  });

  it('RN-CORE-21: o pedido feito pelo gestor em nome do vendedor aparece no painel do vendedor, não no do gestor', () => {
    const p = montar([
      pedidoCriado({ pedido: u(1001), vendedor: VENDEDOR, autor: u(300), total: 8_000, em: '2026-10-30T15:00:00Z' }),
      statusAlterado({ pedido: u(1001), para: 'aprovado', em: '2026-10-30T15:05:00Z' }),
    ]);
    expect(vendasDoPeriodo(p, VENDEDOR, '2026-10-30', '2026-10-30').vendas_cents).toBe(8_000);
    expect(vendasDoPeriodo(p, u(300), '2026-10-30', '2026-10-30').vendas_cents).toBe(0);
  });
});

describe('RN-CORE-21/22: meta, falta e necessidade por dia útil', () => {
  // Outubro/2026 tem 22 dias úteis; em 20/10: 13 decorridos (1–19), 9 restantes (20–30).
  const dias = { dias_uteis_total: 22, dias_uteis_decorridos: 13, dias_uteis_restantes: 9 };

  it('RN-CORE-22: necessidade diária = (meta − realizado) ÷ dias úteis restantes (R$ 22.000 − R$ 10.000 ÷ 9 = R$ 1.333,33)', () => {
    expect(calcularMeta({ meta_cents: 2_200_000, realizado_cents: 1_000_000, realizado_ate_ontem_cents: 900_000, ...dias })).toEqual({
      atingimento_pct: 45.45,
      falta_cents: 1_200_000,
      necessidade_diaria_cents: 133_333,
      ritmo_pct: 69.23, // 900.000 ÷ (2.200.000 × 13/22 = 1.300.000)
    });
  });

  it('meta batida: falta 0 e necessidade 0', () => {
    const r = calcularMeta({ meta_cents: 1_000_000, realizado_cents: 1_200_000, realizado_ate_ontem_cents: 1_100_000, ...dias });
    expect(r).toMatchObject({ atingimento_pct: 120, falta_cents: 0, necessidade_diaria_cents: 0 });
  });

  it('sem meta (ou meta 0): tudo null, sem erro', () => {
    expect(calcularMeta({ meta_cents: null, realizado_cents: 5, realizado_ate_ontem_cents: 0, ...dias })).toEqual({ atingimento_pct: null, falta_cents: null, necessidade_diaria_cents: null, ritmo_pct: null });
    expect(calcularMeta({ meta_cents: 0, realizado_cents: 5, realizado_ate_ontem_cents: 0, ...dias }).atingimento_pct).toBeNull();
  });

  it('sem dia útil restante: necessidade null; no 1º dia útil não há ritmo (0 decorridos)', () => {
    expect(calcularMeta({ meta_cents: 1000, realizado_cents: 0, realizado_ate_ontem_cents: 0, dias_uteis_total: 22, dias_uteis_decorridos: 22, dias_uteis_restantes: 0 }).necessidade_diaria_cents).toBeNull();
    expect(calcularMeta({ meta_cents: 1000, realizado_cents: 0, realizado_ate_ontem_cents: 0, dias_uteis_total: 22, dias_uteis_decorridos: 0, dias_uteis_restantes: 22 }).ritmo_pct).toBeNull();
  });

  it('painelDoMes soma o mês até o dia, lê a meta do mês e usa o calendário do tenant (feriado tira dia útil)', () => {
    const s = montar([
      meta(VENDEDOR, '2026-10', 2_200_000, '2026-10-01T08:00:00Z'),
      ...venda(1, { total: 900_000, em: '2026-10-15T15:00:00Z' }),
      ...venda(2, { total: 100_000, em: '2026-10-20T15:00:00Z', cliente: CLIENTE_B }),
      ...venda(3, { total: 999_999, em: '2026-10-21T15:00:00Z' }), // depois do dia consultado: fora
    ]);
    const SEG_SEX = { dias_uteis_semana: [1, 2, 3, 4, 5] };
    const m = painelDoMes(s, VENDEDOR, '2026-10-20', SEG_SEX);
    expect(m).toMatchObject({ mes: '2026-10', vendas_cents: 1_000_000, pedidos: 2, clientes_positivados: 2, meta_cents: 2_200_000, falta_cents: 1_200_000, dias_uteis_restantes: 9 });
    const comFeriado = painelDoMes(s, VENDEDOR, '2026-10-20', { ...SEG_SEX, feriados: ['2026-10-23'] });
    expect(comFeriado.dias_uteis_restantes).toBe(8);
  });

  it('RN-CORE-26: "Precisa por dia" usa o calendário do tenant (seg–sáb) como o Início, não seg–sex', () => {
    const s = montar([meta(VENDEDOR, '2026-10', 2_200_000, '2026-10-01T08:00:00Z'), ...venda(1, { total: 1_000_000, em: '2026-10-15T15:00:00Z' })]);
    const m = painelDoMes(s, VENDEDOR, '2026-10-20');
    expect(m.dias_uteis_restantes).toBe(11); // 20 a 31/10 sem domingos
    expect(m.necessidade_diaria_cents).toBe(109_091); // R$ 12.000 ÷ 11
    expect(painelDoMes(s, VENDEDOR, '2026-10-20', { dias_uteis_semana: [1, 2, 3, 4, 5] })).toMatchObject({ dias_uteis_restantes: 9, necessidade_diaria_cents: 133_333 });
  });

  it('meta de outro mês não vale; sem meta definida o mês vem com meta null', () => {
    const s = montar([meta(VENDEDOR, '2026-09', 5_000_000, '2026-09-01T08:00:00Z')]);
    expect(painelDoMes(s, VENDEDOR, '2026-10-20')).toMatchObject({ meta_cents: null, atingimento_pct: null, necessidade_diaria_cents: null });
  });
});

describe('RF-GES-01/02: visitas planejadas × realizadas, tempo em cliente e status do dia', () => {
  const rota = ev('core.rota.dia_planejado@1', '2026-10-30T10:00:00Z', { usuario_id: VENDEDOR, data: '2026-10-30', cliente_ids: [CLIENTE_A, CLIENTE_B, CLIENTE_C, u(504)] });

  it('RN-CORE-20: realizadas = clientes distintos com check-in; cobertura = realizadas ÷ planejadas', () => {
    const s = montar([
      rota,
      checkin({ visita: u(2000), cliente: CLIENTE_A, em: '2026-10-30T13:00:00Z' }),
      checkout({ visita: u(2000), cliente: CLIENTE_A, em: '2026-10-30T13:20:00Z' }),
      checkin({ visita: u(2001), cliente: CLIENTE_A, em: '2026-10-30T14:00:00Z' }), // 2ª visita no mesmo cliente
      checkout({ visita: u(2001), cliente: CLIENTE_A, em: '2026-10-30T14:10:00Z' }),
      checkin({ visita: u(2002), cliente: CLIENTE_B, em: '2026-10-30T15:00:00Z' }), // aberta
    ]);
    const v = visitasDoPeriodo(s, vend, '2026-10-30', '2026-10-30');
    expect(v).toMatchObject({ planejadas: 4, realizadas: 2, em_andamento: 1, cobertura_pct: 50, tempo_total_min: 30, tempo_medio_min: 15, curtas: 0 });
    expect(statusDoDia(s, VENDEDOR, '2026-10-30')).toBe('em_visita');
  });

  it('status do dia: sem check-in → em visita → em rota (RF-GES-01)', () => {
    expect(statusDoDia(montar([rota]), VENDEDOR, '2026-10-30')).toBe('sem_checkin');
    const aberta = montar([rota, checkin({ cliente: CLIENTE_A, em: '2026-10-30T13:00:00Z' })]);
    expect(statusDoDia(aberta, VENDEDOR, '2026-10-30')).toBe('em_visita');
    const fechada = aplicarEventos(aberta, [checkout({ cliente: CLIENTE_A, em: '2026-10-30T13:30:00Z' })]).estado;
    expect(statusDoDia(fechada, VENDEDOR, '2026-10-30')).toBe('em_rota');
    expect(statusDoDia(fechada, VENDEDOR, '2026-10-29')).toBe('sem_checkin');
  });

  it('sem rota planejada a cobertura é null (sem dados), não 0 nem erro', () => {
    const s = montar([checkin({ em: '2026-10-30T13:00:00Z' })]);
    expect(visitasDoPeriodo(s, vend, '2026-10-30', '2026-10-30')).toMatchObject({ planejadas: 0, realizadas: 1, cobertura_pct: null });
  });

  it('RN-CORE-11: visita fechada automaticamente na virada do dia conta como visita mas não entra no tempo em cliente', () => {
    const s = montar([
      checkin({ visita: u(2000), cliente: CLIENTE_A, em: '2026-10-30T13:00:00Z' }),
      checkout({ visita: u(2000), cliente: CLIENTE_A, em: '2026-10-31T04:00:00Z', fechada_por: 'auto' }),
      checkin({ visita: u(2001), cliente: CLIENTE_B, em: '2026-10-30T14:00:00Z' }),
      checkout({ visita: u(2001), cliente: CLIENTE_B, em: '2026-10-30T14:30:00Z' }),
    ]);
    expect(visitasDoPeriodo(s, vend, '2026-10-30', '2026-10-30')).toMatchObject({ realizadas: 2, em_andamento: 0, tempo_total_min: 30, tempo_medio_min: 30 });
  });

  it('o dia da visita é o do check-in no fuso do tenant (23h30 em Manaus = 03:30Z do dia seguinte)', () => {
    const s = montar([checkin({ em: '2026-10-31T03:30:00Z' })]);
    expect(visitasDoPeriodo(s, vend, '2026-10-30', '2026-10-30').realizadas).toBe(1);
    expect(visitasDoPeriodo(s, vend, '2026-10-31', '2026-10-31').realizadas).toBe(0);
  });

  it('RF-GES-02: conversão de visita em pedido = visitas com pedido ativo ÷ visitas (cancelado/rejeitado não conta)', () => {
    const s = montar([
      checkin({ visita: u(2000), cliente: CLIENTE_A, em: '2026-10-30T13:00:00Z' }),
      checkout({ visita: u(2000), cliente: CLIENTE_A, em: '2026-10-30T13:20:00Z' }),
      checkin({ visita: u(2001), cliente: CLIENTE_B, em: '2026-10-30T14:00:00Z' }),
      checkout({ visita: u(2001), cliente: CLIENTE_B, em: '2026-10-30T14:20:00Z' }),
      checkin({ visita: u(2002), cliente: CLIENTE_C, em: '2026-10-30T15:00:00Z' }),
      checkout({ visita: u(2002), cliente: CLIENTE_C, em: '2026-10-30T15:20:00Z' }),
      ...venda(1, { total: 1000, em: '2026-10-30T13:10:00Z', visita: u(2000) }),
      ...venda(2, { total: 1000, em: '2026-10-30T14:10:00Z', visita: u(2001), cliente: CLIENTE_B }),
      statusAlterado({ pedido: u(1002), para: 'cancelado', em: '2026-10-30T14:15:00Z' }),
    ]);
    expect(visitasDoPeriodo(s, vend, '2026-10-30', '2026-10-30', {}, true).conversao_pedido_pct).toBe(33.33);
    expect(visitasDoPeriodo(s, vend, '2026-10-30', '2026-10-30', {}, false).conversao_pedido_pct).toBeNull();
  });
});

describe('RN-PRO-07 / RF-GES-10: trade do promotor (payloads oficiais promotor.*@1)', () => {
  const lj = (n: number, o: { visita: string; cliente: string; min: number; em: string; fotos?: [number, number]; desfecho?: DesfechoTeste }) => visitaLoja(n, o);
  const gond = (n: number, loja: number, c: 'conforme' | 'parcial' | 'nao_conforme') => gondola(n, loja, c, '2026-10-30T13:10:00Z');
  const share = (n: number, loja: number, s: number | null, m: number | null) => shareMedido(n, loja, s, m, '2026-10-30T13:12:00Z');
  const rup = (n: number, loja: number, st: 'presente' | 'ruptura_gondola' | 'ruptura_total') => rupturaRegistrada(n, loja, st, '2026-10-30T13:15:00Z');
  const preco = (n: number, loja: number, i: number | null) => precoColetado(n, loja, i, '2026-10-30T13:18:00Z');

  const eventos: EventoRecebido[] = [
    lj(1, { visita: u(2000), cliente: CLIENTE_A, min: 35, em: '2026-10-30T13:00:00Z', fotos: [10, 2] }),
    lj(2, { visita: u(2001), cliente: CLIENTE_B, min: 6, em: '2026-10-30T15:00:00Z', fotos: [4, 1] }), // curta: fora dos indicadores
    gond(1, 1, 'conforme'),
    gond(2, 1, 'conforme'),
    gond(3, 1, 'parcial'),
    gond(4, 1, 'nao_conforme'),
    gond(5, 2, 'nao_conforme'), // da visita curta: não conta
    share(1, 1, 30, 40),
    share(2, 1, 20, 20),
    share(3, 1, 10, null),
    rup(1, 1, 'presente'),
    rup(2, 1, 'presente'),
    rup(3, 1, 'presente'),
    rup(4, 1, 'presente'),
    rup(5, 1, 'presente'),
    rup(6, 1, 'presente'),
    rup(7, 1, 'presente'),
    rup(8, 1, 'ruptura_gondola'),
    rup(9, 1, 'ruptura_total'),
    rup(10, 1, 'ruptura_total'),
    rup(11, 2, 'ruptura_total'), // visita curta: fora
    preco(1, 1, 109),
    preco(2, 1, 125),
    preco(3, 1, null),
    tarefaConcluida({ execucao: 1, tarefa: 1, loja: 1, em: '2026-10-30T16:00:00Z' }),
  ];
  const s = montar(eventos);

  it('T-0046: todos os payloads oficiais do Promotor são aceitos pela projeção (nenhum inválido)', () => {
    expect(aplicarEventos(estadoInicial(), eventos).contagem).toMatchObject({ aplicado: eventos.length, invalido: 0 });
  });

  it('RN-PRO-07: só visitas com 10 min ou mais contam; a curta é sinalizada ao gestor', () => {
    const t = trade(s);
    expect(t.lojas_visitadas).toBe(1);
    const v = visitasDoPeriodo(montar([...eventos, checkin({ visita: u(2000), usuario: PROMOTOR, cliente: CLIENTE_A, em: '2026-10-30T13:00:00Z' }), checkout({ visita: u(2000), usuario: PROMOTOR, cliente: CLIENTE_A, em: '2026-10-30T13:35:00Z' }), checkin({ visita: u(2001), usuario: PROMOTOR, cliente: CLIENTE_B, em: '2026-10-30T15:00:00Z' }), checkout({ visita: u(2001), usuario: PROMOTOR, cliente: CLIENTE_B, em: '2026-10-30T15:06:00Z' })]), prom, '2026-10-30', '2026-10-30');
    expect(v).toMatchObject({ realizadas: 1, curtas: 1, tempo_total_min: 35, tempo_medio_min: 35 });
  });

  it('RN-PRO-11: conformidade = (conformes + parciais × peso) ÷ gôndolas × 100; parciais à parte', () => {
    expect(trade(s)).toMatchObject({ conformidade_pct: 50, conformidade_parciais: 1 });
    expect(trade(s, { peso_parcial_conformidade: 0.5 }).conformidade_pct).toBe(62.5);
  });

  it('RN-PRO-03: share médio 20, meta média 30, atingimento 83,33% (só quem tem share e meta)', () => {
    expect(trade(s)).toMatchObject({ share_medio_pct: 20, meta_share_media_pct: 30, atingimento_share_pct: 83.33 });
  });

  it('RN-PRO-05: ruptura 30% (10 itens: 7 presentes, 1 na gôndola, 2 totais) e falha de reposição 10% à parte', () => {
    expect(trade(s)).toMatchObject({ ruptura_pct: 30, falha_reposicao_pct: 10 });
  });

  it('RN-PRO-04: índice de preço médio ignora coletas sem índice (preço do nosso item)', () => {
    expect(trade(s).indice_preco_medio).toBe(117);
  });

  it('RN-PRO-02: % de fotos sem GPS considera TODAS as visitas do dia (14 fotos, 3 sem GPS = 21,43%)', () => {
    expect(trade(s)).toMatchObject({ fotos_total: 14, fotos_sem_gps: 3, fotos_sem_gps_pct: 21.43, tarefas_concluidas: 1, tarefas_distintas: 1 });
  });

  it('RN-PRO-02: visita sem nenhuma foto informa 0 (o Promotor sempre manda as contagens); sem visita no dia = null', () => {
    expect(trade(montar([lj(1, { visita: u(2000), cliente: CLIENTE_A, min: 20, em: '2026-10-30T13:00:00Z', fotos: [0, 0] })]))).toMatchObject({ fotos_total: 0, fotos_sem_gps: 0, fotos_sem_gps_pct: null });
    expect(trade(estadoInicial())).toMatchObject({ fotos_total: null, fotos_sem_gps: null, fotos_sem_gps_pct: null });
  });

  it('sem coletas: percentuais null e contagens 0', () => {
    expect(trade(estadoInicial())).toMatchObject({ lojas_visitadas: 0, visitas_sem_atendimento: 0, conformidade_pct: null, share_medio_pct: null, ruptura_pct: null, indice_preco_medio: null, tarefas_concluidas: 0, tarefas_distintas: 0 });
  });
});

describe('T-0046 / RN-CORE-14: desfecho da visita de loja (vocabulário do Promotor) nos indicadores do Gestor', () => {
  const EM = '2026-10-30T13:00:00Z';
  const comCore = (n: number, o: { cliente: string; min: number; em: string; desfecho: DesfechoTeste; fotos?: [number, number] }) => [
    checkin({ visita: u(2000 + n), usuario: PROMOTOR, cliente: o.cliente, em: o.em }),
    checkout({ visita: u(2000 + n), usuario: PROMOTOR, cliente: o.cliente, em: maisMin(o.em, o.min) }),
    visitaLoja(n, { visita: u(2000 + n), cliente: o.cliente, min: o.min, em: o.em, desfecho: o.desfecho, fotos: o.fotos }),
  ];
  const s = montar([
    ...comCore(1, { cliente: CLIENTE_A, min: 30, em: EM, desfecho: 'realizada', fotos: [6, 1] }),
    ...comCore(2, { cliente: CLIENTE_B, min: 4, em: '2026-10-30T15:00:00Z', desfecho: 'loja_fechada', fotos: [1, 0] }),
    ...comCore(3, { cliente: CLIENTE_C, min: 12, em: '2026-10-30T17:00:00Z', desfecho: 'acesso_negado', fotos: [1, 1] }),
    // coleta (indevida) numa visita sem atendimento: não entra nos indicadores
    rupturaRegistrada(1, 3, 'ruptura_total', '2026-10-30T17:05:00Z', CLIENTE_C),
    rupturaRegistrada(2, 1, 'presente', '2026-10-30T13:10:00Z'),
  ]);

  it('`realizada` é atendimento; `loja_fechada` e `acesso_negado` são sem atendimento (mapa total do vocabulário)', () => {
    expect(ATENDIMENTO_POR_DESFECHO).toEqual({ realizada: 'atendida', loja_fechada: 'sem_atendimento', acesso_negado: 'sem_atendimento' });
    expect(atendida({ desfecho: 'realizada' })).toBe(true);
    expect(atendida({ desfecho: 'loja_fechada' })).toBe(false);
    expect(atendida({ desfecho: 'acesso_negado' })).toBe(false);
  });

  it('trade: sem atendimento não é loja visitada (nem com 12 min) e é contada em visitas_sem_atendimento', () => {
    expect(trade(s)).toMatchObject({ lojas_visitadas: 1, visitas_sem_atendimento: 2, ruptura_pct: 0 });
  });

  it('visitas (Core) do promotor: sem atendimento não é realizada nem curta (a de 4 min não é sinalizada)', () => {
    expect(visitasDoPeriodo(s, prom, '2026-10-30', '2026-10-30')).toMatchObject({ realizadas: 1, curtas: 0, tempo_total_min: 30 });
  });

  it('RN-PRO-02: a foto da fachada da visita sem atendimento entra no % de fotos sem GPS (8 fotos, 2 sem GPS)', () => {
    expect(trade(s)).toMatchObject({ fotos_total: 8, fotos_sem_gps: 2, fotos_sem_gps_pct: 25 });
  });

  it('vocabulário antigo do espelho (`concluida`, `nao_finalizada`) é recusado como inválido, sem quebrar', () => {
    for (const desfecho of ['concluida', 'nao_finalizada']) {
      const e = visitaLoja(9, { em: EM });
      const r = aplicarEvento(estadoInicial(), { ...e, payload: { ...(e.payload as object), desfecho } });
      expect(r.situacao, desfecho).toBe('invalido');
      expect(r.motivo).toMatch(/desfecho/);
    }
  });
});

describe('T-0046 / RF-PRO-10: tarefas de campanha por execução (execucao_id), agrupadas por tarefa_id', () => {
  const EM = '2026-10-30T13:00:00Z';
  // a MESMA tarefa (campanha 1) executada em 3 lojas + a tarefa 2 numa loja
  const eventos = [
    tarefaConcluida({ execucao: 1, tarefa: 1, loja: 1, cliente: CLIENTE_A, em: '2026-10-30T13:30:00Z' }),
    tarefaConcluida({ execucao: 2, tarefa: 1, loja: 2, cliente: CLIENTE_B, em: '2026-10-30T15:30:00Z' }),
    tarefaConcluida({ execucao: 3, tarefa: 1, loja: 3, cliente: CLIENTE_C, em: '2026-10-30T17:30:00Z' }),
    tarefaConcluida({ execucao: 4, tarefa: 2, loja: 3, cliente: CLIENTE_C, em: '2026-10-30T17:40:00Z' }),
  ];

  it('várias execuções da mesma tarefa em lojas diferentes não se sobrescrevem: 4 execuções, 2 tarefas', () => {
    const st = montar(eventos);
    expect(Object.keys(st.tarefas)).toHaveLength(4);
    expect(trade(st)).toMatchObject({ tarefas_concluidas: 4, tarefas_distintas: 2 });
    expect(execucoesDaTarefa(st, u(9001)).map((t) => t.cliente_id)).toEqual([CLIENTE_A, CLIENTE_B, CLIENTE_C]);
    expect(execucoesDaTarefa(st, u(9002)).map((t) => t.execucao_id)).toEqual([u(9104)]);
    expect(execucoesDaTarefa(st, u(9001), u(999))).toEqual([]);
  });

  it('a ordem de chegada não muda o resultado e a mesma execução com evento_id novo não conta duas vezes', () => {
    const invertido = montar([...eventos].reverse());
    expect(trade(invertido)).toEqual(trade(montar(eventos)));
    const repetida = tarefaConcluida({ execucao: 2, tarefa: 1, loja: 2, cliente: CLIENTE_B, em: '2026-10-30T15:30:00Z' });
    expect(trade(montar([...eventos, repetida]))).toMatchObject({ tarefas_concluidas: 4, tarefas_distintas: 2 });
  });

  it('tarefa sem execucao_id (formato do espelho antigo) ou sem foto é inválida', () => {
    const e = tarefaConcluida({ execucao: 1, tarefa: 1, loja: 1, em: EM });
    const { execucao_id: _fora, ...semExecucao } = e.payload as Record<string, unknown>;
    expect(aplicarEvento(estadoInicial(), { ...e, payload: semExecucao }).situacao).toBe('invalido');
    expect(aplicarEvento(estadoInicial(), { ...e, payload: { ...(e.payload as object), fotos_total: 0 } }).situacao).toBe('invalido');
  });
});

describe('RN-GES-05: cobertura de rota limitada a 100% e visitas extras à parte', () => {
  const planejados = Array.from({ length: 10 }, (_, i) => u(600 + i));
  const extras = [u(700), u(701)];
  const rota = ev('core.rota.dia_planejado@1', '2026-10-30T10:00:00Z', { usuario_id: VENDEDOR, data: '2026-10-30', cliente_ids: planejados });
  const visitas = (clientes: string[], base = 0) =>
    clientes.flatMap((c, i) => [
      checkin({ visita: u(2100 + base + i), cliente: c, em: `2026-10-30T${String(12 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}:00Z` }),
      checkout({ visita: u(2100 + base + i), cliente: c, em: `2026-10-30T${String(12 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '45' : '15'}:00Z` }),
    ]);

  it('12 visitas para 10 planejadas (10 da rota + 2 fora): cobertura 100% e 2 visitas extras', () => {
    const v = visitasDoPeriodo(montar([rota, ...visitas([...planejados, ...extras])]), vend, '2026-10-30', '2026-10-30');
    expect(v).toMatchObject({ planejadas: 10, realizadas: 12, planejadas_realizadas: 10, cobertura_pct: 100, visitas_extras: 2 });
  });

  it('a cobertura conta só clientes da rota: 8 da rota + 4 fora = 80% (não 120%) e 4 extras', () => {
    const v = visitasDoPeriodo(montar([rota, ...visitas([...planejados.slice(0, 8), ...extras, u(702), u(703)])]), vend, '2026-10-30', '2026-10-30');
    expect(v).toMatchObject({ planejadas: 10, realizadas: 12, planejadas_realizadas: 8, cobertura_pct: 80, visitas_extras: 4 });
  });

  it('duas visitas no mesmo cliente da rota contam uma vez; sem rota, cobertura e extras são null (sem dado)', () => {
    const v = visitasDoPeriodo(montar([rota, ...visitas([planejados[0]!, planejados[0]!])]), vend, '2026-10-30', '2026-10-30');
    expect(v).toMatchObject({ planejadas_realizadas: 1, cobertura_pct: 10, visitas_extras: 0 });
    const sem = visitasDoPeriodo(montar(visitas(extras)), vend, '2026-10-30', '2026-10-30');
    expect(sem).toMatchObject({ planejadas: 0, realizadas: 2, planejadas_realizadas: 0, cobertura_pct: null, visitas_extras: null });
  });

  it('no painel do dia a linha continua válida com os campos novos', () => {
    const linha = montarPainelDia(montar([rota, ...visitas([...planejados, ...extras])]), vend, '2026-10-30', { modulos: new Set(['core']), agora: AGORA });
    expect(PainelDia.parse(linha)).toEqual(linha);
    expect(linha.visitas.cobertura_pct).toBe(100);
  });
});

describe('RN-GES-06: vendido × faturado (inclusive parcial pelos itens) e a faturar', () => {
  const P_A = u(800), P_B = u(801), P_C = u(802);
  const criado = (pedido: string, total: number, itens: { produto_id: string; quantidade: number; total_cents: number }[] | null, em = '2026-10-30T14:00:00Z', extra: Record<string, unknown> = {}) =>
    ev('vendedor.pedido.criado@1', em, { pedido_id: pedido, vendedor_id: VENDEDOR, autor_id: VENDEDOR, cliente_id: CLIENTE_A, visita_id: null, tipo: 'pedido', total_cents: total, total_tabela_cents: total, criado_em: em, itens: itens ?? [], ...extra });
  const faturou = (pedido: string, parcial: boolean, itens: { produto_id: string; quantidade: number }[], em = '2026-10-31T14:00:00Z', id?: string) =>
    ev('vendedor.pedido.faturado@1', em, { pedido_id: pedido, vendedor_id: VENDEDOR, faturado_em: em, parcial, itens }, id);
  const ITENS_A = [
    { produto_id: u(901), quantidade: 10, total_cents: 6_000 },
    { produto_id: u(902), quantidade: 4, total_cents: 4_000 },
  ];
  const dia = (s: ReturnType<typeof montar>) => faturamentoDoPeriodo(s, VENDEDOR, '2026-10-30', '2026-10-30');

  it('vendido = valor do pedido criado; nada faturado ainda → a faturar = vendido', () => {
    expect(dia(montar([criado(P_A, 10_000, ITENS_A)]))).toEqual({ vendido_cents: 10_000, faturado_cents: 0, a_faturar_cents: 10_000 });
  });

  it('faturamento parcial pelos itens faturados: 5 de 10 do item 1 (R$ 30,00); depois 1 de 4 do item 2 (+ R$ 10,00)', () => {
    const um = montar([criado(P_A, 10_000, ITENS_A), faturou(P_A, true, [{ produto_id: u(901), quantidade: 5 }])]);
    expect(dia(um)).toEqual({ vendido_cents: 10_000, faturado_cents: 3_000, a_faturar_cents: 7_000 });
    const dois = montar([criado(P_A, 10_000, ITENS_A), faturou(P_A, true, [{ produto_id: u(901), quantidade: 5 }]), faturou(P_A, true, [{ produto_id: u(902), quantidade: 1 }], '2026-11-02T14:00:00Z')]);
    expect(dia(dois)).toEqual({ vendido_cents: 10_000, faturado_cents: 4_000, a_faturar_cents: 6_000 });
  });

  it('faturamento total cobre o saldo (evento com parcial=false ou status faturado_total)', () => {
    const porEvento = montar([criado(P_A, 10_000, ITENS_A), faturou(P_A, true, [{ produto_id: u(901), quantidade: 5 }]), faturou(P_A, false, [{ produto_id: u(902), quantidade: 4 }], '2026-11-03T14:00:00Z')]);
    expect(dia(porEvento)).toEqual({ vendido_cents: 10_000, faturado_cents: 10_000, a_faturar_cents: 0 });
    const porStatus = montar([criado(P_A, 10_000, ITENS_A), statusAlterado({ pedido: P_A, para: 'faturado_total', em: '2026-11-03T14:00:00Z' })]);
    expect(dia(porStatus).faturado_cents).toBe(10_000);
  });

  it('proporcional por item, centavos meio para cima; quantidade além da pedida não passa do total do item', () => {
    const itens = [{ produto_id: u(903), quantidade: 3, total_cents: 1_000 }];
    expect(faturadoDoPedido(montar([criado(P_B, 1_000, itens), faturou(P_B, true, [{ produto_id: u(903), quantidade: 1 }])]).pedidos[P_B]!)).toBe(333);
    expect(faturadoDoPedido(montar([criado(P_B, 1_000, itens), faturou(P_B, true, [{ produto_id: u(903), quantidade: 2 }])]).pedidos[P_B]!)).toBe(667);
    expect(faturadoDoPedido(montar([criado(P_B, 1_000, itens), faturou(P_B, true, [{ produto_id: u(903), quantidade: 5 }])]).pedidos[P_B]!)).toBe(1_000);
    expect(faturadoDoPedido(montar([criado(P_B, 1_000, itens), faturou(P_B, true, [{ produto_id: u(999), quantidade: 5 }])]).pedidos[P_B]!)).toBe(0); // item que não está no pedido
  });

  it('reentrega do mesmo evento de faturamento não soma duas vezes', () => {
    const e = faturou(P_A, true, [{ produto_id: u(901), quantidade: 5 }], '2026-10-31T14:00:00Z', 'fat-1');
    expect(dia(montar([criado(P_A, 10_000, ITENS_A), e, e])).faturado_cents).toBe(3_000);
  });

  it('pedido sem itens no evento criado: parcial fica sem valor (0) até o faturamento total', () => {
    const s = montar([criado(P_C, 5_000, null), faturou(P_C, true, [{ produto_id: u(901), quantidade: 1 }])]);
    expect(dia(s)).toEqual({ vendido_cents: 5_000, faturado_cents: 0, a_faturar_cents: 5_000 });
  });

  it('cancelado/rejeitado e orçamento não entram no vendido; o dia do vendido é o da criação no fuso do tenant', () => {
    const s = montar([
      criado(P_A, 10_000, ITENS_A),
      criado(P_B, 2_000, null),
      statusAlterado({ pedido: P_B, para: 'cancelado', em: '2026-10-30T18:00:00Z' }),
      criado(P_C, 3_000, null, '2026-10-30T14:00:00Z', { tipo: 'orcamento' }),
      criado(u(803), 4_000, null, '2026-10-31T02:00:00Z'), // 30/10 22:00 em Manaus
      criado(u(804), 9_000, null, '2026-10-31T05:00:00Z'), // 31/10 em Manaus
    ]);
    expect(dia(s)).toEqual({ vendido_cents: 14_000, faturado_cents: 0, a_faturar_cents: 14_000 });
  });

  it('o painel do dia e o do mês trazem os dois números; sem Vendedor a seção é null', () => {
    const s = montar([criado(P_A, 10_000, ITENS_A), faturou(P_A, true, [{ produto_id: u(901), quantidade: 5 }])]);
    const linha = montarPainelDia(s, vend, '2026-10-30', { modulos: TODOS, agora: AGORA });
    expect(PainelDia.parse(linha)).toEqual(linha);
    expect(linha.faturamento).toEqual({ vendido_cents: 10_000, faturado_cents: 3_000, a_faturar_cents: 7_000 });
    expect(linha.mes?.faturamento).toEqual({ vendido_cents: 10_000, faturado_cents: 3_000, a_faturar_cents: 7_000 });
    expect(montarPainelDia(s, vend, '2026-10-30', { modulos: new Set(['core']), agora: AGORA }).faturamento).toBeNull();
    expect(montarPainelDia(s, prom, '2026-10-30', { modulos: TODOS, agora: AGORA }).faturamento).toBeNull(); // RN-PRO-01
  });
});

describe('módulos opcionais desativados: o indicador some (null), o painel continua válido (RN-CORE-03)', () => {
  const s = montar([
    ...venda(1, { total: 10_000, em: '2026-10-30T15:00:00Z' }),
    checkin({ em: '2026-10-30T13:00:00Z' }),
    ev('pesquisa.resposta.registrada@1', '2026-10-30T13:10:00Z', { resposta_id: u(9100), questionario_id: u(9101), usuario_id: VENDEDOR, respondida_em: '2026-10-30T13:10:00Z', suspeita: true }),
    ev('treinamento.licao.concluida@1', '2026-10-30T12:00:00Z', { progresso_id: u(9200), usuario_id: VENDEDOR, trilha_id: u(9201), licao_id: u(9202), concluida_em: '2026-10-30T12:00:00Z', xp_ganho: 15, trilha_concluida: true }),
    ev('treinamento.medalha.conquistada@1', '2026-10-30T12:01:00Z', { medalha_usuario_id: u(9300), usuario_id: VENDEDOR, medalha_codigo: 'primeira_trilha', conquistada_em: '2026-10-30T12:01:00Z' }),
  ]);

  it('com todos os módulos: vendas, mês, pesquisa e treinamento preenchidos e o contrato PainelDia aceita a linha', () => {
    const p = montar([]);
    expect(p.pedidos).toEqual({});
    const linha = montarPainelDia(s, vend, '2026-10-30', { modulos: TODOS, agora: AGORA });
    expect(PainelDia.parse(linha)).toEqual(linha);
    expect(linha.vendas?.vendas_cents).toBe(10_000);
    expect(linha.mes?.vendas_cents).toBe(10_000);
    expect(linha.pesquisa).toEqual({ respostas: 1, suspeitas: 1 });
    expect(linha.treinamento).toEqual({ licoes_concluidas: 1, trilhas_concluidas: 1, xp_ganho: 15, medalhas: 1 });
    expect(linha.trade).toBeNull(); // perfil vendedor não tem trade
    expect(linha.status_dia).toBe('em_visita');
  });

  it('sem Vendedor: vendas e mês null; as visitas do Core continuam', () => {
    const linha = montarPainelDia(s, vend, '2026-10-30', { modulos: new Set(['core', 'pesquisa']), agora: AGORA });
    expect(PainelDia.parse(linha)).toEqual(linha);
    expect(linha.vendas).toBeNull();
    expect(linha.mes).toBeNull();
    expect(linha.visitas.realizadas).toBe(1);
    expect(linha.visitas.conversao_pedido_pct).toBeNull();
    expect(linha.treinamento).toBeNull();
    expect(linha.pesquisa).not.toBeNull();
  });

  it('só Core: pesquisa, treinamento, vendas e trade todos null', () => {
    const linha = montarPainelDia(s, vend, '2026-10-30', { modulos: new Set(['core']), agora: AGORA });
    expect(PainelDia.parse(linha)).toEqual(linha);
    expect([linha.vendas, linha.mes, linha.faturamento, linha.trade, linha.pesquisa, linha.treinamento]).toEqual([null, null, null, null, null, null]);
  });

  it('RN-PRO-01: o promotor nunca tem seção de vendas, mesmo com o Vendedor ativo', () => {
    const linha = montarPainelDia(s, prom, '2026-10-30', { modulos: TODOS, agora: AGORA });
    expect(linha.vendas).toBeNull();
    expect(linha.mes).toBeNull();
    expect(linha.trade).not.toBeNull();
  });

  it('sem Promotor: o promotor aparece sem trade', () => {
    const linha = montarPainelDia(s, prom, '2026-10-30', { modulos: new Set(['core', 'vendedor']), agora: AGORA });
    expect(linha.trade).toBeNull();
    expect(PainelDia.parse(linha)).toEqual(linha);
  });
});

