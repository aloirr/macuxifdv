import { describe, expect, it } from 'vitest';
import { equipeAgora, RECADO_DO_DIA_PADRAO, recadoDoDia, type NotificacaoParaRecado, type ParadaDoDia, type VisitaDoDia } from './inicio';

const U = '0e700000-0000-4000-8000-000000000001';
const N1 = '0e700000-0000-4000-8000-0000000000a1';
const N2 = '0e700000-0000-4000-8000-0000000000a2';
const HOJE = '2026-11-10';
const AGORA = new Date('2026-11-10T16:00:00Z'); // 12h em Manaus

const notif = (o: Partial<NotificacaoParaRecado> = {}): NotificacaoParaRecado => ({
  id: N1, usuario_id: U, tipo: 'recado', titulo: 'Foco na campanha', corpo: 'Hoje é dia de positivar.', recado_do_dia: HOJE, expira_em: null, updated_at: '2026-11-10T12:00:00Z',
  autor_nome: 'Sueli Supervisora', autor_perfil: 'supervisor', ...o,
});
const ctx = { usuario_id: U, hoje: HOJE, agora: AGORA, padrao: null as string | null };

describe('RN-CORE-26: recado do dia no aparelho', () => {
  it('RN-CORE-26: recado marcado para hoje vira o recado do dia, com o autor', () => {
    const r = recadoDoDia([notif()], ctx);
    expect(r).toEqual({ origem: 'recado', texto: 'Hoje é dia de positivar.', titulo: 'Foco na campanha', autor_nome: 'Sueli Supervisora', autor_perfil: 'supervisor', notificacao_id: N1 });
  });
  it('RN-CORE-26: marcado ontem cai na frase padrão', () => {
    expect(recadoDoDia([notif({ recado_do_dia: '2026-11-09' })], ctx).origem).toBe('padrao');
    expect(recadoDoDia([], ctx)).toMatchObject({ origem: 'padrao', texto: RECADO_DO_DIA_PADRAO, titulo: null, notificacao_id: null });
  });
  it('RN-CORE-26: decisão do Alexandre (T-0073): recado enviado em outro dia (updated_at de 20 dias atrás) e remarcado para hoje aparece como o recado do dia', () => {
    const r = recadoDoDia([notif({ updated_at: '2026-10-21T12:00:00Z', recado_do_dia: HOJE })], ctx);
    expect(r).toMatchObject({ origem: 'recado', notificacao_id: N1 });
  });
  it('RN-CORE-26: recado removido (deleted_at) volta ao padrão', () => {
    expect(recadoDoDia([notif({ deleted_at: '2026-11-10T13:00:00Z' })], ctx).origem).toBe('padrao');
  });
  it('RN-CORE-26: tipo sistema, de outra pessoa ou sem marcação é ignorado', () => {
    expect(recadoDoDia([notif({ tipo: 'sistema' })], ctx).origem).toBe('padrao');
    expect(recadoDoDia([notif({ usuario_id: '0e700000-0000-4000-8000-0000000000ff' })], ctx).origem).toBe('padrao');
    expect(recadoDoDia([notif({ recado_do_dia: null })], ctx).origem).toBe('padrao');
  });
  it('RN-CORE-26: o padrão do tenant (inicio.recado_do_dia_padrao) vale; vazio cai no padrão do sistema', () => {
    expect(recadoDoDia([], { ...ctx, padrao: 'Vamos bater a meta!' }).texto).toBe('Vamos bater a meta!');
    expect(recadoDoDia([], { ...ctx, padrao: '   ' }).texto).toBe(RECADO_DO_DIA_PADRAO);
  });
  it('RN-CORE-26: recado expirado volta ao padrão', () => {
    expect(recadoDoDia([notif({ expira_em: '2026-11-10T15:00:00Z' })], ctx).origem).toBe('padrao');
    expect(recadoDoDia([notif({ expira_em: '2026-11-10T17:00:00Z' })], ctx).origem).toBe('recado');
  });
  it('RN-CORE-26: com mais de um marcado, vale o de updated_at mais novo', () => {
    const velho = notif({ id: N1, updated_at: '2026-11-10T10:00:00Z' });
    const novo = notif({ id: N2, titulo: 'Novo', updated_at: '2026-11-10T11:00:00Z' });
    expect(recadoDoDia([velho, novo], ctx).notificacao_id).toBe(N2);
  });
});

const ANA = '0e700000-0000-4000-8000-0000000000b1';
const BIA = '0e700000-0000-4000-8000-0000000000b2';
const CLI = (n: number) => `0e700000-0000-4000-8000-0000000000c${n}`;
const membros = [
  { usuario_id: ANA, nome: 'Ana', vendas_hoje_cents: 1000 },
  { usuario_id: BIA, nome: 'Bia', vendas_hoje_cents: null },
];
const parada = (usuario_id: string, n: number, data = HOJE): ParadaDoDia => ({ usuario_id, cliente_id: CLI(n), data });
const visita = (usuario_id: string, n: number, checkin: string, checkout: string | null, data_local = HOJE): VisitaDoDia => ({ usuario_id, cliente_id: CLI(n), data_local, checkin_em: checkin, checkout_em: checkout });
const agoraEm = (min: number) => new Date(new Date('2026-11-10T14:00:00Z').getTime() + min * 60_000);
const statusDe = (e: ReturnType<typeof equipeAgora>, id = ANA) => e.find((m) => m.usuario_id === id)!;
const base = { hoje: HOJE, parado_min: 60, membros: [membros[0]!] };

describe('RN-CORE-26: equipe agora (em_visita, em_rota, parado, sem_checkin, rota_concluida)', () => {
  const paradas = [parada(ANA, 1), parada(ANA, 2), parada(ANA, 3)];
  it('RN-CORE-26: check-in aberto = em_visita, com o cliente e desde o check-in', () => {
    const m = statusDe(equipeAgora({ ...base, agora: agoraEm(10), paradas, visitas: [visita(ANA, 1, '2026-11-10T13:30:00Z', null)] }));
    expect(m).toMatchObject({ status: 'em_visita', cliente_id: CLI(1), desde: '2026-11-10T13:30:00Z', paradas_hoje: 3, visitadas_hoje: 1, vendas_hoje_cents: 1000, minutos_sem_atividade: null });
  });
  it('RN-CORE-26: checkout há 59 min com paradas pendentes = em_rota', () => {
    const m = statusDe(equipeAgora({ ...base, agora: agoraEm(59), paradas, visitas: [visita(ANA, 1, '2026-11-10T13:00:00Z', '2026-11-10T14:00:00Z')] }));
    expect(m).toMatchObject({ status: 'em_rota', minutos_sem_atividade: 59, desde: '2026-11-10T14:00:00Z' });
  });
  it('RN-CORE-26: checkout há 60 min com paradas pendentes = parado', () => {
    const m = statusDe(equipeAgora({ ...base, agora: agoraEm(60), paradas, visitas: [visita(ANA, 1, '2026-11-10T13:00:00Z', '2026-11-10T14:00:00Z')] }));
    expect(m).toMatchObject({ status: 'parado', minutos_sem_atividade: 60 });
  });
  it('RN-CORE-26: parado_min vem do parâmetro inicio.parado_min', () => {
    const v = [visita(ANA, 1, '2026-11-10T13:00:00Z', '2026-11-10T14:00:00Z')];
    expect(statusDe(equipeAgora({ ...base, parado_min: 30, agora: agoraEm(30), paradas, visitas: v })).status).toBe('parado');
    expect(statusDe(equipeAgora({ ...base, parado_min: 90, agora: agoraEm(60), paradas, visitas: v })).status).toBe('em_rota');
  });
  it('RN-CORE-26: nenhuma visita hoje = sem_checkin', () => {
    expect(statusDe(equipeAgora({ ...base, agora: agoraEm(0), paradas, visitas: [] }))).toMatchObject({ status: 'sem_checkin', desde: null, cliente_id: null, minutos_sem_atividade: null, paradas_hoje: 3, visitadas_hoje: 0 });
  });
  it('RN-CORE-26: 3 de 3 paradas com check-in e nenhuma aberta = rota_concluida (também sem rota planejada, se já houve visita)', () => {
    const v = [1, 2, 3].map((n) => visita(ANA, n, '2026-11-10T13:00:00Z', '2026-11-10T13:30:00Z'));
    expect(statusDe(equipeAgora({ ...base, agora: agoraEm(300), paradas, visitas: v })).status).toBe('rota_concluida');
    expect(statusDe(equipeAgora({ ...base, agora: agoraEm(300), paradas: [], visitas: [v[0]!] })).status).toBe('rota_concluida');
  });
  it('RN-CORE-26: visita de ontem aberta não conta (a RN-CORE-11 a fecha na virada do dia); parada de ontem também não', () => {
    const m = statusDe(equipeAgora({ ...base, agora: agoraEm(0), paradas: [parada(ANA, 1, '2026-11-09')], visitas: [visita(ANA, 1, '2026-11-09T13:00:00Z', null, '2026-11-09')] }));
    expect(m).toMatchObject({ status: 'sem_checkin', paradas_hoje: 0 });
  });
  it('RN-CORE-26: ordem parado, sem_checkin, em_rota, em_visita, rota_concluida e, dentro do status, o nome', () => {
    const ids = ['d', 'e', 'f', 'g', 'h', 'i'].map((l, i) => ({ usuario_id: `0e700000-0000-4000-8000-0000000000d${i}`, nome: l === 'd' ? 'Zeca' : l === 'e' ? 'Caio' : l === 'f' ? 'Bia' : l === 'g' ? 'Ana' : l === 'h' ? 'Davi' : 'Eva' }));
    const [zeca, _caio, bia, ana, davi, eva] = ids as [typeof ids[0], typeof ids[0], typeof ids[0], typeof ids[0], typeof ids[0], typeof ids[0]];
    const todos = ids.map((m) => ({ ...m, vendas_hoje_cents: null }));
    const par = [...ids.map((m) => parada(m.usuario_id, 1)), ...ids.map((m) => parada(m.usuario_id, 2))];
    const out = '2026-11-10T14:00:00Z';
    const v = [
      visita(zeca.usuario_id, 1, '2026-11-10T13:00:00Z', out), // parado (agora = +90)
      visita(bia.usuario_id, 1, '2026-11-10T14:40:00Z', '2026-11-10T15:20:00Z'), // em_rota
      visita(ana.usuario_id, 1, '2026-11-10T15:00:00Z', null), // em_visita
      visita(davi.usuario_id, 1, '2026-11-10T13:00:00Z', out), // parado
      visita(eva.usuario_id, 1, '2026-11-10T13:00:00Z', '2026-11-10T13:10:00Z'), visita(eva.usuario_id, 2, '2026-11-10T13:20:00Z', '2026-11-10T13:30:00Z'), // concluída
    ];
    const r = equipeAgora({ hoje: HOJE, agora: agoraEm(90), parado_min: 60, membros: todos, paradas: par, visitas: v });
    expect(r.map((m) => `${m.status}:${m.nome}`)).toEqual(['parado:Davi', 'parado:Zeca', 'sem_checkin:Caio', 'em_rota:Bia', 'em_visita:Ana', 'rota_concluida:Eva']);
  });
});
