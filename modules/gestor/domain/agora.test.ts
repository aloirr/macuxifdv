import { describe, expect, it } from 'vitest';
import { situacaoDaRota, statusAgora } from './agora';
import { CLIENTE_A, CLIENTE_B, CLIENTE_C, checkin, checkout, ev, maisMin, u, VENDEDOR } from './fixtures';
import { montarPainelDia } from './painel';
import { aplicarEventos, estadoInicial, type EventoRecebido } from './projecao';

const montar = (eventos: EventoRecebido[]) => aplicarEventos(estadoInicial(), eventos).estado;
const DIA = '2026-10-30';
const FUSO = 'America/Manaus';
const T0 = '2026-10-30T13:00:00Z'; // 09:00 em Manaus
const rota = (clientes: string[]) => ev('core.rota.dia_planejado@1', '2026-10-30T10:00:00Z', { usuario_id: VENDEDOR, data: DIA, cliente_ids: clientes });
const V1 = u(2101);

describe('T-0073 / RN-CORE-26 (Equipe agora): situação da rota no dia', () => {
  it('RN-CORE-26: paradas pendentes = clientes da rota sem check-in hoje; último checkout = o mais recente do dia', () => {
    const s = montar([
      rota([CLIENTE_A, CLIENTE_B, CLIENTE_C]),
      checkin({ visita: V1, cliente: CLIENTE_A, em: T0 }),
      checkout({ visita: V1, cliente: CLIENTE_A, em: maisMin(T0, 30) }),
    ]);
    expect(situacaoDaRota(s, VENDEDOR, DIA, FUSO)).toEqual({ paradas_planejadas: 3, paradas_pendentes: 2, ultimo_checkout_em: maisMin(T0, 30) });
  });

  it('RN-CORE-26: sem rota e sem visita, tudo zerado e sem checkout', () => {
    expect(situacaoDaRota(montar([]), VENDEDOR, DIA, FUSO)).toEqual({ paradas_planejadas: 0, paradas_pendentes: 0, ultimo_checkout_em: null });
  });

  it('RN-CORE-26: visita de ontem não conta para hoje', () => {
    const s = montar([rota([CLIENTE_A]), checkin({ visita: V1, cliente: CLIENTE_A, em: '2026-10-29T13:00:00Z' }), checkout({ visita: V1, cliente: CLIENTE_A, em: '2026-10-29T13:30:00Z' })]);
    expect(situacaoDaRota(s, VENDEDOR, DIA, FUSO)).toEqual({ paradas_planejadas: 1, paradas_pendentes: 1, ultimo_checkout_em: null });
  });
});

describe('T-0073 / RN-CORE-26 (Equipe agora): "parado" = 60 min sem check-in depois do último checkout, com paradas pendentes', () => {
  const co = T0;
  const base = { status_dia: 'em_rota' as const, paradas_planejadas: 3, paradas_pendentes: 2, ultimo_checkout_em: co, parado_min: 60 };

  it('RN-CORE-26: checkout há 59 min → em rota', () => {
    expect(statusAgora({ ...base, agora: maisMin(co, 59) })).toEqual({ status: 'em_rota', minutos_sem_atividade: 59 });
  });

  it('RN-CORE-26: checkout há 60 min → parado', () => {
    expect(statusAgora({ ...base, agora: maisMin(co, 60) })).toEqual({ status: 'parado', minutos_sem_atividade: 60 });
  });

  it('RN-CORE-26: o limite vem do parâmetro inicio.parado_min', () => {
    expect(statusAgora({ ...base, parado_min: 30, agora: maisMin(co, 30) }).status).toBe('parado');
    expect(statusAgora({ ...base, parado_min: 90, agora: maisMin(co, 80) }).status).toBe('em_rota');
  });

  it('RN-CORE-26: check-in aberto → em visita, nunca parado', () => {
    expect(statusAgora({ ...base, status_dia: 'em_visita', agora: maisMin(co, 300) }).status).toBe('em_visita');
  });

  it('RN-CORE-26: nenhuma visita hoje → sem check-in (não é parado: sem expediente nem GPS)', () => {
    expect(statusAgora({ ...base, status_dia: 'sem_checkin', ultimo_checkout_em: null, agora: maisMin(co, 300) }).status).toBe('sem_checkin');
  });

  it('RN-CORE-26: sem paradas pendentes → rota concluída, mesmo com checkout antigo', () => {
    expect(statusAgora({ ...base, paradas_pendentes: 0, agora: maisMin(co, 300) }).status).toBe('rota_concluida');
  });

  it('RN-CORE-26: sem rota planejada e já houve visita → rota concluída', () => {
    expect(statusAgora({ ...base, paradas_planejadas: 0, paradas_pendentes: 0, agora: maisMin(co, 300) }).status).toBe('rota_concluida');
  });

  it('RN-CORE-26: painel antigo (sem os campos novos) mantém o status do dia', () => {
    expect(statusAgora({ status_dia: 'em_rota', parado_min: 60, agora: maisMin(co, 300) })).toEqual({ status: 'em_rota', minutos_sem_atividade: null });
  });

  it('RN-CORE-26: o painel do dia carrega os campos usados pela regra', () => {
    const s = montar([rota([CLIENTE_A, CLIENTE_B]), checkin({ visita: V1, cliente: CLIENTE_A, em: T0 }), checkout({ visita: V1, cliente: CLIENTE_A, em: maisMin(T0, 20) })]);
    const p = montarPainelDia(s, { id: VENDEDOR, perfil: 'vendedor' }, DIA, { modulos: new Set(['core']), agora: maisMin(T0, 90) });
    expect(p).toMatchObject({ status_dia: 'em_rota', paradas_planejadas: 2, paradas_pendentes: 1, ultimo_checkout_em: maisMin(T0, 20) });
  });
});
