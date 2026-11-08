/**
 * T-0124 — varredura "valor × regra" e "rótulo × valor" dos indicadores e números de tela do Campo, do Gestão e do BKO,
 * sem banco (roda local e no CI). Complementa tests/modulos/meta-de-hoje-rd0001-t0124.test.ts (cartão "Meta de hoje").
 *
 * Para cada número: a RN que o define, um ORÁCULO escrito aqui a partir do texto da RN (nunca a função testada) e o valor
 * que a tela recebe da lib/domain do dono, com dia útil, dia não útil, virada de mês e fuso de Manaus quando se aplicam.
 * Telas cobertas: Início do Campo (linhas de Visitas, Positivação e Cobertura; cards Orçamentos e A faturar), Metas do Campo
 * ("Indicadores do mês"), Indicadores do BKO (mesmo texto do app), Ficha do vendedor e painel do Gestor (painelDoMes /
 * faturamento) e Ranking.
 *
 * Defeitos achados ficam em `it.fails` (falham hoje pelo motivo descrito; o agente testes volta para `it` no commit da
 * correção) e viraram pedido ao dono. Matriz e resultados: docs/testes/T-0124.md.
 */
import { describe, expect, it } from 'vitest';

import type { IndicadorDiarioSync, IndicadoresLista, Inicio, MetaSync, RotaParadaSync, VisitaSync } from '../../modules/core/contracts';
import { montarInicio } from '../../modules/core/app/lib/inicio-local';
import { painelLocal } from '../../modules/core/app/lib/metas-local';
import { textoDaLinha, textoNecessidadeDiaria } from '../../modules/core/app/lib/metas-formato';
import { celulasDoUsuario, CABECALHO } from '../../modules/core/web/lib/indicadores';
import { CLIENTE_A, CLIENTE_B, meta as metaGestor, pedidoCriado, statusAlterado, ev, u, VENDEDOR, VENDEDOR_2, SUPERVISOR } from '../../modules/gestor/domain/fixtures';
import { faturamentoDoPeriodo, painelDoMes, vendasDoPeriodo } from '../../modules/gestor/domain/painel';
import { aplicarEventos, estadoInicial, type EventoRecebido } from '../../modules/gestor/domain/projecao';
import { INDICADORES, rankingDaEquipe } from '../../modules/gestor/domain/ranking';
import { linhaAFaturar, linhaOrcamentos, resumoDoInicio } from '../../modules/vendedor/app/lib/resumo-inicio';
import type { PedidoDaLista } from '../../modules/vendedor/app/lib/pedidos';

// ---------- oráculos (texto da RN, independentes do código) ----------
const SEG_A_SAB = [1, 2, 3, 4, 5, 6]; // RN-CORE-26: calendário do tenant [`metas.dias_uteis_semana` = segunda a sábado]
function diasUteisRestantes(hoje: string, semana = SEG_A_SAB): number {
  const [a, m] = hoje.split('-').map(Number) as [number, number];
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  let n = 0;
  for (let d = Number(hoje.slice(8, 10)); d <= ultimo; d++) if (semana.includes(new Date(Date.UTC(a, m - 1, d, 12)).getUTCDay())) n++;
  return n;
}
/** RN-CORE-22: necessidade diária = (meta − realizado) ÷ dias úteis restantes (hoje conta), centavos para cima. */
const necessidadePelaRegra = (meta: number, realizado: number, hoje: string) => Math.max(0, Math.ceil((meta - realizado) / diasUteisRestantes(hoje)));
const brl0 = (cents: number) => `R$ ${Math.round(cents / 100).toLocaleString('pt-BR')}`;
const limpo = (s: string) => s.replace(/00a0/g, ' ');

// ---------- dados do Core ----------
const FUSO = 'America/Manaus';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ANA = id(1);
const base = { updated_at: '2026-11-10T10:00:00.000000Z', deleted_at: null, external_id: null };
const META = 18_000_000; // R$ 180.000
const metaSync = (indicador: MetaSync['indicador'], valor: number, periodo = '2026-11'): MetaSync => ({ ...base, id: id(900 + valor % 97), usuario_id: ANA, periodo, indicador, valor });
const parada = (n: number, cliente: number, data: string): RotaParadaSync => ({ ...base, id: id(200 + n), rota_id: id(300), usuario_id: ANA, data, cliente_id: id(cliente), sequencia: n }) as RotaParadaSync;
const visita = (n: number, cliente: number, data: string, extra = false): VisitaSync =>
  ({ ...base, id: id(400 + n), usuario_id: ANA, cliente_id: id(cliente), data_local: data, checkin_em: `${data}T13:00:00Z`, sem_gps: false, fora_do_raio: false, sugere_coordenada: false, extra, checkout_em: `${data}T13:30:00Z` }) as VisitaSync;
const diario = (data: string, vendido: number, cancelado = 0): IndicadorDiarioSync => ({ ...base, id: id(600 + Number(data.slice(8, 10))), usuario_id: ANA, data, pedidos: 1, vendido_cents: vendido, cancelado_cents: cancelado });

describe('T-0124 — Metas do Campo e Indicadores do BKO (RN-CORE-20/21/22)', () => {
  // terça 10/11 9h em Manaus; vendas só em 09/11 (R$ 553), então realizado do mês = realizado até ontem
  const agora = new Date('2026-11-10T13:00:00Z');
  const linhas = { paradas: [], visitas: [], diarios: [diario('2026-11-09', 55_300)], metas: [metaSync('venda_cents', META)] };

  it('I1. Venda: realizado = soma dos diários líquidos do mês; atingimento = realizado ÷ meta; rótulo "Venda" com "R$ 553 de R$ 180.000"', () => {
    const p = painelLocal(linhas, [], { usuarioId: ANA, fuso: FUSO, agora });
    const l = p.metas.find((m) => m.indicador === 'venda_cents')!;
    expect(l).toMatchObject({ meta: META, realizado: 55_300, atingimento_pct: Math.round((55_300 / META) * 10_000) });
    const t = textoDaLinha(l);
    expect(t.rotulo).toBe('Venda');
    expect(limpo(`${t.realizado} de ${t.meta}`)).toBe('R$ 553 de R$ 180.000');
    expect(t.atingimento).toBe('0,31%');
  });

  it('I2. RN-CORE-21: cancelamento abate o realizado; dia nunca negativo; diário de outubro não entra em novembro', () => {
    const p = painelLocal({ ...linhas, diarios: [diario('2026-11-09', 55_300, 5_300), diario('2026-11-05', 1_000, 9_000), diario('2026-10-31', 999_999)] }, [], { usuarioId: ANA, fuso: FUSO, agora });
    expect(p.indicadores.realizado_cents).toBe(50_000);
  });

  it('I3. RN-CORE-22 × RN-CORE-26: "Precisa de R$ X por dia útil" usa o calendário do tenant (seg–sáb, 18 dias em 10/11), igual ao Início (regressão: antes seg–sex, 15; corrigido em 08/11)', () => {
    const p = painelLocal(linhas, [], { usuarioId: ANA, fuso: FUSO, agora });
    expect(p.indicadores.dias_uteis_restantes).toBe(diasUteisRestantes('2026-11-10'));
    expect(p.indicadores.necessidade_diaria_cents).toBe(necessidadePelaRegra(META, 55_300, '2026-11-10'));
    expect(limpo(textoNecessidadeDiaria(p.indicadores))).toBe(`Precisa de ${brl0(necessidadePelaRegra(META, 55_300, '2026-11-10'))} por dia útil (18 restantes).`);
  });

  it('I4. BKO Indicadores, coluna "Necessidade diária": mesmo número do app e do Início (seg–sáb; regressão: antes R$ 11.963 com 15 dias)', () => {
    const p = painelLocal(linhas, [], { usuarioId: ANA, fuso: FUSO, agora });
    const item = { usuario_id: ANA, usuario_nome: 'Ana', indicadores: p.indicadores, metas: p.metas } as unknown as IndicadoresLista['itens'][number];
    const celulas = celulasDoUsuario(item).map(limpo);
    expect(CABECALHO[7]).toBe('Necessidade diária');
    expect(celulas[7]).toBe('Precisa de R$ 9.969 por dia útil (18 restantes).');
  });

  it('I5. fuso de Manaus: segunda 23h30 (terça 03h30 UTC) ainda é 09/11 — o diário de 09/11 é "hoje" e o mês é novembro', () => {
    const p = painelLocal(linhas, [], { usuarioId: ANA, fuso: FUSO, agora: new Date('2026-11-10T03:30:00Z') });
    expect(p.periodo).toBe('2026-11');
    expect(p.indicadores.realizado_cents).toBe(55_300);
  });

  it('I6. virada de mês: 01/12 00h30 em Manaus — novembro não entra em dezembro (realizado 0, meta de dezembro)', () => {
    const p = painelLocal({ ...linhas, metas: [metaSync('venda_cents', META, '2026-12')] }, [], { usuarioId: ANA, fuso: FUSO, agora: new Date('2026-12-01T04:30:00Z') });
    expect(p.periodo).toBe('2026-12');
    expect(p.indicadores.realizado_cents).toBe(0);
    expect(p.metas[0]).toMatchObject({ meta: META, realizado: 0, atingimento_pct: 0 });
  });

  it('I7. RN-CORE-20: visitado = check-in no dia da parada planejada; visita extra fora; cobertura = visitados ÷ planejados (máx. 100%)', () => {
    const p = painelLocal(
      { ...linhas, paradas: [parada(1, 501, '2026-11-09'), parada(2, 502, '2026-11-09'), parada(3, 503, '2026-11-10'), parada(4, 504, '2026-11-11')], visitas: [visita(1, 501, '2026-11-09'), visita(2, 503, '2026-11-10'), visita(3, 509, '2026-11-10', true), visita(4, 502, '2026-11-10')], metas: [metaSync('visitas', 80), metaSync('cobertura_pct', 8_000)] },
      [],
      { usuarioId: ANA, fuso: FUSO, agora },
    );
    // planejadas 4; visitadas no dia da parada: 501 (09/11) e 503 (10/11) = 2; 502 visitado no dia errado e a extra 509 não contam
    expect(p.indicadores).toMatchObject({ planejados: 4, visitados: 2, cobertura_pct: 5_000 });
    const cob = textoDaLinha(p.metas.find((m) => m.indicador === 'cobertura_pct')!);
    expect(cob).toMatchObject({ rotulo: 'Cobertura de rota', realizado: '50,00%', meta: '80,00%', atingimento: '62,50%' });
    expect(textoDaLinha(p.metas.find((m) => m.indicador === 'visitas')!)).toMatchObject({ rotulo: 'Visitas', realizado: '2', meta: '80' });
  });
});

describe('T-0124 — Início do Campo: linhas de Visitas, Positivação e Cobertura (RN-CORE-20/26/27)', () => {
  const agora = new Date('2026-11-10T13:00:00Z');
  const copia: Inicio = { dia: '2026-11-10', periodo: '2026-11', calculado_em: '2026-11-10T13:00:00.000Z', escopo: 'proprio', usuarios: [{ usuario_id: ANA, nome: 'Ana', perfil: 'vendedor', equipe_id: null, tipo_meta_venda: 'pedido', venda_cents: { ate_ontem: 55_300, hoje: 0 }, positivacao: { ate_ontem: 10, hoje: 1 } }], metas_do_dia: [] };
  const linhas = {
    metas: [metaSync('visitas', 120), metaSync('positivacao', 40), metaSync('cobertura_pct', 8_000)],
    paradas: [parada(1, 501, '2026-11-09'), parada(2, 502, '2026-11-10'), parada(3, 503, '2026-11-10')],
    visitas: [visita(1, 501, '2026-11-09'), visita(2, 502, '2026-11-10'), visita(3, 509, '2026-11-10', true)],
    notificacoes: [],
    parametros: [],
    clientes: [],
  };
  const v = montarInicio(linhas, copia, [], { usuarioId: ANA, perfil: 'vendedor', fuso: FUSO, agora });
  const de = (ind: string) => v.metas.find((m) => m.indicador === ind)!;

  it('L1. Visitas: até ontem 1, hoje 1 (a extra não conta); meta do dia = ⌈(120 − 1) ÷ 18⌉ = 7', () => {
    expect(de('visitas')).toMatchObject({ realizado_ate_ontem: 1, realizado_hoje: 1, meta_dia: Math.ceil((120 - 1) / diasUteisRestantes('2026-11-10')) });
  });

  it('L2. Positivação (cópia da API): até ontem 10, hoje 1; meta do dia = ⌈(40 − 10) ÷ 18⌉ = 2', () => {
    expect(de('positivacao')).toMatchObject({ realizado_ate_ontem: 10, realizado_hoje: 1, meta_dia: Math.ceil(30 / 18) });
  });

  it('L3. Cobertura é razão do mês (RN-CORE-26): sem meta do dia; realizado = visitados ÷ planejados do mês (2 ÷ 3)', () => {
    const c = de('cobertura_pct');
    expect(c).toMatchObject({ situacao: 'do_mes', meta_dia: null, meta_mes: 8_000 });
    expect(c.realizado_ate_ontem + c.realizado_hoje).toBe(Math.round((2 / 3) * 10_000));
  });

  it('L4. dia não útil (domingo 08/11): Visitas e Positivação sem meta do dia', () => {
    const dom = montarInicio(linhas, { ...copia, dia: '2026-11-08' }, [], { usuarioId: ANA, perfil: 'vendedor', fuso: FUSO, agora: new Date('2026-11-08T18:00:00Z') });
    for (const ind of ['visitas', 'positivacao']) expect(dom.metas.find((m) => m.indicador === ind)).toMatchObject({ situacao: 'dia_nao_util', meta_dia: null });
  });
});

describe('T-0124 — cards Orçamentos e A faturar do Início (RN-VEN-18, RN-VEN-30)', () => {
  const doc = (o: Partial<PedidoDaLista> & { total_cents: number }): PedidoDaLista =>
    ({ id: id(Math.floor(Math.random() * 1e6)), seller_id: ANA, tipo: 'pedido', status: 'approved', local: false, local_error: '', convertido_pedido_id: null, validade_data: null, validade_ate: null, received_at: null, ...o }) as unknown as PedidoDaLista;
  const pedidos = [
    doc({ tipo: 'orcamento', status: 'received', total_cents: 100_000, validade_data: '2026-11-08' }),
    doc({ tipo: 'orcamento', status: 'received', total_cents: 15_000, validade_data: '2026-11-09' }),
    doc({ tipo: 'orcamento', status: 'cancelled', total_cents: 70_000, validade_data: '2026-11-30' }),
    doc({ status: 'pending_approval', total_cents: 50_000 }),
    doc({ status: 'integrated', total_cents: 248_000 }),
    doc({ status: 'invoiced', total_cents: 900_000 }),
    doc({ status: 'cancelled', total_cents: 300_000 }),
    doc({ status: 'queued', total_cents: 11_000, local: true }),
    doc({ status: 'approved', total_cents: 77_700, seller_id: id(2) }),
  ];
  const resumo = (agora: string) => resumoDoInicio(pedidos, { agora: new Date(agora), fuso: FUSO, diasValidade: 7, vendedorId: ANA, preVendaLigada: true });

  it('O1. fuso de Manaus: domingo 08/11 23h30 (09/11 03h30 UTC) o orçamento válido até 08/11 ainda conta, e o de 09/11 "vence amanhã"', () => {
    const r = resumo('2026-11-09T03:30:00Z');
    expect(r.orcamentos).toEqual({ quantidade: 2, valor_cents: 115_000, vencem_amanha: 1 });
    expect(limpo(linhaOrcamentos(r.orcamentos!))).toBe('R$ 1.150 · 1 vence amanhã');
  });

  it('O2. virada do dia: 09/11 00h30 em Manaus o de 08/11 sai; cancelado nunca conta', () => {
    expect(resumo('2026-11-09T04:30:00Z').orcamentos).toEqual({ quantidade: 1, valor_cents: 15_000, vencem_amanha: 0 });
  });

  it('F1. A faturar (RN-VEN-30, decisão de 04/11): aguardando aprovação + aprovado/enviado/integrado do próprio vendedor; faturado, cancelado, na fila e de outro vendedor ficam fora', () => {
    const r = resumo('2026-11-10T13:00:00Z');
    expect(r.aFaturar).toEqual({ quantidade: 2, valor_cents: 298_000, aguardando_aprovacao: 1 });
    expect(limpo(linhaAFaturar(r.aFaturar))).toBe('R$ 2.980 · 1 aguardando aprovação');
  });
});

describe('T-0124 — Gestor: Ficha do vendedor, painel e Ranking (RN-CORE-21/22, RN-GES-06)', () => {
  const montar = (eventos: EventoRecebido[]) => aplicarEventos(estadoInicial(), eventos).estado;
  const venda = (n: number, o: { total: number; criado: string; aprovado: string; cliente?: string; vendedor?: string }): EventoRecebido[] => [
    pedidoCriado({ pedido: u(1000 + n), total: o.total, em: o.criado, cliente: o.cliente, vendedor: o.vendedor }),
    statusAlterado({ pedido: u(1000 + n), vendedor: o.vendedor, para: 'aprovado', em: o.aprovado }),
  ];
  const P = { fuso: FUSO };

  it('G1. fuso de Manaus: pedido emitido e aprovado 31/10 22h em Manaus (01/11 02h UTC) é de outubro', () => {
    const s = montar(venda(1, { total: 7_000, criado: '2026-11-01T02:00:00Z', aprovado: '2026-11-01T02:00:00Z' }));
    expect(vendasDoPeriodo(s, VENDEDOR, '2026-10-01', '2026-10-31', P).vendas_cents).toBe(7_000);
    expect(vendasDoPeriodo(s, VENDEDOR, '2026-11-01', '2026-11-30', P).vendas_cents).toBe(0);
  });

  it('G2. RN-CORE-21: pedido EMITIDO em 31/10 e aprovado em 02/11 conta em OUTUBRO (data de emissão), na Ficha, no painel e no Ranking (regressão: antes contava pela data da aprovação)', () => {
    const s = montar(venda(2, { total: 50_000, criado: '2026-10-31T15:00:00Z', aprovado: '2026-11-02T14:00:00Z' }));
    expect(painelDoMes(s, VENDEDOR, '2026-10-31', P).vendas_cents).toBe(50_000);
    expect(painelDoMes(s, VENDEDOR, '2026-11-05', P).vendas_cents).toBe(0);
  });

  it('G3. RN-GES-06: vendido = valor dos pedidos; faturado = o que o ERP faturou; a faturar = vendido − faturado (parcial pelos itens)', () => {
    const s = montar([
      ...venda(3, { total: 10_000, criado: '2026-11-10T14:00:00Z', aprovado: '2026-11-10T14:05:00Z' }),
      ...venda(4, { total: 6_000, criado: '2026-11-10T15:00:00Z', aprovado: '2026-11-10T15:05:00Z', cliente: CLIENTE_B }),
      ev('vendedor.pedido.faturado@1', '2026-11-10T18:00:00Z', { pedido_id: u(1004), vendedor_id: VENDEDOR, faturado_em: '2026-11-10T18:00:00Z', parcial: false, itens: [{ produto_id: u(901), quantidade: 1 }] }),
    ]);
    const f = faturamentoDoPeriodo(s, VENDEDOR, '2026-11-10', '2026-11-10', P);
    expect(f).toEqual({ vendido_cents: 16_000, faturado_cents: 6_000, a_faturar_cents: 16_000 - 6_000 });
  });

  it('G4. Ficha "Mês": atingimento = vendido no mês ÷ meta × 100; falta = meta − vendido', () => {
    const s = montar([metaGestor(VENDEDOR, '2026-11', META, '2026-11-01T10:00:00Z'), ...venda(5, { total: 55_300, criado: '2026-11-09T14:00:00Z', aprovado: '2026-11-09T14:00:00Z' })]);
    const m = painelDoMes(s, VENDEDOR, '2026-11-10', P);
    expect(m).toMatchObject({ vendas_cents: 55_300, meta_cents: META, falta_cents: META - 55_300 });
    expect(m.atingimento_pct).toBeCloseTo((55_300 / META) * 100, 2);
  });

  it('G5. Ficha "Precisa por dia" (RN-CORE-22): mesmo calendário da meta do tenant (seg–sáb, 18 dias em 10/11) do Início e de Metas (regressão: antes seg–sex, 15)', () => {
    const s = montar([metaGestor(VENDEDOR, '2026-11', META, '2026-11-01T10:00:00Z'), ...venda(6, { total: 55_300, criado: '2026-11-09T14:00:00Z', aprovado: '2026-11-09T14:00:00Z' })]);
    const m = painelDoMes(s, VENDEDOR, '2026-11-10', P);
    expect(m.dias_uteis_restantes).toBe(diasUteisRestantes('2026-11-10'));
    expect(m.necessidade_diaria_cents).toBe(necessidadePelaRegra(META, 55_300, '2026-11-10'));
  });

  it('G6. Ranking "Atingimento da meta (mensal)" = vendas do mês ÷ meta; rótulo coerente; quem não tem meta fica sem posição', () => {
    const s = montar([
      metaGestor(VENDEDOR, '2026-11', 1_000_000, '2026-11-01T10:00:00Z'),
      metaGestor(VENDEDOR_2, '2026-11', 2_000_000, '2026-11-01T10:00:00Z', 'm2'),
      ...venda(7, { total: 500_000, criado: '2026-11-09T14:00:00Z', aprovado: '2026-11-09T14:00:00Z' }),
      ...venda(8, { total: 1_500_000, criado: '2026-11-09T15:00:00Z', aprovado: '2026-11-09T15:00:00Z', vendedor: VENDEDOR_2, cliente: CLIENTE_A }),
    ]);
    const membros = [
      { id: SUPERVISOR, nome: 'Sup', perfil: 'supervisor' as const, superior_id: null, ativo: true },
      { id: VENDEDOR, nome: 'Ana', perfil: 'vendedor' as const, superior_id: SUPERVISOR, ativo: true },
      { id: VENDEDOR_2, nome: 'Bruno', perfil: 'vendedor' as const, superior_id: SUPERVISOR, ativo: true },
      { id: u(102), nome: 'Caio', perfil: 'vendedor' as const, superior_id: SUPERVISOR, ativo: true },
    ];
    const r = rankingDaEquipe({ estado: s, membros, viewer: { id: SUPERVISOR, perfil: 'supervisor' }, indicador: 'atingimento_meta_pct', periodo: 'mensal', data_ref: '2026-11-10', modulos: new Set(['vendedor']), params: P, agora: '2026-11-10T13:00:00Z' });
    expect(INDICADORES.atingimento_meta_pct.rotulo).toBe('Atingimento da meta (mensal)');
    expect(r.linhas.map((l) => [l.nome, l.valor, l.posicao])).toEqual([
      ['Bruno', (1_500_000 / 2_000_000) * 100, 1],
      ['Ana', (500_000 / 1_000_000) * 100, 2],
      ['Caio', null, null],
    ]);
    void CLIENTE_A;
  });
});
