import { describe, expect, it } from 'vitest';
import { PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO, type ParametrosAlertasProdutividade } from '@macuxi/core/contracts';
import { TIPOS_ALERTA, TIPOS_ALERTA_PRODUTIVIDADE, TIPOS_REGRA_EQUIPE, type MembroEquipe } from '../contracts';
import { avaliarAlertas, reconciliarAlertas, REGRAS_PADRAO, resolverRegras, tiposAtivos, type AlertaExistente } from './alertas';
import { CLIENTE_A, CLIENTE_B, CLIENTE_C, checkin, checkout, ev, maisMin, u, VENDEDOR } from './fixtures';
import { aplicarEventos, estadoInicial, type EventoRecebido } from './projecao';
import { ajustarRegraAlerta } from './visao';

const montar = (eventos: EventoRecebido[]) => aplicarEventos(estadoInicial(), eventos).estado;
const DIA = '2026-10-30'; // sexta-feira, dia útil
const T0 = '2026-10-30T13:00:00Z'; // 09:00 em Manaus
const V1 = u(2101);
const MEMBROS: MembroEquipe[] = [{ id: VENDEDOR, nome: 'Vera', perfil: 'vendedor', superior_id: null, ativo: true }];
const rota = (clientes: string[]) => ev('core.rota.dia_planejado@1', '2026-10-30T10:00:00Z', { usuario_id: VENDEDOR, data: DIA, cliente_ids: clientes });
const TODOS = new Set(['core', 'vendedor', 'promotor']);
const PADRAO = PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO;
/** Por padrão o aparelho sincronizou às 23:59 UTC do dia (depois de qualquer início de parada); `contato: null` = nunca sincronizou. */
const SINCRONIZOU = '2026-10-30T23:59:00Z';
const avaliar = (eventos: EventoRecebido[], agora: string, o: { produtividade?: ParametrosAlertasProdutividade; membros?: MembroEquipe[]; contato?: string | null; parado_min?: number; almoco?: Record<string, { inicio_min: number; fim_min: number }> } = {}) =>
  avaliarAlertas({
    estado: montar(eventos),
    membros: o.membros ?? MEMBROS,
    agora,
    modulos: TODOS,
    regras: resolverRegras(),
    params: o.parado_min === undefined ? undefined : { parado_min: o.parado_min },
    produtividade: 'produtividade' in o ? o.produtividade : PADRAO,
    ultimo_contato_em: { [VENDEDOR]: 'contato' in o ? (o.contato ?? null) : SINCRONIZOU },
    almoco: o.almoco,
  });
const doTipo = (cs: ReturnType<typeof avaliar>, tipo: string) => cs.filter((c) => c.tipo === tipo);
const comRegra = <K extends keyof Omit<ParametrosAlertasProdutividade, 'teto_lembretes_dia'>>(k: K, parcial: Partial<ParametrosAlertasProdutividade[K]>): ParametrosAlertasProdutividade => ({
  ...PADRAO,
  [k]: { ...PADRAO[k], ...parcial },
});

const visita = [rota([CLIENTE_A, CLIENTE_B, CLIENTE_C]), checkin({ visita: V1, cliente: CLIENTE_A, em: T0 }), checkout({ visita: V1, cliente: CLIENTE_A, em: maisMin(T0, 30) })];
const CO = maisMin(T0, 30); // último checkout: 09:30 em Manaus

describe('RN-CORE-26, RN-CORE-44: o "Parado" do gestor não conta o horário de almoço', () => {
  const T1 = '2026-10-30T15:00:00Z'; // 11:00 em Manaus
  const CO1 = maisMin(T1, 30); // checkout 11:30
  const dia = [rota([CLIENTE_A, CLIENTE_B]), checkin({ visita: V1, cliente: CLIENTE_A, em: T1 }), checkout({ visita: V1, cliente: CLIENTE_A, em: CO1 })];
  const ALM = { [VENDEDOR]: { inicio_min: 720, fim_min: 780 } }; // 12:00 às 13:00 em Manaus
  it('RN-CORE-44: com almoço dentro da espera, o limite (60 + 30 min) só vale 1 h depois', () => {
    expect(doTipo(avaliar(dia, maisMin(CO1, 120), { almoco: ALM }), 'parado_entre_visitas')).toEqual([]); // 13:30: 120 min corridos, 60 sem almoço
    const [c] = doTipo(avaliar(dia, maisMin(CO1, 150), { almoco: ALM }), 'parado_entre_visitas'); // 14:00: 90 min sem almoço
    expect(c?.valor).toBe(90);
  });
  it('RN-CORE-26: almoço fora da espera (ou sem horário informado e fora de 12h-13h) não muda nada', () => {
    expect(doTipo(avaliar(dia, maisMin(CO1, 90), { almoco: { [VENDEDOR]: { inicio_min: 15 * 60, fim_min: 16 * 60 } } }), 'parado_entre_visitas')).toHaveLength(1);
    expect(doTipo(avaliar(dia, maisMin(CO1, 90), { almoco: ALM }), 'parado_entre_visitas')).toEqual([]);
  });
  it('RN-CORE-44: sem o horário da pessoa vale o padrão da empresa (12:00 às 13:00)', () => {
    expect(doTipo(avaliar(dia, maisMin(CO1, 120)), 'parado_entre_visitas')).toEqual([]);
    expect(doTipo(avaliar(dia, maisMin(CO1, 150)), 'parado_entre_visitas')).toHaveLength(1);
  });
  it('RN-CORE-26: checkout no meio do almoço conta só o que passou do fim do almoço', () => {
    const meio = [rota([CLIENTE_A, CLIENTE_B]), checkin({ visita: V1, cliente: CLIENTE_A, em: '2026-10-30T15:40:00Z' }), checkout({ visita: V1, cliente: CLIENTE_A, em: '2026-10-30T16:30:00Z' })]; // checkout 12:30
    expect(doTipo(avaliar(meio, '2026-10-30T18:00:00Z', { almoco: ALM }), 'parado_entre_visitas')).toEqual([]); // 14:00: 60 min sem almoço
    expect(doTipo(avaliar(meio, '2026-10-30T19:00:00Z', { almoco: ALM }), 'parado_entre_visitas')).toHaveLength(1); // 15:00: 150 min, 120 sem almoço
  });
});

describe('D4 / RN-CORE-26: alerta "Parado" ao gestor (parado_min + 30 min, um por pessoa, sem push)', () => {
  it('RN-CORE-26: abre quando passam parado_min (60) + 30 min do último checkout', () => {
    expect(doTipo(avaliar(visita, maisMin(CO, 89)), 'parado_entre_visitas')).toEqual([]);
    const [c] = doTipo(avaliar(visita, maisMin(CO, 90)), 'parado_entre_visitas');
    expect(c).toMatchObject({ chave: `produtividade:${VENDEDOR}`, alvo_tipo: 'usuario', alvo_id: VENDEDOR, responsavel_id: VENDEDOR, mensagem: 'Vera: último checkout às 09:30.', severidade: 'atencao' });
  });

  it('RN-CORE-26: o limite é o inicio.parado_min do tenant (um valor só), não um número à parte', () => {
    expect(doTipo(avaliar(visita, maisMin(CO, 70)), 'parado_entre_visitas')).toEqual([]);
    expect(doTipo(avaliar(visita, maisMin(CO, 70), { parado_min: 30 }), 'parado_entre_visitas')).toHaveLength(1);
  });

  it('ADR 0059 §5: só abre com o último contato do aparelho POSTERIOR ao último checkout (sem sinal não acusa)', () => {
    const agora = maisMin(CO, 120);
    expect(doTipo(avaliar(visita, agora, { contato: null }), 'parado_entre_visitas')).toEqual([]); // nunca sincronizou
    expect(doTipo(avaliar(visita, agora, { contato: maisMin(CO, -5) }), 'parado_entre_visitas')).toEqual([]); // último sinal antes do checkout
    expect(doTipo(avaliar(visita, agora, { contato: CO }), 'parado_entre_visitas')).toEqual([]); // igual não é posterior
    expect(doTipo(avaliar(visita, agora, { contato: maisMin(CO, 1) }), 'parado_entre_visitas')).toHaveLength(1);
  });

  it('RN-CORE-26: vale com ou sem rota: dia sem rota planejada e rota já toda visitada também abrem', () => {
    const semRota = [checkin({ visita: V1, cliente: CLIENTE_A, em: T0 }), checkout({ visita: V1, cliente: CLIENTE_A, em: CO })];
    expect(doTipo(avaliar(semRota, maisMin(CO, 89)), 'parado_entre_visitas')).toEqual([]);
    expect(doTipo(avaliar(semRota, maisMin(CO, 90)), 'parado_entre_visitas')).toHaveLength(1);
    const concluida = [rota([CLIENTE_A]), checkin({ visita: V1, cliente: CLIENTE_A, em: T0 }), checkout({ visita: V1, cliente: CLIENTE_A, em: CO })];
    expect(doTipo(avaliar(concluida, maisMin(CO, 90)), 'parado_entre_visitas')).toHaveLength(1);
  });

  it('não abre em visita aberta nem depois do expediente', () => {
    const aberta = [rota([CLIENTE_A, CLIENTE_B]), checkin({ visita: V1, cliente: CLIENTE_A, em: T0 })];
    expect(doTipo(avaliar(aberta, maisMin(T0, 200)), 'parado_entre_visitas')).toEqual([]);
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
    expect(c).toMatchObject({ chave: `produtividade:${VENDEDOR}`, alvo_tipo: 'usuario', responsavel_id: VENDEDOR, mensagem: 'Vera', severidade: 'atencao' });
  });

  it('usa o horário configurado e não abre com check-in, em fim de semana ou fora do expediente', () => {
    expect(doTipo(avaliar([], '2026-10-30T13:30:00Z', { produtividade: comRegra('sem_checkin_inicio', { ate_min: 540 }) }), 'sem_checkin_inicio')).toHaveLength(1);
    expect(doTipo(avaliar([checkin({ visita: V1, cliente: CLIENTE_A, em: T0 })], '2026-10-30T14:30:00Z'), 'sem_checkin_inicio')).toEqual([]);
    expect(doTipo(avaliar([], '2026-10-31T15:00:00Z'), 'sem_checkin_inicio')).toEqual([]); // sábado
    expect(doTipo(avaliar([], '2026-10-30T22:30:00Z'), 'sem_checkin_inicio')).toEqual([]); // 18:30
  });

  it('ADR 0059 §5: só abre com o último contato POSTERIOR ao horário "até" (quem trabalhou sem sinal não é acusado)', () => {
    const agora = '2026-10-30T15:00:00Z'; // 11:00 em Manaus; o "até" padrão é 10:00 (14:00Z)
    expect(doTipo(avaliar([], agora, { contato: null }), 'sem_checkin_inicio')).toEqual([]);
    expect(doTipo(avaliar([], agora, { contato: '2026-10-30T13:00:00Z' }), 'sem_checkin_inicio')).toEqual([]); // 09:00, antes do horário
    expect(doTipo(avaliar([], agora, { contato: '2026-10-30T14:00:00Z' }), 'sem_checkin_inicio')).toEqual([]);
    expect(doTipo(avaliar([], agora, { contato: '2026-10-30T14:01:00Z' }), 'sem_checkin_inicio')).toHaveLength(1);
  });

  it('RN-CORE-03/D4: com a regra ou o destino Gestor desligado, nada abre', () => {
    expect(doTipo(avaliar([], '2026-10-30T15:00:00Z', { produtividade: comRegra('sem_checkin_inicio', { gestor: false }) }), 'sem_checkin_inicio')).toEqual([]);
    expect(tiposAtivos(resolverRegras(), TODOS, comRegra('sem_checkin_inicio', { ativa: false })).has('sem_checkin_inicio')).toBe(false);
    expect(tiposAtivos(resolverRegras(), TODOS).has('sem_checkin_inicio')).toBe(false);
  });
});

describe('D4: um alerta de produtividade aberto por pessoa; encerra sozinho no próximo check-in', () => {
  const existente = (tipo: 'parado_entre_visitas' | 'sem_checkin_inicio'): AlertaExistente => ({ id: u(9000), chave: `produtividade:${VENDEDOR}`, tipo, status: 'aberto', valor: null, mensagem: 'x', severidade: 'atencao', aberto_em: '2026-10-30T14:00:00Z' });

  it('RN-VEN-42: o mais novo substitui o anterior: abre o Parado e encerra o Sem check-in da mesma pessoa (mesma chave)', () => {
    const agora = maisMin(CO, 120);
    const ops = reconciliarAlertas([existente('sem_checkin_inicio')], avaliar(visita, agora), { agora, tipos_ativos: tiposAtivos(resolverRegras(), TODOS, PADRAO) });
    expect(ops.abrir.map((c) => [c.chave, c.tipo])).toEqual([[`produtividade:${VENDEDOR}`, 'parado_entre_visitas']]);
    expect(ops.encerrar).toEqual([{ id: u(9000), motivo: 'condicao_normalizada', encerrado_em: agora }]);
    expect(ops.atualizar).toEqual([]);
  });

  it('RN-VEN-42: o novo substitui até o alerta dispensado, e o mesmo tipo só atualiza (não abre outro)', () => {
    const agora = maisMin(CO, 120);
    const ativos = tiposAtivos(resolverRegras(), TODOS, PADRAO);
    const dispensado = { ...existente('sem_checkin_inicio'), status: 'dispensado' as const };
    const ops = reconciliarAlertas([dispensado], avaliar(visita, agora), { agora, tipos_ativos: ativos });
    expect(ops.abrir).toHaveLength(1);
    expect(ops.encerrar).toHaveLength(1);
    const igual = reconciliarAlertas([{ ...existente('parado_entre_visitas'), valor: 1 }], avaliar(visita, agora), { agora, tipos_ativos: ativos });
    expect(igual.abrir).toEqual([]);
    expect(igual.encerrar).toEqual([]);
    expect(igual.atualizar).toHaveLength(1);
  });

  it('RN-VEN-42: com o tipo vivo desligado, encerra por regra inativa e abre o outro tipo que vale', () => {
    const agora = maisMin(CO, 120);
    const ativos = tiposAtivos(resolverRegras(), TODOS, comRegra('sem_checkin_inicio', { ativa: false }));
    const ops = reconciliarAlertas([existente('sem_checkin_inicio')], avaliar(visita, agora), { agora, tipos_ativos: ativos });
    expect(ops.encerrar).toEqual([{ id: u(9000), motivo: 'regra_inativa', encerrado_em: agora }]);
    expect(ops.abrir.map((c) => c.tipo)).toEqual(['parado_entre_visitas']);
  });

  it('encerra sozinho no próximo check-in e some quando a regra é desligada', () => {
    const agora = '2026-10-30T15:00:00Z';
    const comCheckin = [checkin({ visita: V1, cliente: CLIENTE_A, em: '2026-10-30T14:40:00Z' })];
    const ativos = tiposAtivos(resolverRegras(), TODOS, PADRAO);
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
    expect(REGRAS_PADRAO.parado_entre_visitas.tipo).toBe('parado_entre_visitas');
    const r = ajustarRegraAlerta({}, 'parado_entre_visitas', { ativa: false });
    expect(r).toEqual({ ok: false, erros: ['Este alerta liga e desliga em Parâmetros › Alertas › Produtividade do dia.'] });
    expect(ajustarRegraAlerta({}, 'sem_checkin_inicio', { ativa: false }).ok).toBe(false);
  });
});
