import { describe, expect, it } from 'vitest';
import { TIPOS_ALERTA, TIPOS_ALERTA_PRODUTIVIDADE, type MembroEquipe } from '../contracts';
import { avaliarAlertas, reconciliarAlertas, REGRAS_PADRAO, resolverRegras, tiposAtivos, type AlertaExistente } from './alertas';
import { TIPOS_REGRA_EQUIPE } from './campos-regra';
import { CLIENTE_A, CLIENTE_B, CLIENTE_C, checkin, checkout, ev, maisMin, u, VENDEDOR } from './fixtures';
import { PARAMETROS_PRODUTIVIDADE_PADRAO, type ParametrosAlertasProdutividade } from './produtividade-do-dia';
import { aplicarEventos, estadoInicial, type EventoRecebido } from './projecao';
import { ajustarRegraAlerta } from './visao';

const montar = (eventos: EventoRecebido[]) => aplicarEventos(estadoInicial(), eventos).estado;
const DIA = '2026-10-30'; // sexta-feira, dia útil
const T0 = '2026-10-30T13:00:00Z'; // 09:00 em Manaus
const V1 = u(2101);
const MEMBROS: MembroEquipe[] = [{ id: VENDEDOR, nome: 'Vera', perfil: 'vendedor', superior_id: null, ativo: true }];
const rota = (clientes: string[]) => ev('core.rota.dia_planejado@1', '2026-10-30T10:00:00Z', { usuario_id: VENDEDOR, data: DIA, cliente_ids: clientes });
const TODOS = new Set(['core', 'vendedor', 'promotor']);
const avaliar = (eventos: EventoRecebido[], agora: string, o: { produtividade?: ParametrosAlertasProdutividade; membros?: MembroEquipe[] } = {}) =>
  avaliarAlertas({ estado: montar(eventos), membros: o.membros ?? MEMBROS, agora, modulos: TODOS, regras: resolverRegras(), produtividade: 'produtividade' in o ? o.produtividade : PARAMETROS_PRODUTIVIDADE_PADRAO });
const doTipo = (cs: ReturnType<typeof avaliar>, tipo: string) => cs.filter((c) => c.tipo === tipo);
const comRegra = <K extends keyof ParametrosAlertasProdutividade['regras']>(k: K, parcial: Partial<ParametrosAlertasProdutividade['regras'][K]>): ParametrosAlertasProdutividade => ({
  ...PARAMETROS_PRODUTIVIDADE_PADRAO,
  regras: { ...PARAMETROS_PRODUTIVIDADE_PADRAO.regras, [k]: { ...PARAMETROS_PRODUTIVIDADE_PADRAO.regras[k], ...parcial } },
});

const visita = [rota([CLIENTE_A, CLIENTE_B, CLIENTE_C]), checkin({ visita: V1, cliente: CLIENTE_A, em: T0 }), checkout({ visita: V1, cliente: CLIENTE_A, em: maisMin(T0, 30) })];
const CO = maisMin(T0, 30); // último checkout: 09:30 em Manaus

describe('D4 / RN-CORE-26: alerta "Parado" ao gestor (parado_min + 30 min, um por pessoa, sem push)', () => {
  it('RN-CORE-26: abre quando passam parado_min (60) + 30 min do último checkout, com paradas pendentes', () => {
    expect(doTipo(avaliar(visita, maisMin(CO, 89)), 'parado_entre_visitas')).toEqual([]);
    const [c] = doTipo(avaliar(visita, maisMin(CO, 90)), 'parado_entre_visitas');
    expect(c).toMatchObject({ chave: `parado_entre_visitas:${VENDEDOR}`, alvo_tipo: 'usuario', alvo_id: VENDEDOR, responsavel_id: VENDEDOR, mensagem: 'Vera: último checkout às 09:30.', severidade: 'atencao' });
  });

  it('RN-CORE-26: o limite é o inicio.parado_min do tenant (um valor só), não um número à parte', () => {
    expect(doTipo(avaliar(visita, maisMin(CO, 70), { produtividade: PARAMETROS_PRODUTIVIDADE_PADRAO }), 'parado_entre_visitas')).toEqual([]);
    const cs = avaliarAlertas({ estado: montar(visita), membros: MEMBROS, agora: maisMin(CO, 70), modulos: TODOS, regras: resolverRegras(), produtividade: PARAMETROS_PRODUTIVIDADE_PADRAO, params: { parado_min: 30 } });
    expect(doTipo(cs, 'parado_entre_visitas')).toHaveLength(1);
  });

  it('não abre em visita aberta, sem paradas pendentes, ou depois do expediente', () => {
    const aberta = [rota([CLIENTE_A, CLIENTE_B]), checkin({ visita: V1, cliente: CLIENTE_A, em: T0 })];
    expect(doTipo(avaliar(aberta, maisMin(T0, 200)), 'parado_entre_visitas')).toEqual([]);
    const concluida = [rota([CLIENTE_A]), checkin({ visita: V1, cliente: CLIENTE_A, em: T0 }), checkout({ visita: V1, cliente: CLIENTE_A, em: CO })];
    expect(doTipo(avaliar(concluida, maisMin(CO, 120)), 'parado_entre_visitas')).toEqual([]);
    expect(doTipo(avaliar(visita, '2026-10-30T22:30:00Z'), 'parado_entre_visitas')).toEqual([]); // 18:30 em Manaus
  });

  it('RN-CORE-03/D4: regra desligada, destino Gestor desligado ou parâmetro ausente não geram alerta', () => {
    const agora = maisMin(CO, 120);
    expect(doTipo(avaliar(visita, agora, { produtividade: comRegra('parado_entre_visitas', { ativa: false }) }), 'parado_entre_visitas')).toEqual([]);
    expect(doTipo(avaliar(visita, agora, { produtividade: comRegra('parado_entre_visitas', { gestor: false }) }), 'parado_entre_visitas')).toEqual([]);
    expect(doTipo(avaliar(visita, agora, { produtividade: undefined }), 'parado_entre_visitas')).toEqual([]);
  });

  it('não alerta usuário inativo nem quem não é de campo', () => {
    const agora = maisMin(CO, 120);
    expect(avaliar(visita, agora, { membros: [{ ...MEMBROS[0]!, ativo: false }] })).toEqual([]);
    expect(avaliar(visita, agora, { membros: [{ ...MEMBROS[0]!, perfil: 'supervisor' }] })).toEqual([]);
  });
});

describe('D4: alerta "Sem check-in" no início do dia (a mensagem é só o nome)', () => {
  it('abre às 10:00 locais sem nenhum check-in no dia útil; antes disso não', () => {
    expect(doTipo(avaliar([], '2026-10-30T13:59:00Z'), 'sem_checkin_inicio')).toEqual([]); // 09:59
    const [c] = doTipo(avaliar([], '2026-10-30T14:00:00Z'), 'sem_checkin_inicio'); // 10:00
    expect(c).toMatchObject({ chave: `sem_checkin_inicio:${VENDEDOR}`, alvo_tipo: 'usuario', responsavel_id: VENDEDOR, mensagem: 'Vera', severidade: 'atencao' });
  });

  it('usa o horário configurado e não abre com check-in, em fim de semana ou fora do expediente', () => {
    expect(doTipo(avaliar([], '2026-10-30T13:30:00Z', { produtividade: comRegra('sem_checkin_inicio', { ate: '09:00' }) }), 'sem_checkin_inicio')).toHaveLength(1);
    expect(doTipo(avaliar([checkin({ visita: V1, cliente: CLIENTE_A, em: T0 })], '2026-10-30T14:30:00Z'), 'sem_checkin_inicio')).toEqual([]);
    expect(doTipo(avaliar([], '2026-10-31T15:00:00Z'), 'sem_checkin_inicio')).toEqual([]); // sábado
    expect(doTipo(avaliar([], '2026-10-30T22:30:00Z'), 'sem_checkin_inicio')).toEqual([]); // 18:30
  });

  it('RN-CORE-03/D4: com a regra ou o destino Gestor desligado, nada abre', () => {
    expect(doTipo(avaliar([], '2026-10-30T15:00:00Z', { produtividade: comRegra('sem_checkin_inicio', { gestor: false }) }), 'sem_checkin_inicio')).toEqual([]);
    expect(tiposAtivos(resolverRegras(), TODOS, comRegra('sem_checkin_inicio', { ativa: false })).has('sem_checkin_inicio')).toBe(false);
    expect(tiposAtivos(resolverRegras(), TODOS).has('sem_checkin_inicio')).toBe(false);
  });
});

describe('D4: um alerta de produtividade aberto por pessoa; encerra sozinho no próximo check-in', () => {
  const existente = (tipo: 'parado_entre_visitas' | 'sem_checkin_inicio'): AlertaExistente => ({ id: u(9000), chave: `${tipo}:${VENDEDOR}`, tipo, status: 'aberto', valor: null, mensagem: 'x', severidade: 'atencao', aberto_em: '2026-10-30T14:00:00Z' });

  it('o mais novo substitui o anterior: abre o Parado e encerra o Sem check-in da mesma pessoa', () => {
    const agora = maisMin(CO, 120);
    const ops = reconciliarAlertas([existente('sem_checkin_inicio')], avaliar(visita, agora), { agora, tipos_ativos: tiposAtivos(resolverRegras(), TODOS, PARAMETROS_PRODUTIVIDADE_PADRAO) });
    expect(ops.abrir.map((c) => c.chave)).toEqual([`parado_entre_visitas:${VENDEDOR}`]);
    expect(ops.encerrar).toEqual([{ id: u(9000), motivo: 'condicao_normalizada', encerrado_em: agora }]);
  });

  it('encerra sozinho no próximo check-in e some quando a regra é desligada', () => {
    const agora = '2026-10-30T15:00:00Z';
    const comCheckin = [checkin({ visita: V1, cliente: CLIENTE_A, em: '2026-10-30T14:40:00Z' })];
    const ativos = tiposAtivos(resolverRegras(), TODOS, PARAMETROS_PRODUTIVIDADE_PADRAO);
    expect(reconciliarAlertas([existente('sem_checkin_inicio')], avaliar(comCheckin, agora), { agora, tipos_ativos: ativos }).encerrar).toEqual([{ id: u(9000), motivo: 'condicao_normalizada', encerrado_em: agora }]);
    const desligados = tiposAtivos(resolverRegras(), TODOS, comRegra('sem_checkin_inicio', { ativa: false }));
    expect(reconciliarAlertas([existente('sem_checkin_inicio')], [], { agora, tipos_ativos: desligados }).encerrar[0]).toMatchObject({ motivo: 'regra_inativa' });
  });

  it('nunca há dois alertas de produtividade para a mesma pessoa numa avaliação', () => {
    const cs = avaliar(visita, maisMin(CO, 120));
    expect(cs.filter((c) => (TIPOS_ALERTA_PRODUTIVIDADE as readonly string[]).includes(c.tipo)).map((c) => c.alvo_id)).toEqual([VENDEDOR]);
  });
});

describe('D4 / RN-VEN-42: os tipos de produtividade não têm regra própria na lista de regras da equipe', () => {
  it('os 8 tipos existem; a lista de regras da equipe tem só os 6 de sempre e a regra padrão dos novos não é ajustável aqui', () => {
    expect(TIPOS_ALERTA).toHaveLength(8);
    expect([...TIPOS_REGRA_EQUIPE]).toEqual(TIPOS_ALERTA.filter((t) => !(TIPOS_ALERTA_PRODUTIVIDADE as readonly string[]).includes(t)));
    expect(REGRAS_PADRAO.parado_entre_visitas.tipo).toBe('parado_entre_visitas');
    const r = ajustarRegraAlerta({}, 'parado_entre_visitas', { ativa: false });
    expect(r).toEqual({ ok: false, erros: ['Este alerta liga e desliga em Parâmetros › Alertas › Produtividade do dia.'] });
  });
});
