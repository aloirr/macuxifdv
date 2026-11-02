import { describe, expect, it } from 'vitest';
import { Alerta, FichaMembro, VisaoEquipe, type MembroEquipe } from '../contracts';
import { criarRelogio } from '@macuxi/comum/relogio';
import { CLIENTE_A, checkin, GERENTE, pedidoCriado, PROMOTOR, statusAlterado, SUPERVISOR, u, VENDEDOR, VENDEDOR_2 } from './fixtures';
import { aplicarEventos, estadoInicial } from './projecao';
import {
  ajustarRegraAlerta,
  alertasDoEscopo,
  dataDaConsulta,
  dispensarAlerta,
  escopoDosVisiveis,
  fichaDoMembro,
  membrosDoCadastro,
  reconciliarParaViewer,
  usuariosDaProjecao,
  visaoDaEquipe,
} from './visao';

const relogio = criarRelogio({ agora: '2026-11-03T15:00:00Z' }); // 11:00 de 03/11 em Manaus
const AGORA = relogio.iso();
const HOJE = relogio.hoje();
const TODOS = new Set(['core', 'vendedor', 'promotor']);
const SUP_2 = u(301);
const VEND_3 = u(102);

/** gerente → supervisor → (vendedor, vendedor 2, promotor); gerente → supervisor 2 → vendedor 3 */
const MEMBROS: MembroEquipe[] = [
  { id: GERENTE, nome: 'Gilda', perfil: 'gerente', superior_id: null, ativo: true },
  { id: SUPERVISOR, nome: 'Sara', perfil: 'supervisor', superior_id: GERENTE, ativo: true },
  { id: SUP_2, nome: 'Silas', perfil: 'supervisor', superior_id: GERENTE, ativo: true },
  { id: VENDEDOR, nome: 'Vera', perfil: 'vendedor', superior_id: SUPERVISOR, ativo: true },
  { id: VENDEDOR_2, nome: 'Vitor', perfil: 'vendedor', superior_id: SUPERVISOR, ativo: true },
  { id: PROMOTOR, nome: 'Paula', perfil: 'promotor', superior_id: SUPERVISOR, ativo: true },
  { id: VEND_3, nome: 'Valter', perfil: 'vendedor', superior_id: SUP_2, ativo: true },
];

const estado = aplicarEventos(estadoInicial(), [
  checkin({ usuario: VENDEDOR, cliente: CLIENTE_A, em: relogio.instante({ hora: '09:00' }).toISOString() }),
  pedidoCriado({ pedido: u(900), vendedor: VENDEDOR, cliente: CLIENTE_A, total: 50_000, em: relogio.instante({ hora: '09:30' }).toISOString() }),
  statusAlterado({ pedido: u(900), vendedor: VENDEDOR, para: 'aprovado', em: relogio.instante({ hora: '09:31' }).toISOString() }),
  pedidoCriado({ pedido: u(901), vendedor: VEND_3, cliente: u(504), total: 20_000, em: relogio.instante({ hora: '10:00' }).toISOString() }),
  statusAlterado({ pedido: u(901), vendedor: VEND_3, para: 'aprovado', em: relogio.instante({ hora: '10:01' }).toISOString() }),
]).estado;

describe('escopo pela plataforma (RN-CORE-04)', () => {
  it('RN-CORE-04: supervisor e gerente veem os usuários visíveis da plataforma, sem si mesmos', () => {
    const e = escopoDosVisiveis({ id: SUPERVISOR, perfil: 'supervisor' }, new Set([SUPERVISOR, VENDEDOR, PROMOTOR]));
    expect(e).toEqual({ tipo: 'equipe', ids: new Set([VENDEDOR, PROMOTOR]) });
  });

  it('RN-CORE-04 / RN-GES-07: analista e admin veem o tenant em modo leitura', () => {
    expect(escopoDosVisiveis({ id: u(1), perfil: 'analista' }, 'tenant')).toEqual({ tipo: 'tenant' });
    expect(escopoDosVisiveis({ id: u(1), perfil: 'admin' }, new Set([u(1)]))).toEqual({ tipo: 'tenant' });
  });

  it('RN-CORE-04: falha fechada — supervisor com "tenant" (dado incoerente), vendedor, promotor e assistente não têm equipe', () => {
    expect(escopoDosVisiveis({ id: SUPERVISOR, perfil: 'supervisor' }, 'tenant')).toEqual({ tipo: 'nenhum' });
    for (const perfil of ['vendedor', 'promotor', 'assistente'] as const) expect(escopoDosVisiveis({ id: VENDEDOR, perfil }, 'tenant')).toEqual({ tipo: 'nenhum' });
  });

  it('RN-CORE-04: o cadastro resumido vira equipe pendurada em quem consulta; perfil desconhecido fica de fora', () => {
    const m = membrosDoCadastro({ id: SUPERVISOR, perfil: 'supervisor', nome: 'Sara' }, [
      { id: VENDEDOR, nome: 'Vera', perfil: 'vendedor' },
      { id: PROMOTOR, nome: 'Paula', perfil: 'promotor' },
      { id: u(77), nome: 'X', perfil: 'robo' },
    ]);
    expect(m).toEqual([
      { id: SUPERVISOR, nome: 'Sara', perfil: 'supervisor', superior_id: null, ativo: true },
      { id: VENDEDOR, nome: 'Vera', perfil: 'vendedor', superior_id: SUPERVISOR, ativo: true },
      { id: PROMOTOR, nome: 'Paula', perfil: 'promotor', superior_id: SUPERVISOR, ativo: true },
    ]);
  });

  it('RN-GES-07: na leitura do tenant os usuários vêm dos fatos da projeção (pedido, visita), sem repetir', () => {
    expect(usuariosDaProjecao(estado)).toEqual([VENDEDOR, VEND_3].sort());
    expect(usuariosDaProjecao(estadoInicial())).toEqual([]);
  });

  it('a data da consulta é o dia civil no fuso do tenant; data informada vale como está', () => {
    expect(dataDaConsulta(undefined, criarRelogio({ agora: '2026-11-04T03:59:00Z' }).iso(), 'America/Manaus')).toBe('2026-11-03');
    expect(dataDaConsulta('2026-10-30', AGORA, 'America/Manaus')).toBe('2026-10-30');
  });
});

describe('visão da equipe (RF-GES-01/02)', () => {
  const ctx = { modulos: TODOS, agora: AGORA, data: HOJE };

  it('RN-CORE-04: supervisor vê só a própria equipe, com painel do dia de cada pessoa de campo, em ordem de nome', () => {
    const viewer = { id: SUPERVISOR, perfil: 'supervisor' as const };
    const v = visaoDaEquipe({ estado, membros: MEMBROS, viewer, escopo: escopoDosVisiveis(viewer, new Set([SUPERVISOR, VENDEDOR, VENDEDOR_2, PROMOTOR])), ...ctx });
    expect(VisaoEquipe.parse(v)).toEqual(v);
    expect(v.membros.map((x) => x.membro.nome)).toEqual(['Paula', 'Vera', 'Vitor']);
    expect(v.resumo).toMatchObject({ gestor_id: SUPERVISOR, membros: 3, vendas_cents: 50_000, pedidos: 1 });
    expect(v.membros.find((x) => x.membro.id === VENDEDOR)?.painel.visitas.realizadas).toBe(1);
    expect(v.membros.some((x) => x.membro.id === VEND_3)).toBe(false);
    expect(v.equipes).toEqual([]);
  });

  it('RN-CORE-04: gerente vê as equipes abaixo (um resumo por supervisor) e o total', () => {
    const viewer = { id: GERENTE, perfil: 'gerente' as const };
    const v = visaoDaEquipe({ estado, membros: MEMBROS, viewer, escopo: escopoDosVisiveis(viewer, new Set(MEMBROS.map((m) => m.id))), ...ctx });
    expect(v.resumo).toMatchObject({ gestor_id: GERENTE, membros: 4, vendas_cents: 70_000 });
    expect(v.equipes.map((e) => [e.gestor_id, e.vendas_cents])).toEqual([
      [SUPERVISOR, 50_000],
      [SUP_2, 20_000],
    ]);
    expect(v.gestores.map((m) => m.nome)).toEqual(['Sara', 'Silas']);
  });

  it('RN-GES-07: analista vê o tenant inteiro (equipe achatada sob ele) sem quebrar a árvore', () => {
    const viewer = { id: u(9), perfil: 'analista' as const };
    const v = visaoDaEquipe({ estado, membros: MEMBROS, viewer, escopo: { tipo: 'tenant' }, ...ctx });
    expect(v.resumo).toMatchObject({ gestor_id: viewer.id, membros: 4, vendas_cents: 70_000 });
    expect(v.membros).toHaveLength(4);
  });

  it('RN-CORE-04: quem está fora do escopo nunca aparece, mesmo que o cadastro o traga', () => {
    const viewer = { id: SUPERVISOR, perfil: 'supervisor' as const };
    const v = visaoDaEquipe({ estado, membros: MEMBROS, viewer, escopo: { tipo: 'equipe', ids: new Set([VENDEDOR]) }, ...ctx });
    expect(v.membros.map((x) => x.membro.id)).toEqual([VENDEDOR]);
    expect(v.resumo.membros).toBe(1);
  });

  it('RN-CORE-03: sem o Vendedor ativo as seções de vendas ficam nulas e a visão continua válida', () => {
    const viewer = { id: SUPERVISOR, perfil: 'supervisor' as const };
    const v = visaoDaEquipe({ estado, membros: MEMBROS, viewer, escopo: escopoDosVisiveis(viewer, new Set(MEMBROS.map((m) => m.id))), ...ctx, modulos: new Set(['core']) });
    expect(VisaoEquipe.parse(v)).toEqual(v);
    expect(v.resumo.vendas_cents).toBeNull();
    expect(v.membros.every((x) => x.painel.vendas === null)).toBe(true);
  });

  it('escopo nenhum ⇒ visão vazia, sem erro', () => {
    const v = visaoDaEquipe({ estado, membros: MEMBROS, viewer: { id: VENDEDOR, perfil: 'vendedor' }, escopo: { tipo: 'nenhum' }, ...ctx });
    expect(v.membros).toEqual([]);
    expect(v.resumo.membros).toBe(0);
  });
});

describe('ficha do vendedor/promotor (RF-GES-02/05/10)', () => {
  const sup = { id: SUPERVISOR, perfil: 'supervisor' as const };
  const escopo = escopoDosVisiveis(sup, new Set([SUPERVISOR, VENDEDOR, VENDEDOR_2, PROMOTOR]));
  const base = { estado, membros: MEMBROS, viewer: sup, escopo, modulos: TODOS, agora: AGORA, data: HOJE };

  it('RF-GES-02 / RN-VEN-35: ficha do vendedor da equipe traz o painel e o pedido em nome disponível', () => {
    const f = fichaDoMembro({ ...base, usuario_id: VENDEDOR });
    expect(f && FichaMembro.parse(f)).toEqual(f);
    expect(f?.painel.vendas?.vendas_cents).toBe(50_000);
    expect(f?.pedido_em_nome).toMatchObject({ visivel: true, permitido: true });
  });

  it('RN-PRO-01: na ficha do promotor o pedido em nome não é permitido', () => {
    expect(fichaDoMembro({ ...base, usuario_id: PROMOTOR })?.pedido_em_nome).toMatchObject({ permitido: false, codigo: 'VENDEDOR_INVALIDO' });
  });

  it('RN-CORE-04: fora do escopo ou quem não é de campo ⇒ null (a API responde 404 sem revelar)', () => {
    expect(fichaDoMembro({ ...base, usuario_id: VEND_3 })).toBeNull();
    expect(fichaDoMembro({ ...base, usuario_id: u(999) })).toBeNull();
    expect(fichaDoMembro({ ...base, escopo: { tipo: 'tenant' }, viewer: { id: u(9), perfil: 'analista' }, usuario_id: SUPERVISOR })).toBeNull();
  });

  it('RN-GES-07 / RN-CORE-03: analista lê a ficha sem pedido em nome; sem Vendedor a função some', () => {
    expect(fichaDoMembro({ ...base, escopo: { tipo: 'tenant' }, viewer: { id: u(9), perfil: 'analista' }, usuario_id: VENDEDOR })?.pedido_em_nome.visivel).toBe(false);
    expect(fichaDoMembro({ ...base, modulos: new Set(['core']), usuario_id: VENDEDOR })?.pedido_em_nome).toMatchObject({ visivel: false, codigo: 'MODULO_VENDEDOR_INATIVO' });
  });
});

describe('alertas no escopo e dispensa (RF-GES-07)', () => {
  const alerta = (n: number, responsavel: string | null, status: Alerta['status'] = 'aberto'): Alerta => ({
    id: u(800 + n),
    chave: `visita_curta:${u(700 + n)}`,
    tipo: 'visita_curta',
    alvo_tipo: 'visita_loja',
    alvo_id: u(700 + n),
    responsavel_id: responsavel,
    valor: 4,
    limiar: 10,
    severidade: 'atencao',
    mensagem: 'Visita curta',
    status,
    aberto_em: AGORA,
    encerrado_em: null,
    motivo_encerramento: null,
  });
  const lista = [alerta(1, VENDEDOR), alerta(2, VEND_3), alerta(3, null), alerta(4, PROMOTOR, 'dispensado'), alerta(5, VENDEDOR, 'encerrado')];

  it('RN-CORE-04: o supervisor vê só os alertas de quem é da equipe; sem responsável só o tenant vê', () => {
    const eq = { tipo: 'equipe' as const, ids: new Set([VENDEDOR, PROMOTOR]) };
    expect(alertasDoEscopo(lista, eq, {}).map((a) => a.id)).toEqual([u(801), u(804), u(805)]);
    expect(alertasDoEscopo(lista, { tipo: 'tenant' }, {})).toHaveLength(5);
    expect(alertasDoEscopo(lista, { tipo: 'nenhum' }, {})).toEqual([]);
  });

  it('RF-GES-07: filtro por status; padrão = abertos e dispensados (encerrado só quando pedido)', () => {
    const t = { tipo: 'tenant' as const };
    expect(alertasDoEscopo(lista, t, {}).map((a) => a.status)).not.toContain(undefined);
    expect(alertasDoEscopo(lista, t, { status: 'aberto' }).map((a) => a.id)).toEqual([u(801), u(802), u(803)]);
    expect(alertasDoEscopo(lista, t, { status: 'encerrado' }).map((a) => a.id)).toEqual([u(805)]);
    expect(alertasDoEscopo(lista, t, { ativos: true }).map((a) => a.id)).toEqual([u(801), u(802), u(803), u(804)]);
  });

  it('RF-GES-07: dispensar muda o alerta aberto para dispensado; repetir devolve o mesmo (idempotente)', () => {
    const eq = { tipo: 'equipe' as const, ids: new Set([VENDEDOR]) };
    const r = dispensarAlerta(alerta(1, VENDEDOR), eq);
    expect(r).toEqual({ ok: true, alerta: { ...alerta(1, VENDEDOR), status: 'dispensado' } });
    expect(dispensarAlerta({ ...alerta(1, VENDEDOR), status: 'dispensado' }, eq)).toMatchObject({ ok: true, repetido: true });
  });

  it('RN-CORE-04 / RF-GES-07: fora do escopo = não encontrado; encerrado não se dispensa', () => {
    const eq = { tipo: 'equipe' as const, ids: new Set([VENDEDOR]) };
    expect(dispensarAlerta(alerta(2, VEND_3), eq)).toEqual({ ok: false, codigo: 'ALERTA_NAO_ENCONTRADO' });
    expect(dispensarAlerta(null, eq)).toEqual({ ok: false, codigo: 'ALERTA_NAO_ENCONTRADO' });
    expect(dispensarAlerta(alerta(5, VENDEDOR, 'encerrado'), eq)).toEqual({ ok: false, codigo: 'ALERTA_ENCERRADO' });
  });

  it('RF-GES-07: o ajuste da regra é validado no contrato e só muda o que veio', () => {
    const r = ajustarRegraAlerta({ fotos_sem_gps: { ativa: false } }, 'ruptura_recorrente', { limiar: 4 });
    expect(r).toEqual({ ok: true, ajustes: { fotos_sem_gps: { ativa: false }, ruptura_recorrente: { limiar: 4 } } });
    expect(ajustarRegraAlerta({}, 'ruptura_recorrente', { limiar: -1 })).toMatchObject({ ok: false });
    expect(ajustarRegraAlerta({}, 'ruptura_recorrente', { tipo: 'x' })).toMatchObject({ ok: false });
  });

  it('RN-GES-01 / RN-GES-03: cliente_sem_visita e pedido_aguardando_aprovacao só ligam ou desligam (limite vem dos parâmetros)', () => {
    expect(ajustarRegraAlerta({}, 'cliente_sem_visita', { limiar: 10 })).toMatchObject({ ok: false, erros: [expect.stringMatching(/RN-GES-01/)] });
    expect(ajustarRegraAlerta({}, 'pedido_aguardando_aprovacao', { ativa: false })).toMatchObject({ ok: true });
  });

  it('RN-CORE-03: sem o Promotor, os alertas de trade não aparecem nem são encerrados por quem consulta', () => {
    const t = { tipo: 'tenant' as const };
    expect(alertasDoEscopo(lista, t, { modulos: new Set(['core', 'vendedor']) })).toEqual([]);
    const ops = reconciliarParaViewer([alerta(1, VENDEDOR)], { estado: estadoInicial(), membros: MEMBROS, agora: AGORA, modulos: new Set(['core']), ajustes: {} });
    expect(ops).toEqual({ abrir: [], atualizar: [], encerrar: [] });
  });

  it('RF-GES-07: com o Promotor ativo, alerta cuja condição sumiu é encerrado; regra desligada encerra como regra_inativa', () => {
    const base = { estado: estadoInicial(), membros: MEMBROS, agora: AGORA, modulos: TODOS };
    expect(reconciliarParaViewer([alerta(1, VENDEDOR)], { ...base, ajustes: {} }).encerrar).toEqual([{ id: u(801), motivo: 'condicao_normalizada', encerrado_em: AGORA }]);
    expect(reconciliarParaViewer([alerta(1, VENDEDOR)], { ...base, ajustes: { visita_curta: { ativa: false } } }).encerrar).toEqual([{ id: u(801), motivo: 'regra_inativa', encerrado_em: AGORA }]);
  });
});
