import { describe, expect, it } from 'vitest';
import type { MembroEquipe, PainelDia } from '../contracts';
import { construirArvore, equipesAbaixo, escopoDoUsuario, filtrarPorEscopo, podeVer, resumirEquipe, subordinadosDe } from './equipe';
import { u } from './fixtures';

const G = u(1), S1 = u(2), S2 = u(3), V1 = u(11), V2 = u(12), P1 = u(21), V3 = u(13), X = u(99);
const m = (id: string, nome: string, perfil: MembroEquipe['perfil'], superior_id: string | null, ativo = true): MembroEquipe => ({ id, nome, perfil, superior_id, ativo });
const ROSTER: MembroEquipe[] = [
  m(G, 'Gabriela', 'gerente', null),
  m(S1, 'Sandro', 'supervisor', G),
  m(S2, 'Sueli', 'supervisor', G),
  m(V1, 'Vera', 'vendedor', S1),
  m(V2, 'Valter', 'vendedor', S1),
  m(P1, 'Paula', 'promotor', S1),
  m(V3, 'Vitor', 'vendedor', S2),
  m(X, 'Xavier', 'vendedor', null), // fora de qualquer equipe
];

describe('RF-GES-01: árvore gerente → supervisor → vendedor/promotor', () => {
  it('monta a árvore ordenada por nome; quem não tem superior é raiz', () => {
    const raizes = construirArvore(ROSTER);
    expect(raizes.map((r) => r.membro.nome)).toEqual(['Gabriela', 'Xavier']);
    expect(raizes[0]!.filhos.map((f) => f.membro.nome)).toEqual(['Sandro', 'Sueli']);
    expect(raizes[0]!.filhos[0]!.filhos.map((f) => f.membro.nome)).toEqual(['Paula', 'Valter', 'Vera']);
  });

  it('superior que não existe no cadastro: o membro vira raiz (não some)', () => {
    expect(construirArvore([m(V1, 'Vera', 'vendedor', u(777))]).map((r) => r.membro.id)).toEqual([V1]);
  });

  it('ciclo na hierarquia é erro em português (dado corrompido não pode travar o painel)', () => {
    expect(() => construirArvore([m(S1, 'A', 'supervisor', S2), m(S2, 'B', 'supervisor', S1)])).toThrow(/ciclo/i);
  });

  it('subordinados diretos e indiretos', () => {
    expect(subordinadosDe(ROSTER, G).map((x) => x.id).sort()).toEqual([P1, S1, S2, V1, V2, V3].sort());
    expect(subordinadosDe(ROSTER, S1).map((x) => x.id).sort()).toEqual([P1, V1, V2].sort());
    expect(subordinadosDe(ROSTER, V1)).toEqual([]);
  });
});

describe('RN-CORE-04: escopo por perfil', () => {
  it('RN-CORE-04: supervisor vê a equipe (diretos e indiretos), não a de outro supervisor', () => {
    const e = escopoDoUsuario({ id: S1, perfil: 'supervisor' }, ROSTER);
    expect(e.tipo).toBe('equipe');
    expect(podeVer(e, V1)).toBe(true);
    expect(podeVer(e, P1)).toBe(true);
    expect(podeVer(e, V3)).toBe(false);
    expect(podeVer(e, X)).toBe(false);
    expect(podeVer(e, S1)).toBe(false);
  });

  it('RN-CORE-04: gerente vê as equipes abaixo (supervisores e seus vendedores)', () => {
    const e = escopoDoUsuario({ id: G, perfil: 'gerente' }, ROSTER);
    expect([V1, V3, S1, S2, P1].every((id) => podeVer(e, id))).toBe(true);
    expect(podeVer(e, X)).toBe(false);
  });

  it('RN-CORE-04: analista e admin veem o tenant (leitura); vendedor, promotor e assistente não veem equipe', () => {
    expect(podeVer(escopoDoUsuario({ id: u(50), perfil: 'analista' }, ROSTER), X)).toBe(true);
    expect(podeVer(escopoDoUsuario({ id: u(51), perfil: 'admin' }, ROSTER), V3)).toBe(true);
    for (const perfil of ['vendedor', 'promotor', 'assistente'] as const) {
      const e = escopoDoUsuario({ id: V1, perfil }, ROSTER);
      expect(e.tipo).toBe('nenhum');
      expect(podeVer(e, V2)).toBe(false);
    }
  });

  it('supervisor ausente do cadastro: escopo vazio, nunca o tenant inteiro', () => {
    const e = escopoDoUsuario({ id: u(404), perfil: 'supervisor' }, ROSTER);
    expect(e.tipo).toBe('equipe');
    expect(podeVer(e, V1)).toBe(false);
  });

  it('filtrarPorEscopo mantém só o que o perfil pode ver', () => {
    const e = escopoDoUsuario({ id: S1, perfil: 'supervisor' }, ROSTER);
    const itens = [{ vendedor_id: V1 }, { vendedor_id: V3 }, { vendedor_id: P1 }];
    expect(filtrarPorEscopo(e, itens, (i) => i.vendedor_id)).toEqual([{ vendedor_id: V1 }, { vendedor_id: P1 }]);
    expect(filtrarPorEscopo({ tipo: 'nenhum' }, itens, (i) => i.vendedor_id)).toEqual([]);
  });
});

const linha = (
  usuario_id: string,
  perfil: 'vendedor' | 'promotor',
  status: PainelDia['status_dia'],
  o: { vendas?: number; meta?: number | null; mesVendas?: number; real?: number; plan?: number; planReal?: number; extras?: number | null; vendido?: number; faturado?: number } = {},
): PainelDia =>
  ({
    usuario_id,
    perfil,
    data: '2026-10-30',
    status_dia: status,
    visitas: {
      planejadas: o.plan ?? 0,
      realizadas: o.real ?? 0,
      planejadas_realizadas: o.planReal ?? Math.min(o.real ?? 0, o.plan ?? 0),
      visitas_extras: o.extras === undefined ? (o.plan ? Math.max(0, (o.real ?? 0) - (o.plan ?? 0)) : null) : o.extras,
      em_andamento: 0,
      cobertura_pct: null,
      tempo_total_min: 0,
      tempo_medio_min: null,
      curtas: 0,
      conversao_pedido_pct: null,
    },
    faturamento: o.vendas === undefined ? null : { vendido_cents: o.vendido ?? o.vendas, faturado_cents: o.faturado ?? 0, a_faturar_cents: (o.vendido ?? o.vendas) - (o.faturado ?? 0) },
    vendas: o.vendas === undefined ? null : { vendas_cents: o.vendas, pedidos: 1, clientes_positivados: 1, ticket_medio_cents: o.vendas, desconto_medio_pct: null },
    mes:
      o.vendas === undefined
        ? null
        : { mes: '2026-10', vendas_cents: o.mesVendas ?? o.vendas, pedidos: 1, clientes_positivados: 1, ticket_medio_cents: null, meta_cents: o.meta ?? null, atingimento_pct: null, falta_cents: null, dias_uteis_restantes: 1, necessidade_diaria_cents: null, ritmo_pct: null },
    trade: null,
    pesquisa: null,
    treinamento: null,
    calculado_em: '2026-10-30T20:00:00Z',
  }) as PainelDia;

describe('RF-GES-01: resumo da equipe do dia', () => {
  const paineis = [
    linha(V1, 'vendedor', 'em_visita', { vendas: 10_000, meta: 100_000, mesVendas: 50_000, real: 3, plan: 4 }),
    linha(V2, 'vendedor', 'em_rota', { vendas: 5_000, meta: 100_000, mesVendas: 20_000, real: 2, plan: 4 }),
    linha(P1, 'promotor', 'sem_checkin', { real: 1, plan: 2 }),
    linha(V3, 'vendedor', 'em_rota', { vendas: 7_000, meta: null, mesVendas: 7_000, real: 1, plan: 1 }),
  ];

  it('soma vendas, status do dia, visitas e atingimento (só de quem tem meta) abaixo do gerente', () => {
    const r = resumirEquipe(G, ROSTER, paineis);
    expect(r).toEqual({
      gestor_id: G,
      membros: 4,
      sem_checkin: 1,
      em_rota: 2,
      em_visita: 1,
      vendas_cents: 22_000,
      pedidos: 3,
      meta_cents: 200_000,
      atingimento_pct: 35, // (50.000 + 20.000) ÷ 200.000
      visitas_realizadas: 7,
      visitas_planejadas: 11,
      visitas_planejadas_realizadas: 7,
      visitas_extras: 0,
      cobertura_pct: 63.64,
      vendido_cents: 22_000,
      faturado_cents: 0,
      a_faturar_cents: 22_000,
    });
  });

  it('RN-GES-05: a cobertura da equipe usa só as visitas da rota (máx. 100%) e soma as extras à parte', () => {
    const r = resumirEquipe(S1, ROSTER, [
      linha(V1, 'vendedor', 'em_rota', { vendas: 0, real: 12, plan: 10, planReal: 10, extras: 2 }),
      linha(V2, 'vendedor', 'em_rota', { vendas: 0, real: 5, plan: 10, planReal: 4, extras: 1 }),
    ]);
    expect(r).toMatchObject({ visitas_realizadas: 17, visitas_planejadas: 20, visitas_planejadas_realizadas: 14, visitas_extras: 3, cobertura_pct: 70 });
    const semRota = resumirEquipe(S1, ROSTER, [linha(V1, 'vendedor', 'em_rota', { vendas: 0, real: 3, extras: null })]);
    expect(semRota).toMatchObject({ cobertura_pct: null, visitas_extras: null });
  });

  it('RN-GES-06: vendido, faturado e a faturar somados na equipe', () => {
    const r = resumirEquipe(S1, ROSTER, [
      linha(V1, 'vendedor', 'em_rota', { vendas: 10_000, vendido: 10_000, faturado: 3_000 }),
      linha(V2, 'vendedor', 'em_rota', { vendas: 5_000, vendido: 6_000, faturado: 6_000 }),
    ]);
    expect(r).toMatchObject({ vendido_cents: 16_000, faturado_cents: 9_000, a_faturar_cents: 7_000 });
  });

  it('membro sem linha de painel no dia conta como sem check-in; inativo não conta', () => {
    const roster = [...ROSTER, m(u(14), 'Vilma', 'vendedor', S1), m(u(15), 'Valdo', 'vendedor', S1, false)];
    const r = resumirEquipe(S1, roster, paineis.slice(0, 2));
    expect(r.membros).toBe(4); // V1, V2, P1, Vilma
    expect(r.sem_checkin).toBe(2); // P1 e Vilma
  });

  it('sem Vendedor ativo (nenhuma linha com vendas) o resumo não inventa zero: vendas/meta null', () => {
    const r = resumirEquipe(S1, ROSTER, [linha(P1, 'promotor', 'em_rota', { real: 1, plan: 2 })]);
    expect(r).toMatchObject({ vendas_cents: null, pedidos: null, meta_cents: null, atingimento_pct: null, vendido_cents: null, faturado_cents: null, a_faturar_cents: null });
  });

  it('equipesAbaixo: um resumo por supervisor subordinado ao gerente', () => {
    const lista = equipesAbaixo(G, ROSTER, paineis);
    expect(lista.map((r) => [r.gestor_id, r.membros])).toEqual([[S1, 3], [S2, 1]]);
  });
});
