import { describe, expect, it } from 'vitest';
import type { ClienteSync, Inicio, MetaSync, NotificacaoSync, ParametroSync, RotaParadaSync, VisitaSync } from '../../contracts';
import { VisaoInicioSchema } from '../../contracts';
import { montarInicio, type LinhasInicio } from './inicio-local';

const FUSO = 'America/Manaus';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EU = id(1);
const OUTRO = id(2);
const base = { updated_at: '2026-11-10T10:00:00.000000Z', deleted_at: null, external_id: null };
// 10/11/2026 (terça) 09:00 em Manaus (UTC-4) = 13:00Z
const AGORA = new Date('2026-11-10T13:00:00Z');
const meta = (usuario: string, indicador: MetaSync['indicador'], valor: number, tipo?: MetaSync['tipo']): MetaSync => ({ ...base, id: id(100 + valor), usuario_id: usuario, periodo: '2026-11', indicador, valor, ...(tipo ? { tipo } : {}) });
const parada = (n: number, usuario: string, cliente: number, data: string, seq = n): RotaParadaSync => ({ ...base, id: id(200 + n), rota_id: id(300), usuario_id: usuario, data, cliente_id: id(cliente), sequencia: seq }) as RotaParadaSync;
const visita = (n: number, usuario: string, cliente: number, data: string, checkin: string, checkout: string | null = null): VisitaSync =>
  ({ ...base, id: id(400 + n), usuario_id: usuario, cliente_id: id(cliente), data_local: data, checkin_em: checkin, sem_gps: false, fora_do_raio: false, sugere_coordenada: false, extra: false, checkout_em: checkout }) as VisitaSync;
const cliente = (n: number, nome: string) => ({ ...base, id: id(n), razao_social: `${nome} Ltda`, nome_fantasia: nome }) as ClienteSync;
const notif = (n: number, o: Partial<NotificacaoSync> = {}): NotificacaoSync =>
  ({ ...base, id: id(500 + n), usuario_id: EU, tipo: 'recado', titulo: `T${n}`, corpo: `corpo ${n}`, origem_modulo: 'core', prioridade: 'normal', lida_em: null, ...o }) as NotificacaoSync;

const vazio: LinhasInicio = { metas: [], paradas: [], visitas: [], notificacoes: [], parametros: [], clientes: [] };
const copia = (dia: string, o: Partial<Inicio> = {}): Inicio => ({
  dia,
  periodo: dia.slice(0, 7),
  calculado_em: `${dia}T14:00:00.000Z`,
  escopo: 'proprio',
  usuarios: [{ usuario_id: EU, nome: 'Ana', perfil: 'vendedor', equipe_id: null, tipo_meta_venda: 'pedido', venda_cents: { ate_ontem: 1_200_000, hoje: 50_000 }, positivacao: { ate_ontem: 10, hoje: 1 } }],
  metas_do_dia: [],
  ...o,
});
const eu = { usuarioId: EU, perfil: 'vendedor', fuso: FUSO, agora: AGORA };
const venda = (v: MetaSync) => v;

describe('RN-CORE-26: montarInicio (Início offline com as mesmas funções puras da API)', () => {
  it('RN-CORE-26: cópia de hoje usa até ontem e hoje como vieram (caso 1 do desenho: R$ 1.000 por dia)', () => {
    const v = montarInicio({ ...vazio, metas: [venda(meta(EU, 'venda_cents', 3_000_000))] }, copia('2026-11-10', { usuarios: [{ ...copia('x').usuarios[0]!, venda_cents: { ate_ontem: 1_200_000, hoje: 0 } }] }), [], eu);
    const m = v.metas[0]!;
    expect(VisaoInicioSchema.safeParse(v).success).toBe(true);
    expect(m).toMatchObject({ indicador: 'venda_cents', situacao: 'a_cumprir', meta_dia: 100_000, dias_uteis_restantes: 18, realizado_hoje: 0 });
    expect(v.base).toEqual({ dia: '2026-11-10', calculado_em: '2026-11-10T14:00:00.000Z', defasado: false });
    expect(v.hoje).toBe('2026-11-10');
    expect(v.dia_util).toBe(true);
  });

  it('RN-CORE-26: virada do dia sem sinal — a cópia de ontem é recalculada: hoje vira até ontem, hoje zera e a base fica defasada', () => {
    // cópia de 09/11: até ontem 1.200.000, hoje 50.000 -> em 10/11 até ontem = 1.250.000, hoje = 0
    const v = montarInicio({ ...vazio, metas: [meta(EU, 'venda_cents', 3_000_000)] }, copia('2026-11-09'), [], eu);
    const m = v.metas[0]!;
    expect(m.realizado_ate_ontem).toBe(1_250_000);
    expect(m.realizado_hoje).toBe(0);
    expect(m.meta_dia).toBe(Math.ceil(1_750_000 / 18));
    expect(v.base).toEqual({ dia: '2026-11-09', calculado_em: '2026-11-09T14:00:00.000Z', defasado: true });
  });

  it('RN-CORE-26: positivação da cópia de ontem também vira "até ontem" (10 + 1 clientes)', () => {
    const v = montarInicio({ ...vazio, metas: [meta(EU, 'positivacao', 40)] }, copia('2026-11-09'), [], eu);
    expect(v.metas[0]).toMatchObject({ indicador: 'positivacao', realizado_ate_ontem: 11, realizado_hoje: 0 });
  });

  it('RN-CORE-26: sem cópia, vendas e positivação ficam sem realizado (somem da lista) e visitas continuam', () => {
    const l: LinhasInicio = {
      ...vazio,
      metas: [meta(EU, 'venda_cents', 3_000_000), meta(EU, 'positivacao', 40), meta(EU, 'visitas', 40)],
      paradas: [parada(1, EU, 11, '2026-11-10')],
      visitas: [visita(1, EU, 11, '2026-11-10', '2026-11-10T12:00:00Z', '2026-11-10T12:30:00Z')],
    };
    const v = montarInicio(l, null, [], eu);
    expect(v.metas.map((m) => m.indicador)).toEqual(['visitas']);
    expect(v.metas[0]).toMatchObject({ realizado_hoje: 1, realizado_ate_ontem: 0 });
    expect(v.base).toEqual({ dia: null, calculado_em: null, defasado: false });
  });

  it('RN-CORE-26: cópia de outro mês não vale para vendas', () => {
    const v = montarInicio({ ...vazio, metas: [meta(EU, 'venda_cents', 3_000_000)] }, copia('2026-10-31'), [], eu);
    expect(v.metas).toEqual([]);
    expect(v.base.defasado).toBe(false);
    expect(v.base.dia).toBeNull();
  });

  it('RN-CORE-26: dia não útil — domingo 15/11 fora do calendário: meta do dia nula e 13 dias restantes', () => {
    const domingo = new Date('2026-11-15T13:00:00Z');
    const v = montarInicio({ ...vazio, metas: [meta(EU, 'venda_cents', 3_000_000)] }, copia('2026-11-15'), [], { ...eu, agora: domingo });
    expect(v.dia_util).toBe(false);
    expect(v.dias_uteis_restantes).toBe(13);
    expect(v.metas[0]).toMatchObject({ situacao: 'dia_nao_util', meta_dia: null });
  });

  it('RN-CORE-26: calendário do tenant (metas.dias_uteis_semana) vem do pull parametro', () => {
    const p = { ...base, id: id(900), modulo: 'core', chave: 'metas.dias_uteis_semana', valor: [1, 2, 3, 4, 5] } as ParametroSync;
    const v = montarInicio({ ...vazio, parametros: [p] }, null, [], eu);
    expect(v.dias_uteis_restantes).toBe(15);
  });

  it('RN-CORE-26: o dia civil é o do fuso do tenant (00:30Z de 11/11 ainda é 10/11 em Manaus)', () => {
    const v = montarInicio(vazio, null, [], { ...eu, agora: new Date('2026-11-11T00:30:00Z') });
    expect(v.hoje).toBe('2026-11-10');
  });

  it('RN-PRO-01 / RN-CORE-26: promotor sem venda — sem meta de venda a visão não tem venda nem positivação, nem equipe, nem card do Gestor', () => {
    const c = copia('2026-11-10', { usuarios: [{ usuario_id: EU, nome: 'Paulo', perfil: 'promotor', equipe_id: null, tipo_meta_venda: 'pedido', venda_cents: null, positivacao: null }] });
    const l: LinhasInicio = { ...vazio, metas: [meta(EU, 'visitas', 40), meta(EU, 'cobertura_pct', 8500)], paradas: [parada(1, EU, 11, '2026-11-10')] };
    const v = montarInicio(l, c, [], { ...eu, perfil: 'promotor' });
    expect(v.metas.map((m) => m.indicador)).toEqual(['visitas', 'cobertura_pct']);
    expect(v.escopo).toBe('proprio');
    expect(v.equipe_agora).toBeNull();
    expect(v.rota).toMatchObject({ paradas_hoje: 1, visitadas_hoje: 0, restantes: 1 });
    expect(Object.keys(v)).not.toContain('pedidos_para_aprovar');
  });

  it('RN-CORE-26: decisão do Alexandre (T-0073): indicador sem fonte (venda_cents e positivacao nulos na cópia) não entra na visão — ausente, não zero', () => {
    const c = copia('2026-11-10', { usuarios: [{ usuario_id: EU, nome: 'Paulo', perfil: 'promotor', equipe_id: null, tipo_meta_venda: 'pedido', venda_cents: null, positivacao: null }] });
    const v = montarInicio({ ...vazio, metas: [meta(EU, 'venda_cents', 100_000), meta(EU, 'positivacao', 40), meta(EU, 'visitas', 40)] }, c, [], { ...eu, perfil: 'promotor' });
    expect(v.metas.map((m) => m.indicador)).toEqual(['visitas']);
  });

  it('RN-CORE-26: decisão do Alexandre (T-0073): vendedor desligado com venda do read-model e positivação nula mostra só a venda', () => {
    const c = copia('2026-11-10', { usuarios: [{ ...copia('x').usuarios[0]!, venda_cents: { ate_ontem: 1_200_000, hoje: 0 }, positivacao: null }] });
    const v = montarInicio({ ...vazio, metas: [meta(EU, 'venda_cents', 3_000_000), meta(EU, 'positivacao', 40)] }, c, [], eu);
    expect(v.metas.map((m) => m.indicador)).toEqual(['venda_cents']);
  });

  it('RN-CORE-26: decisão do Alexandre (T-0073): cobertura da equipe pondera pelas paradas planejadas de cada vendedor (2 paradas a 100% + 10 a 50% = 58,3%)', () => {
    const c = copia('2026-11-10', {
      escopo: 'equipe',
      usuarios: [
        { usuario_id: EU, nome: 'Ana', perfil: 'vendedor', equipe_id: null, tipo_meta_venda: 'pedido', venda_cents: null, positivacao: null },
        { usuario_id: OUTRO, nome: 'Bia', perfil: 'vendedor', equipe_id: null, tipo_meta_venda: 'pedido', venda_cents: null, positivacao: null },
      ],
    });
    const paradasEu = [1, 2].map((n) => parada(n, EU, 10 + n, '2026-11-03'));
    const paradasOutro = Array.from({ length: 10 }, (_, n) => parada(10 + n, OUTRO, 30 + n, '2026-11-03'));
    const visitasEu = [1, 2].map((n) => visita(n, EU, 10 + n, '2026-11-03', '2026-11-03T12:00:00Z', '2026-11-03T12:30:00Z'));
    const visitasOutro = Array.from({ length: 5 }, (_, n) => visita(10 + n, OUTRO, 30 + n, '2026-11-03', '2026-11-03T12:00:00Z', '2026-11-03T12:30:00Z'));
    const l: LinhasInicio = { ...vazio, metas: [meta(EU, 'cobertura_pct', 9000), meta(OUTRO, 'cobertura_pct', 9000)], paradas: [...paradasEu, ...paradasOutro], visitas: [...visitasEu, ...visitasOutro] };
    const v = montarInicio(l, c, [], { ...eu, usuarioId: id(9), perfil: 'supervisor' });
    expect(v.metas[0]).toMatchObject({ indicador: 'cobertura_pct', situacao: 'do_mes', realizado_ate_ontem: 5833 });
  });

  it('RN-CORE-26: recado do dia marcado para hoje aparece; marcado ontem cai na frase padrão do tenant', () => {
    const marcado = notif(1, { recado_do_dia: '2026-11-10', autor_nome: 'Sup', autor_perfil: 'supervisor' });
    expect(montarInicio({ ...vazio, notificacoes: [marcado] }, null, [], eu).recado).toMatchObject({ origem: 'recado', texto: 'corpo 1', autor_nome: 'Sup' });
    const ontem = notif(1, { recado_do_dia: '2026-11-09' });
    const p = { ...base, id: id(901), modulo: 'core', chave: 'inicio.recado_do_dia_padrao', valor: 'Vamos vender!' } as ParametroSync;
    expect(montarInicio({ ...vazio, notificacoes: [ontem], parametros: [p] }, null, [], eu).recado).toMatchObject({ origem: 'padrao', texto: 'Vamos vender!' });
    expect(montarInicio(vazio, null, [], eu).recado).toMatchObject({ origem: 'padrao', texto: 'Bom trabalho hoje!' });
  });

  it('RF-CORE-09: notificações — até 3 últimas e contador de não lidas, com a leitura da fila aplicada', () => {
    const ns = [1, 2, 3, 4].map((n) => notif(n, { tipo: 'sistema', updated_at: `2026-11-10T1${n}:00:00.000000Z` }));
    const fila = [{ entidade: 'notificacao_leitura', payload: { notificacao_id: ns[3]!.id, lida_em: '2026-11-10T12:50:00Z' } }];
    const v = montarInicio({ ...vazio, notificacoes: ns }, null, fila as never, eu);
    expect(v.notificacoes.nao_lidas).toBe(3);
    expect(v.notificacoes.ultimas).toHaveLength(3);
    expect(v.notificacoes.ultimas.every((n) => !n.lida)).toBe(true);
  });

  it('RN-CORE-13: rota do vendedor — próxima parada, visita aberta e restantes (sem GPS)', () => {
    const l: LinhasInicio = {
      ...vazio,
      clientes: [cliente(11, 'Mercado A'), cliente(12, 'Padaria B'), cliente(13, 'Loja C')],
      paradas: [parada(1, EU, 11, '2026-11-10', 1), parada(2, EU, 12, '2026-11-10', 2), parada(3, EU, 13, '2026-11-10', 3)],
      visitas: [visita(1, EU, 11, '2026-11-10', '2026-11-10T12:00:00Z', '2026-11-10T12:30:00Z'), visita(2, EU, 12, '2026-11-10', '2026-11-10T12:40:00Z')],
    };
    const v = montarInicio(l, null, [], eu);
    expect(v.rota).toMatchObject({ paradas_hoje: 3, visitadas_hoje: 2, restantes: 1, proxima: { cliente_id: id(13), nome: 'Loja C' }, visita_aberta: { visita_id: id(402), cliente_id: id(12), nome: 'Padaria B' } });
  });

  it('RN-CORE-04 / RN-CORE-26: supervisor — escopo equipe soma as metas do dia de cada pessoa e lista a equipe agora; sem rota própria', () => {
    const c = copia('2026-11-10', {
      escopo: 'equipe',
      usuarios: [
        { usuario_id: EU, nome: 'Ana', perfil: 'vendedor', equipe_id: null, tipo_meta_venda: 'pedido', venda_cents: { ate_ontem: 1_200_000, hoje: 50_000 }, positivacao: null },
        { usuario_id: OUTRO, nome: 'Bia', perfil: 'vendedor', equipe_id: null, tipo_meta_venda: 'pedido', venda_cents: { ate_ontem: 2_000_000, hoje: 0 }, positivacao: null },
      ],
    });
    const l: LinhasInicio = {
      ...vazio,
      metas: [meta(EU, 'venda_cents', 3_000_000), meta(OUTRO, 'venda_cents', 1_800_000)],
      paradas: [parada(1, EU, 11, '2026-11-10')],
    };
    const v = montarInicio(l, c, [], { ...eu, usuarioId: id(9), perfil: 'supervisor' });
    expect(v.escopo).toBe('equipe');
    expect(v.rota).toBeNull();
    expect(v.metas).toHaveLength(1);
    expect(v.metas[0]).toMatchObject({ meta_dia: 100_000, realizado_hoje: 50_000, membros: 2, membros_mes_batido: 1, situacao: 'a_cumprir' });
    expect(v.equipe_agora?.map((m) => [m.nome, m.status, m.vendas_hoje_cents])).toEqual([
      ['Ana', 'sem_checkin', 50_000],
      ['Bia', 'sem_checkin', 0],
    ]);
  });

  it('RN-CORE-26: visão sempre cumpre VisaoInicioSchema, até sem nada', () => {
    expect(VisaoInicioSchema.safeParse(montarInicio(vazio, null, [], eu)).success).toBe(true);
  });
});

describe('RN-CORE-26 / RN-CORE-23: Início pela referência aprovada (T-0076)', () => {
  it('RN-CORE-26: boas-vindas e visitas hoje/feitas vêm da rota do aparelho; saudação no fuso do tenant', () => {
    const l: LinhasInicio = { ...vazio, paradas: [parada(1, EU, 11, '2026-11-10'), parada(2, EU, 12, '2026-11-10')], visitas: [visita(1, EU, 11, '2026-11-10', '2026-11-10T12:00:00Z', '2026-11-10T12:30:00Z')] };
    const v = montarInicio(l, null, [], eu);
    expect(v.saudacao).toBe('Bom dia'); // 09h em Manaus
    expect(v.rota).toMatchObject({ paradas_hoje: 2, visitadas_hoje: 1 });
    expect(VisaoInicioSchema.safeParse(v).success).toBe(true);
  });
  it('RN-CORE-26: meta de hoje com faltam hoje e % do mês (caso do desenho: meta 3.200 por dia)', () => {
    const v = montarInicio({ ...vazio, metas: [meta(EU, 'venda_cents', 3_000_000)] }, copia('2026-11-10'), [], eu);
    expect(v.meta_hoje).toMatchObject({ indicador: 'venda_cents', realizado_hoje: 50_000, meta_dia: 100_000, faltam_hoje: 50_000, mes_pct: 4_167 });
    expect(v.sem_realizado).toEqual([]);
  });
  it('RN-CORE-26: meta de venda sem cópia = sem_realizado (não "sem meta") e o cartão não cai em outro indicador', () => {
    const v = montarInicio({ ...vazio, metas: [meta(EU, 'venda_cents', 3_000_000), meta(EU, 'visitas', 40)] }, null, [], eu);
    expect(v.sem_realizado).toContain('venda_cents');
    expect(v.meta_hoje).toBeNull();
  });
  it('RN-PRO-01: promotor sem meta de venda mostra a primeira meta que tem', () => {
    const v = montarInicio({ ...vazio, metas: [meta(EU, 'visitas', 40)] }, null, [], { ...eu, perfil: 'promotor' });
    expect(v.meta_hoje?.indicador).toBe('visitas');
    expect(v.sem_realizado).toEqual([]);
  });
  it('RF-CORE-09: recados de hoje: o do dia primeiro e destacado, "N novos" e no máximo 3', () => {
    const l: LinhasInicio = { ...vazio, notificacoes: [notif(1, { tipo: 'sistema', updated_at: '2026-11-10T12:00:00Z' }), notif(2, { tipo: 'sistema', updated_at: '2026-11-10T11:00:00Z' }), notif(3, { tipo: 'sistema', updated_at: '2026-11-10T10:00:00Z' }), notif(4, { recado_do_dia: '2026-11-10', updated_at: '2026-11-09T10:00:00Z' })] };
    const v = montarInicio(l, null, [], eu);
    expect(v.recados_hoje?.itens).toHaveLength(3);
    expect(v.recados_hoje?.itens[0]).toMatchObject({ id: id(504), destaque: true });
    expect(v.recados_hoje?.novos).toBe(4);
  });
  it('RN-CORE-26: equipe_nome da cópia e cliente em visita do membro (Gestão)', () => {
    const c = copia('2026-11-10', {
      escopo: 'equipe',
      equipe_nome: 'Equipe Manaus',
      usuarios: [{ ...copia('x').usuarios[0]!, usuario_id: OUTRO, nome: 'Bia' }],
    });
    const l: LinhasInicio = { ...vazio, clientes: [cliente(11, 'Atacado Boto Rosa')], visitas: [visita(1, OUTRO, 11, '2026-11-10', '2026-11-10T12:50:00Z')] };
    const v = montarInicio(l, c, [], { ...eu, usuarioId: id(9), perfil: 'supervisor' });
    expect(v.equipe_nome).toBe('Equipe Manaus');
    expect(v.equipe_agora?.[0]).toMatchObject({ status: 'em_visita', cliente_nome: 'Atacado Boto Rosa' });
  });
});
