import { describe, expect, it } from 'vitest';
import { RankingEquipe, type MembroEquipe } from '../contracts';
import { CLIENTE_A, CLIENTE_B, CLIENTE_C, ev, pedidoCriado, statusAlterado, u } from './fixtures';
import { INDICADORES, intervaloDoPeriodo, ordenarRanking, rankingDaEquipe, type EntradaOrdenacao } from './ranking';
import { aplicarEventos, estadoInicial, type EventoRecebido } from './projecao';

const SUP = u(2), GER = u(1), A = u(11), B = u(12), C = u(13), P = u(21);
const m = (id: string, nome: string, perfil: MembroEquipe['perfil'], superior_id: string | null, ativo = true): MembroEquipe => ({ id, nome, perfil, superior_id, ativo });
const ROSTER = [m(GER, 'Gabriela', 'gerente', null), m(SUP, 'Sandro', 'supervisor', GER), m(A, 'Ana', 'vendedor', SUP), m(B, 'Bruno', 'vendedor', SUP), m(C, 'Carla', 'vendedor', SUP), m(P, 'Paula', 'promotor', SUP), m(u(30), 'Zeca', 'vendedor', null)];

const venda = (n: number, vendedor: string, total: number, em: string, cliente = CLIENTE_A): EventoRecebido[] => [
  pedidoCriado({ pedido: u(1000 + n), vendedor, total, em, cliente }),
  statusAlterado({ pedido: u(1000 + n), vendedor, para: 'aprovado', em }),
];
const MODULOS = new Set(['core', 'vendedor', 'promotor']);
const AGORA = '2026-10-30T20:00:00Z';

describe('RF-GES-03: períodos do ranking (fuso do tenant)', () => {
  it('diário, semanal (segunda a domingo) e mensal', () => {
    expect(intervaloDoPeriodo('diario', '2026-10-30')).toEqual({ inicio: '2026-10-30', fim: '2026-10-30' });
    expect(intervaloDoPeriodo('semanal', '2026-10-30')).toEqual({ inicio: '2026-10-26', fim: '2026-11-01' });
    expect(intervaloDoPeriodo('semanal', '2026-11-01')).toEqual({ inicio: '2026-10-26', fim: '2026-11-01' }); // domingo fecha a semana
    expect(intervaloDoPeriodo('mensal', '2026-02-10')).toEqual({ inicio: '2026-02-01', fim: '2026-02-28' });
  });
});

describe('RF-GES-03: ordenação e desempate do ranking', () => {
  const e = (usuario_id: string, nome: string, valor: number | null, vendas_cents = 0, pedidos = 0): EntradaOrdenacao => ({ usuario_id, nome, perfil: 'vendedor', valor, vendas_cents, pedidos });

  it('quanto maior melhor: valor desc, posições 1, 2, 3 sem repetir', () => {
    const l = ordenarRanking([e('a', 'Ana', 10), e('b', 'Bruno', 30), e('c', 'Carla', 20)], 'maior');
    expect(l.map((x) => [x.usuario_id, x.posicao])).toEqual([['b', 1], ['c', 2], ['a', 3]]);
  });

  it('desempate: 1) valor 2) maior venda no período 3) mais pedidos 4) nome 5) id', () => {
    const l = ordenarRanking(
      [e('4', 'Zilda', 50, 100, 1), e('3', 'Ana', 50, 100, 1), e('2', 'Bia', 50, 100, 2), e('1', 'Caio', 50, 200, 1), e('5', 'Ana', 50, 100, 1)],
      'maior',
    );
    // Caio (mais venda) > Bia (mais pedidos) > Ana id 3 e Ana id 5 (nome igual → id) > Zilda
    expect(l.map((x) => x.usuario_id)).toEqual(['1', '2', '3', '5', '4']);
    expect(l.map((x) => x.posicao)).toEqual([1, 2, 3, 4, 5]);
  });

  it('nome sem diferenciar acento e caixa: "álvaro" vem antes de "Bruno"', () => {
    const l = ordenarRanking([e('b', 'Bruno', 5), e('a', 'álvaro', 5)], 'maior');
    expect(l.map((x) => x.usuario_id)).toEqual(['a', 'b']);
  });

  it('quanto menor melhor (ex.: ruptura): menor valor fica em 1º', () => {
    const l = ordenarRanking([e('a', 'Ana', 30), e('b', 'Bruno', 10)], 'menor');
    expect(l[0]!.usuario_id).toBe('b');
  });

  it('sem dado no período (valor null): lista no fim, sem posição, em ordem de nome e id', () => {
    const l = ordenarRanking([e('x', 'Zé', null), e('a', 'Ana', 10), e('y', 'Abel', null)], 'maior');
    expect(l.map((x) => [x.usuario_id, x.posicao])).toEqual([['a', 1], ['y', null], ['x', null]]);
  });

  it('valor 0 é dado (posição existe); null não é', () => {
    const l = ordenarRanking([e('a', 'Ana', 0), e('b', 'Bruno', null)], 'maior');
    expect(l[0]!.posicao).toBe(1);
    expect(l[1]!.posicao).toBeNull();
  });
});

describe('RF-GES-03: ranking da equipe com escopo (RN-CORE-04) e módulos', () => {
  const s = aplicarEventos(estadoInicial(), [
    ev('core.meta.definida@1', '2026-10-01T08:00:00Z', { usuario_id: A, mes: '2026-10', meta_cents: 100_000 }),
    ev('core.meta.definida@1', '2026-10-01T08:00:00Z', { usuario_id: B, mes: '2026-10', meta_cents: 40_000 }),
    ...venda(1, A, 60_000, '2026-10-30T15:00:00Z'),
    ...venda(2, B, 30_000, '2026-10-29T15:00:00Z', CLIENTE_B),
    ...venda(3, B, 20_000, '2026-10-30T15:00:00Z', CLIENTE_C),
    ...venda(4, C, 50_000, '2026-10-30T15:00:00Z', CLIENTE_C),
    ...venda(5, u(30), 999_000, '2026-10-30T15:00:00Z'), // Zeca: fora da equipe do supervisor
  ]).estado;
  const base = { estado: s, membros: ROSTER, modulos: MODULOS, data_ref: '2026-10-30', agora: AGORA };

  it('supervisor: só a própria equipe; vendas do dia em ordem, desempate por pedidos quando o valor empata', () => {
    const r = rankingDaEquipe({ ...base, viewer: { id: SUP, perfil: 'supervisor' }, indicador: 'vendas_cents', periodo: 'diario' });
    expect(RankingEquipe.parse(r)).toEqual(r);
    expect(r.linhas.map((l) => [l.nome, l.valor, l.posicao])).toEqual([
      ['Ana', 60_000, 1],
      ['Carla', 50_000, 2],
      ['Bruno', 20_000, 3],
    ]);
    expect(r.linhas.some((l) => l.nome === 'Zeca' || l.perfil === 'promotor')).toBe(false);
  });

  it('semanal soma a semana (segunda a domingo): Bruno 50.000 empata com Carla 50.000 — vence quem vendeu mais, depois mais pedidos', () => {
    const r = rankingDaEquipe({ ...base, viewer: { id: SUP, perfil: 'supervisor' }, indicador: 'vendas_cents', periodo: 'semanal' });
    expect([r.inicio, r.fim]).toEqual(['2026-10-26', '2026-11-01']);
    expect(r.linhas.map((l) => [l.nome, l.valor])).toEqual([['Ana', 60_000], ['Bruno', 50_000], ['Carla', 50_000]]);
    // Bruno e Carla: valor e venda iguais; Bruno tem 2 pedidos contra 1 → Bruno antes
    expect(r.linhas[1]!.nome).toBe('Bruno');
  });

  it('atingimento da meta só existe no período mensal (meta é mensal); demais períodos ficam sem dado', () => {
    const mensal = rankingDaEquipe({ ...base, viewer: { id: SUP, perfil: 'supervisor' }, indicador: 'atingimento_meta_pct', periodo: 'mensal' });
    expect(mensal.linhas.map((l) => [l.nome, l.valor, l.posicao])).toEqual([['Bruno', 125, 1], ['Ana', 60, 2], ['Carla', null, null]]);
    const diario = rankingDaEquipe({ ...base, viewer: { id: SUP, perfil: 'supervisor' }, indicador: 'atingimento_meta_pct', periodo: 'diario' });
    expect(diario.linhas.every((l) => l.valor === null && l.posicao === null)).toBe(true);
  });

  it('ticket médio e positivados saem do mesmo período', () => {
    const t = rankingDaEquipe({ ...base, viewer: { id: SUP, perfil: 'supervisor' }, indicador: 'ticket_medio_cents', periodo: 'mensal' });
    expect(t.linhas.map((l) => [l.nome, l.valor])).toEqual([['Ana', 60_000], ['Carla', 50_000], ['Bruno', 25_000]]);
    const p = rankingDaEquipe({ ...base, viewer: { id: SUP, perfil: 'supervisor' }, indicador: 'positivados', periodo: 'mensal' });
    expect(p.linhas.find((l) => l.nome === 'Bruno')!.valor).toBe(2);
  });

  it('gerente vê as equipes abaixo (inclui vendedores dos supervisores), não quem está fora', () => {
    const r = rankingDaEquipe({ ...base, viewer: { id: GER, perfil: 'gerente' }, indicador: 'vendas_cents', periodo: 'diario' });
    expect(r.linhas).toHaveLength(3);
  });

  it('analista (tenant) enxerga todos os vendedores ativos, inclusive quem não tem superior', () => {
    const r = rankingDaEquipe({ ...base, viewer: { id: u(50), perfil: 'analista' }, indicador: 'vendas_cents', periodo: 'diario' });
    expect(r.linhas[0]!.nome).toBe('Zeca');
    expect(r.linhas).toHaveLength(4);
  });

  it('vendedor não vê ranking de equipe (escopo nenhum)', () => {
    const r = rankingDaEquipe({ ...base, viewer: { id: A, perfil: 'vendedor' }, indicador: 'vendas_cents', periodo: 'diario' });
    expect(r.linhas).toEqual([]);
  });

  it('inativo não participa', () => {
    const roster = ROSTER.map((x) => (x.id === C ? { ...x, ativo: false } : x));
    const r = rankingDaEquipe({ ...base, membros: roster, viewer: { id: SUP, perfil: 'supervisor' }, indicador: 'vendas_cents', periodo: 'diario' });
    expect(r.linhas.map((l) => l.nome)).toEqual(['Ana', 'Bruno']);
  });

  it('módulo do indicador desativado: ranking vazio, sem erro (RN-CORE-03)', () => {
    const r = rankingDaEquipe({ ...base, modulos: new Set(['core', 'promotor']), viewer: { id: SUP, perfil: 'supervisor' }, indicador: 'vendas_cents', periodo: 'diario' });
    expect(r.linhas).toEqual([]);
  });

  it('indicadores do promotor ranqueiam promotores; ruptura: menor é melhor', () => {
    expect(INDICADORES.ruptura_pct).toMatchObject({ sentido: 'menor', perfis: ['promotor'], modulo: 'promotor' });
    const r = rankingDaEquipe({ ...base, viewer: { id: SUP, perfil: 'supervisor' }, indicador: 'ruptura_pct', periodo: 'diario' });
    expect(r.linhas.map((l) => l.nome)).toEqual(['Paula']);
    expect(r.linhas[0]!.valor).toBeNull();
    expect(r.sentido).toBe('menor');
  });
});
