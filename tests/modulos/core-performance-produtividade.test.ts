/**
 * T-0170 — os 12 indicadores de produtividade (`produtividadeDoPeriodo`, RN-CORE-43, 44 e 46), sem banco.
 * Mês sintético e oráculo: docs/testes/T-0170-performance.md §1.2, §1.3 e §4 (P-1 a P-12, K-1, V-2, H-1, S-1 e S-2). Os
 * valores esperados foram contados à mão a partir das fórmulas do desenho (§3), nunca pela função testada.
 * Hoje = sexta 13/11/2026, 11:00 em Manaus (UTC−4). Metas = padrão do FDV (D5), salvo no S-2.
 */
import { describe, expect, it } from 'vitest';

import type { IndicadorProdutividade, ProdutividadeIndicador } from '../../modules/core/contracts/performance';
import type { VisitaProdutividade } from '../../modules/core/domain/performance/almoco';
import { metasPadrao } from '../../modules/core/domain/performance/metas-produtividade';
import {
  produtividadeDoPeriodo,
  type DeslocamentoResumo,
  type EntradaProdutividade,
  type ParadaPlanejada,
} from '../../modules/core/domain/performance/produtividade';

const FUSO = 'America/Manaus';
/** Instante UTC de "AAAA-MM-DD HH:MM" em Manaus (UTC−4, sem horário de verão). */
const em = (data: string, hhmm: string) => new Date(`${data}T${hhmm}:00-04:00`).toISOString();

type Rota = 'P' | 'E';
interface Linha {
  cli: string;
  rota: Rota;
  ini: string;
  fim: string | null;
  d: number | null;
  resultado?: string;
  auto?: boolean;
  semGps?: boolean;
  removida?: boolean;
}

const visitas: VisitaProdutividade[] = [];
const paradas: ParadaPlanejada[] = [];

function dia(data: string, linhas: readonly Linha[]): void {
  for (const l of linhas) {
    const checkout = l.fim === null ? null : l.auto ? em(data, '23:59') : em(data, l.fim);
    visitas.push({
      cliente_id: l.cli,
      data_local: data,
      checkin_em: em(data, l.ini),
      checkout_em: checkout,
      resultado: l.fim === null ? null : l.auto ? 'nao_finalizado' : (l.resultado ?? 'pedido'),
      fechada_por: l.fim === null ? null : l.auto ? 'auto' : 'usuario',
      sem_gps: l.semGps ?? false,
      distancia_m: l.d,
      deleted_at: l.removida ? em(data, '18:00') : null,
    });
    if (l.rota === 'P' && !l.removida && !paradas.some((p) => p.cliente_id === l.cli && p.data === data))
      paradas.push({ cliente_id: l.cli, data, rota_id: `rota-${data}` });
  }
}
/** Paradas planejadas sem visita (falta, pendentes de hoje, futuras ou de rota cancelada). */
function paradasSemVisita(data: string, n: number, rota_id = `rota-${data}`): void {
  for (let i = 1; i <= n; i++) paradas.push({ cliente_id: `${rota_id}-nv${i}`, data, rota_id });
}

/** Dia A (§1.2): 8 visitas, 7 paradas planejadas, almoço 11:30–13:00. */
const diaA = (data: string, p: string): Linha[] => [
  { cli: `${p}1`, rota: 'P', ini: '07:50', fim: '08:20', d: 40 },
  { cli: `${p}2`, rota: 'P', ini: '08:45', fim: '09:25', d: 60 },
  { cli: `${p}3`, rota: 'P', ini: '09:55', fim: '10:35', d: 20, resultado: 'sem_pedido' },
  { cli: `${p}4`, rota: 'P', ini: '11:00', fim: '11:30', d: 80 },
  { cli: `${p}5`, rota: 'E', ini: '13:00', fim: '13:50', d: 50 },
  { cli: `${p}6`, rota: 'P', ini: '14:15', fim: '14:55', d: 30 },
  { cli: `${p}7`, rota: 'P', ini: '15:25', fim: '16:05', d: 70 },
  { cli: `${p}8`, rota: 'P', ini: '16:30', fim: '17:10', d: 90 },
];

dia('2026-11-03', diaA('2026-11-03', 'A'));
dia('2026-11-04', diaA('2026-11-04', 'B'));
// 05/11: dia sem almoço (atendimento longo 10:40–15:10) e uma rota cancelada com 3 paradas.
dia('2026-11-05', [
  { cli: 'C1', rota: 'P', ini: '07:40', fim: '08:10', d: 40 },
  { cli: 'C2', rota: 'P', ini: '08:35', fim: '09:15', d: 60 },
  { cli: 'C3', rota: 'P', ini: '09:40', fim: '10:20', d: 20 },
  { cli: 'C4', rota: 'P', ini: '10:40', fim: '15:10', d: 30 },
  { cli: 'C5', rota: 'P', ini: '15:30', fim: '16:10', d: 50 },
  { cli: 'C6', rota: 'E', ini: '16:35', fim: '17:15', d: 60 },
]);
paradasSemVisita('2026-11-05', 3, 'rota-cancelada-05');
// 06/11: a 7ª visita fica aberta e fecha sozinha na virada (RN-CORE-11); uma parada planejada não visitada.
dia('2026-11-06', [
  { cli: 'D1', rota: 'P', ini: '08:10', fim: '08:40', d: 40 },
  { cli: 'D2', rota: 'P', ini: '09:05', fim: '09:45', d: 60 },
  { cli: 'D3', rota: 'P', ini: '10:10', fim: '10:50', d: 20 },
  { cli: 'D4', rota: 'P', ini: '11:15', fim: '11:45', d: 80 },
  { cli: 'D5', rota: 'P', ini: '13:15', fim: '13:55', d: 50 },
  { cli: 'D6', rota: 'P', ini: '14:20', fim: '15:00', d: 30 },
  { cli: 'D7', rota: 'E', ini: '16:50', fim: '23:59', d: 70, auto: true },
]);
paradasSemVisita('2026-11-06', 1);
// 07/11 (sábado): meio expediente, todas extras, termina antes do corte.
dia('2026-11-07', [
  { cli: 'E1', rota: 'E', ini: '08:00', fim: '08:30', d: 40 },
  { cli: 'E2', rota: 'E', ini: '08:55', fim: '09:35', d: 60 },
  { cli: 'E3', rota: 'E', ini: '10:00', fim: '10:40', d: 20 },
]);
// 09/11: visita que atravessa o corte, cliente fechado e uma visita removida.
dia('2026-11-09', [
  { cli: 'F1', rota: 'P', ini: '07:55', fim: '08:25', d: 40 },
  { cli: 'F2', rota: 'P', ini: '08:50', fim: '09:30', d: 60 },
  { cli: 'F3', rota: 'P', ini: '09:55', fim: '10:35', d: 20 },
  { cli: 'F4', rota: 'P', ini: '11:40', fim: '12:20', d: 80 },
  { cli: 'F5', rota: 'P', ini: '13:30', fim: '13:40', d: 50, resultado: 'cliente_fechado' },
  { cli: 'F6', rota: 'P', ini: '14:05', fim: '14:45', d: 30 },
  { cli: 'F7', rota: 'P', ini: '15:10', fim: '15:50', d: 70 },
  { cli: 'F8', rota: 'P', ini: '16:15', fim: '16:55', d: 90 },
  { cli: 'F9', rota: 'E', ini: '17:30', fim: '17:45', d: 10, removida: true },
]);
// 10/11: falta, 6 paradas planejadas.
paradasSemVisita('2026-11-10', 6);
// 11/11: duas visitas em G1, cliente sem coordenada (G2) e check-in sem GPS (G3).
dia('2026-11-11', [
  { cli: 'G1', rota: 'P', ini: '07:45', fim: '08:15', d: 40 },
  { cli: 'G2', rota: 'P', ini: '08:40', fim: '09:20', d: null },
  { cli: 'G3', rota: 'P', ini: '09:45', fim: '10:25', d: null, semGps: true },
  { cli: 'G4', rota: 'P', ini: '10:50', fim: '11:30', d: 80 },
  { cli: 'G5', rota: 'P', ini: '13:00', fim: '13:40', d: 50 },
  { cli: 'G1', rota: 'P', ini: '14:05', fim: '14:25', d: 30 },
  { cli: 'G7', rota: 'E', ini: '14:50', fim: '15:30', d: 70 },
  { cli: 'G8', rota: 'P', ini: '15:55', fim: '16:35', d: 90 },
]);
dia('2026-11-12', diaA('2026-11-12', 'L'));
// 13/11 (hoje, até 11:00): a 4ª visita está aberta; 3 paradas ainda por fazer.
dia('2026-11-13', [
  { cli: 'H1', rota: 'P', ini: '08:05', fim: '08:35', d: 40 },
  { cli: 'H2', rota: 'P', ini: '09:00', fim: '09:40', d: 60 },
  { cli: 'H3', rota: 'E', ini: '10:05', fim: '10:45', d: 20 },
  { cli: 'H4', rota: 'P', ini: '10:50', fim: null, d: 80 },
]);
paradasSemVisita('2026-11-13', 3);
// Depois de hoje: 16/11 já tem rota com 5 paradas.
paradasSemVisita('2026-11-16', 5);

const rotas = [{ id: 'rota-cancelada-05', situacao: 'cancelada' }];
const KM: DeslocamentoResumo[] = [
  { data: '2026-11-03', metros: 95_000 },
  { data: '2026-11-04', metros: 110_000 },
  { data: '2026-11-12', metros: 88_000 },
  { data: '2026-11-13', metros: 30_000 },
];

const entrada = (o: Partial<EntradaProdutividade> = {}): EntradaProdutividade => ({
  de: '2026-11-01',
  ate: '2026-11-30',
  hoje: '2026-11-13',
  fuso: FUSO,
  visitas,
  paradas,
  rotas,
  deslocamentos: KM,
  metas: metasPadrao(),
  ...o,
});

type Esperado = Pick<ProdutividadeIndicador, 'valor' | 'situacao' | 'amostra'>;
const resumo = (l: readonly ProdutividadeIndicador[]): Record<string, Esperado> =>
  Object.fromEntries(l.map((i) => [i.indicador, { valor: i.valor, situacao: i.situacao, amostra: i.amostra }]));
const um = (l: readonly ProdutividadeIndicador[], ind: IndicadorProdutividade): ProdutividadeIndicador => {
  const i = l.find((x) => x.indicador === ind);
  if (!i) throw new Error(`indicador ausente: ${ind}`);
  return i;
};

/** §4 do roteiro: Este mês com hoje 13/11, metas do padrão do FDV. */
const MES: Record<IndicadorProdutividade, Esperado> = {
  primeiro_checkin: { valor: 474, situacao: 'dentro', amostra: 9 },
  ultimo_checkin: { valor: 938, situacao: 'fora', amostra: 8 },
  tma: { valor: 42, situacao: 'fora', amostra: 57 },
  tmd: { valor: 28, situacao: 'fora', amostra: 45 },
  almoco: { valor: 87, situacao: 'dentro', amostra: 6 },
  jornada_liquida: { valor: 436, situacao: 'fora', amostra: 8 },
  fora_rota: { valor: 1695, situacao: 'fora', amostra: 59 },
  visitas_dia: { valor: 69, situacao: 'fora', amostra: 8 },
  cobertura_rota: { valor: 8750, situacao: 'fora', amostra: 56 },
  raio_checkin: { valor: 53, situacao: 'dentro', amostra: 58 },
  km_dia: { valor: 97_667, situacao: 'dentro', amostra: 3 },
  km_cliente: { valor: 11_963, situacao: 'dentro', amostra: 27 },
};

describe('T-0170 · Produtividade do mês sintético (RN-CORE-43/44/46)', () => {
  const r = produtividadeDoPeriodo(entrada());

  it('devolve os 12 indicadores, com a meta e a origem do padrão do FDV (D5)', () => {
    expect(r).toHaveLength(12);
    expect(um(r, 'tma')).toMatchObject({ meta: 30, meta_origem: 'padrao_fdv' });
    expect(um(r, 'km_dia')).toMatchObject({ meta: 120_000, meta_origem: 'padrao_fdv' });
  });

  it.each([
    ['P-1 · RN-CORE-43: 1º check-in = média dos 9 dias trabalhados, hoje e sábado incluídos (07:54)', 'primeiro_checkin'],
    ['P-2 · RN-CORE-43: último check-in só nos 8 dias encerrados; removida fora (15:38)', 'ultimo_checkin'],
    ['P-3 · RN-CORE-43/11/14: TMA por visita com check-out real, sem virada, aberta nem cliente fechado (42)', 'tma'],
    ['P-4 · RN-CORE-43/44: TMD por intervalo sem o almoço; conta o intervalo até a fechada pela virada (A-1) (28)', 'tmd'],
    ['P-5 · RN-CORE-44: almoço só nos 6 encerrados com almoço; 09/11 pelo caso 3 (70) (1h27)', 'almoco'],
    ['P-6 · RN-CORE-44: jornada líquida; 05/11 sem almoço desconta 0; 06/11 termina no último check-in (7h16)', 'jornada_liquida'],
    ['P-7 · RN-CORE-43/20: % fora de rota = 10 extras ÷ 59 visitas contadas (16,9%)', 'fora_rota'],
    ['P-8 · RN-CORE-43: visitas por dia = 55 ÷ 8 dias encerrados, sábado incluído, falta fora (6,9)', 'visitas_dia'],
    ['P-9 · RN-CORE-43/20: cobertura 49 ÷ 56; pendentes de hoje, 16/11 e rota cancelada fora (87,5%)', 'cobertura_rota'],
    ['P-10 · RN-CORE-43/10: raio só com GPS e coordenada; G2 e G3 fora (53 m)', 'raio_checkin'],
    ['P-11 · RN-CORE-46: km por dia nos 3 encerrados com resumo; o parcial de hoje fora (97,7 km)', 'km_dia'],
    ['P-12 · RN-CORE-46: km por cliente = Σ km ÷ Σ clientes atendidos nos dias com resumo (A-5) (12,0 km)', 'km_cliente'],
  ] as const)('%s', (_caso, ind) => {
    expect(resumo(r)[ind]).toEqual(MES[ind]);
  });
});

describe('T-0170 · variações da Produtividade', () => {
  it('K-1 · RN-CORE-46: sem resumo de km, os 2 cards de km ficam sem dado ("—") com a meta visível; os outros 10 não mudam', () => {
    const r = produtividadeDoPeriodo(entrada({ deslocamentos: [] }));
    expect(um(r, 'km_dia')).toEqual({
      indicador: 'km_dia', situacao: 'sem_dado', valor: null, meta: 120_000, meta_origem: 'padrao_fdv', amostra: 0,
    });
    expect(um(r, 'km_cliente')).toEqual({
      indicador: 'km_cliente', situacao: 'sem_dado', valor: null, meta: 12_000, meta_origem: 'padrao_fdv', amostra: 0,
    });
    const outros = Object.fromEntries(Object.entries(MES).filter(([k]) => k !== 'km_dia' && k !== 'km_cliente'));
    const obtido = resumo(r);
    for (const k of Object.keys(outros)) expect(obtido[k]).toEqual(outros[k]);
  });

  it('V-2 · RN-CORE-43: virada para sábado 14/11 sem sinal: 13/11 vira encerrado com a visita ainda aberta', () => {
    const r = resumo(produtividadeDoPeriodo(entrada({ hoje: '2026-11-14' })));
    expect(r).toEqual({
      ...MES,
      ultimo_checkin: { valor: 906, situacao: 'fora', amostra: 9 },
      jornada_liquida: { valor: 406, situacao: 'fora', amostra: 9 },
      visitas_dia: { valor: 66, situacao: 'fora', amostra: 9 },
      cobertura_rota: { valor: 8305, situacao: 'fora', amostra: 59 },
      km_dia: { valor: 80_750, situacao: 'dentro', amostra: 4 },
    });
  });

  it('H-1 · RN-CORE-43 (A-2): período Hoje usa só hoje até agora, inclusive os indicadores de fim de dia', () => {
    const r = resumo(produtividadeDoPeriodo(entrada({ de: '2026-11-13', ate: '2026-11-13' })));
    expect(r).toEqual({
      primeiro_checkin: { valor: 485, situacao: 'fora', amostra: 1 },
      ultimo_checkin: { valor: 650, situacao: 'fora', amostra: 1 },
      tma: { valor: 37, situacao: 'fora', amostra: 3 },
      tmd: { valor: 18, situacao: 'dentro', amostra: 3 },
      almoco: { valor: null, situacao: 'sem_dado', amostra: 0 },
      jornada_liquida: { valor: 165, situacao: 'fora', amostra: 1 },
      fora_rota: { valor: 2500, situacao: 'fora', amostra: 4 },
      visitas_dia: { valor: 40, situacao: 'fora', amostra: 1 },
      cobertura_rota: { valor: 10_000, situacao: 'dentro', amostra: 3 },
      raio_checkin: { valor: 50, situacao: 'dentro', amostra: 4 },
      km_dia: { valor: 30_000, situacao: 'dentro', amostra: 1 },
      km_cliente: { valor: 10_000, situacao: 'dentro', amostra: 3 },
    });
  });

  it('S-1 · RN-CORE-43: um dia de falta (10/11): 11 indicadores sem dado e cobertura 0 (0 ÷ 6)', () => {
    const r = produtividadeDoPeriodo(entrada({ de: '2026-11-10', ate: '2026-11-10' }));
    for (const i of r.filter((x) => x.indicador !== 'cobertura_rota'))
      expect([i.indicador, i.situacao, i.valor]).toEqual([i.indicador, 'sem_dado', null]);
    expect(resumo(r).cobertura_rota).toEqual({ valor: 0, situacao: 'fora', amostra: 6 });
  });

  it('S-1 · RN-CORE-43: um domingo sem parada (08/11): os 12 sem dado, cobertura incluída', () => {
    const r = produtividadeDoPeriodo(entrada({ de: '2026-11-08', ate: '2026-11-08' }));
    expect(r.every((i) => i.situacao === 'sem_dado' && i.valor === null)).toBe(true);
  });

  it('S-2 · RN-CORE-45: igual à meta é dentro (km por cliente 11.963 e TMA 42 do usuário)', () => {
    const r = produtividadeDoPeriodo(
      entrada({
        metas: {
          ...metasPadrao(),
          km_cliente: { valor: 11_963, origem: 'usuario' },
          tma: { valor: 42, origem: 'usuario' },
        },
      }),
    );
    expect(um(r, 'km_cliente')).toMatchObject({ valor: 11_963, situacao: 'dentro', meta_origem: 'usuario' });
    expect(um(r, 'tma')).toMatchObject({ valor: 42, situacao: 'dentro', meta_origem: 'usuario' });
  });
});
