import { describe, expect, it } from 'vitest';
import { EstoqueVisivel } from '../contracts';
import { faixaDeEstoque, estoqueVisivel } from './estoque';
import { PARAMETROS_PADRAO, resolverParametros } from './parametros';

const AGORA = '2026-10-31T15:00:00Z';
const saldo = (branch_id: string, quantity: number, updated_at: string | null = '2026-10-31T12:00:00Z') => ({ branch_id, branch_name: `Filial ${branch_id}`, quantity, updated_at });
const ver = (saldos: ReturnType<typeof saldo>[], filiais: readonly string[] | null, p = PARAMETROS_PADRAO) => estoqueVisivel('p1', saldos, { filiais, agora: AGORA, parametros: p });

describe('RF-CAT-03: faixas de estoque (parametrizáveis)', () => {
  it('RF-CAT-03: zero ou negativo = sem estoque; até o limite "baixo" = baixo; acima = disponível', () => {
    expect(faixaDeEstoque(0, 10)).toBe('sem_estoque');
    expect(faixaDeEstoque(-4, 10)).toBe('sem_estoque');
    expect(faixaDeEstoque(1, 10)).toBe('baixo');
    expect(faixaDeEstoque(10, 10)).toBe('baixo');
    expect(faixaDeEstoque(11, 10)).toBe('disponivel');
  });
  it('RF-CAT-03: com limite "baixo" zero não existe a faixa baixo', () => {
    expect(faixaDeEstoque(1, 0)).toBe('disponivel');
  });
});

describe('RF-CAT-03 / RN-VEN-20: estoque visível por filial/depósito do usuário', () => {
  it('RF-CAT-03: soma só as filiais do vendedor, ignorando as demais', () => {
    const r = ver([saldo('f1', 5), saldo('f2', 100), saldo('f3', 7)], ['f1', 'f3']);
    expect(r).toMatchObject({ quantity: 12, band: 'disponivel' });
    expect(r.by_branch.map((b) => b.branch_id)).toEqual(['f1', 'f3']);
    expect(EstoqueVisivel.safeParse(r).success).toBe(true);
  });

  it('RF-CAT-03: perfis de escopo do tenant passam `filiais: null` e veem todas', () => {
    expect(ver([saldo('f1', 5), saldo('f2', 100)], null).quantity).toBe(105);
  });

  it('RF-CAT-03: vendedor sem filial vinculada não vê estoque de ninguém (conservador)', () => {
    const r = ver([saldo('f1', 5)], []);
    expect(r).toMatchObject({ band: 'sem_estoque', by_branch: [], updated_at: null, stale: false });
  });

  it('RF-CAT-03: filial com produto e outra sem — a faixa total vem da soma e cada filial tem a sua', () => {
    const r = ver([saldo('f1', 0), saldo('f2', 4)], ['f1', 'f2']);
    expect(r.band).toBe('baixo');
    expect(r.by_branch.map((b) => [b.branch_id, b.band])).toEqual([['f1', 'sem_estoque'], ['f2', 'baixo']]);
  });

  it('catalogo-campo-v2 §2.1: saldo negativo do ERP aparece com o sinal (a faixa é "sem estoque") e entra na soma', () => {
    expect(ver([saldo('f1', -3), saldo('f2', 8)], null)).toMatchObject({ quantity: 5, band: 'baixo' });
    expect(ver([saldo('f1', -3)], null)).toMatchObject({ quantity: -3, band: 'sem_estoque' });
    expect(ver([saldo('f1', -3)], null).by_branch[0]).toMatchObject({ quantity: -3, band: 'sem_estoque' });
  });

  it('R-20261115-104500 (item 4) e RN-CORE-39: o total soma só as filiais do N; a folha lista só as filiais de venda da folha, nunca outra', () => {
    const r = estoqueVisivel('p1', [saldo('f1', 5), saldo('f2', 7), saldo('f3', 9)], { filiais: ['f1'], filiaisFolha: ['f1', 'f2'], agora: '2026-11-01T12:00:00Z', parametros: resolverParametros({}) });
    expect(r.quantity).toBe(5);
    expect(r.by_branch.map((b) => [b.branch_id, b.quantity])).toEqual([['f1', 5], ['f2', 7]]);
    expect(r.by_branch.map((b) => b.branch_id)).not.toContain('f3');
  });

  it('RN-CORE-39 e catalogo-campo-v2 §2.1: filial de venda SEM linha de saldo aparece na folha com estoque 0 (o N continua a soma)', () => {
    const r = estoqueVisivel('p1', [saldo('f1', 5)], { filiais: ['f1', 'f2'], filiaisFolha: ['f1', 'f2'], nomesFilial: { f2: 'Manaus' }, agora: '2026-11-01T12:00:00Z', parametros: resolverParametros({}) });
    expect(r.quantity).toBe(5);
    expect(r.by_branch.map((b) => [b.branch_id, b.branch_name, b.quantity, b.band])).toEqual([['f1', 'Filial f1', 5, 'baixo'], ['f2', 'Manaus', 0, 'sem_estoque']]);
  });

  it('RN-CORE-39: produto sem nenhum saldo e com filiais de venda lista todas com 0; sem filial nenhuma a folha fica vazia', () => {
    const p = resolverParametros({});
    expect(estoqueVisivel('p1', [], { filiais: ['f1', 'f2'], agora: '2026-11-01T12:00:00Z', parametros: p }).by_branch.map((b) => [b.branch_id, b.quantity])).toEqual([['f1', 0], ['f2', 0]]);
    expect(estoqueVisivel('p1', [], { filiais: [], agora: '2026-11-01T12:00:00Z', parametros: p }).by_branch).toEqual([]);
  });

  it('catalogo-campo-v2 §2.1: a filial de cadastro vem primeiro e as outras de venda em ordem alfabética', () => {
    const r = estoqueVisivel('p1', [saldo('b', 1), saldo('m', 2), saldo('v', 3)], { filiais: ['b', 'm', 'v'], filialCadastro: 'v', nomesFilial: {}, agora: '2026-11-01T12:00:00Z', parametros: resolverParametros({}) });
    expect(r.by_branch.map((b) => b.branch_id)).toEqual(['v', 'b', 'm']);
  });

  it('RF-CAT-03: linhas repetidas da mesma filial somam', () => {
    expect(ver([saldo('f1', 3), saldo('f1', 4)], ['f1']).by_branch).toHaveLength(1);
    expect(ver([saldo('f1', 3), saldo('f1', 4)], ['f1']).quantity).toBe(7);
  });

  it('RF-CAT-03: tenant que não quer o número exato recebe só a faixa (total e por filial)', () => {
    const p = resolverParametros({ estoque_mostrar_quantidade: false });
    const r = ver([saldo('f1', 5), saldo('f2', 100)], null, p);
    expect(r.quantity).toBeNull();
    expect(r.by_branch.every((b) => b.quantity === null)).toBe(true);
    expect(r.band).toBe('disponivel');
    expect(JSON.stringify(r)).not.toContain('105');
    expect(EstoqueVisivel.safeParse(r).success).toBe(true);
  });

  it('RF-CAT-03: o limite da faixa "baixo" vem do parâmetro do tenant', () => {
    const p = resolverParametros({ estoque_baixo_ate: 50 });
    expect(ver([saldo('f1', 40)], null, p).band).toBe('baixo');
    expect(ver([saldo('f1', 40)], null).band).toBe('disponivel');
  });

  it('RF-CAT-03: mostra a hora da atualização (a mais antiga entre as filiais visíveis)', () => {
    const r = ver([saldo('f1', 5, '2026-10-31T12:00:00Z'), saldo('f2', 5, '2026-10-31T09:00:00Z'), saldo('f3', 5, '2026-01-01T00:00:00Z')], ['f1', 'f2']);
    expect(r.updated_at).toBe('2026-10-31T09:00:00.000Z');
    expect(r.stale).toBe(false);
  });

  it('RF-CAT-03: saldo sem atualização há mais de 24 h (parâmetro) é marcado como desatualizado', () => {
    expect(ver([saldo('f1', 5, '2026-10-30T14:59:59Z')], null).stale).toBe(true);
    expect(ver([saldo('f1', 5, '2026-10-30T15:00:00Z')], null).stale).toBe(false);
    expect(ver([saldo('f1', 5, '2026-10-30T14:59:59Z')], null, resolverParametros({ estoque_defasado_horas: 48 })).stale).toBe(false);
  });

  it('RF-CAT-03: saldo sem hora de atualização é tratado como desatualizado', () => {
    const r = ver([saldo('f1', 5, null)], null);
    expect(r).toMatchObject({ updated_at: null, stale: true });
  });

  it('RF-CAT-03: produto sem nenhum saldo cadastrado = sem estoque', () => {
    expect(ver([], null)).toMatchObject({ band: 'sem_estoque', quantity: 0, by_branch: [], stale: false });
  });

  it('a ordem das filiais é por nome e depois por id (determinística)', () => {
    const r = ver([saldo('f9', 1), saldo('f2', 1), saldo('f5', 1)], null);
    expect(r.by_branch.map((b) => b.branch_id)).toEqual(['f2', 'f5', 'f9']);
  });
});

describe('RN-CAT-07: estoque baixo, zerado e desatualizado (padrões parametrizáveis)', () => {
  it('RN-CAT-07: padrão — "baixo" de 1 a 9 unidades (T-0173) e o número exato visível', () => {
    expect(PARAMETROS_PADRAO).toMatchObject({ estoque_baixo_ate: 9, estoque_mostrar_quantidade: true, estoque_defasado_horas: 24 });
    expect(ver([saldo('f1', 9)], null)).toMatchObject({ band: 'baixo', quantity: 9 });
    expect(ver([saldo('f1', 1)], null)).toMatchObject({ band: 'baixo', quantity: 1 });
    expect(ver([saldo('f1', 10)], null)).toMatchObject({ band: 'disponivel', quantity: 10 });
    expect(ver([saldo('f1', 9)], null).by_branch[0]).toMatchObject({ band: 'baixo', quantity: 9 });
  });

  it('RN-CAT-07: estoque zerado = "sem estoque", com o zero visível e a hora da atualização', () => {
    const r = ver([saldo('f1', 0, '2026-10-31T14:30:00Z')], null);
    expect(r).toMatchObject({ band: 'sem_estoque', quantity: 0, updated_at: '2026-10-31T14:30:00.000Z', stale: false });
  });

  it('RN-CAT-07: depois de 24 h sem atualizar é "desatualizado" e continua trazendo o instante da atualização', () => {
    const r = ver([saldo('f1', 30, '2026-10-30T14:00:00Z')], null);
    expect(r).toMatchObject({ band: 'disponivel', quantity: 30, stale: true, updated_at: '2026-10-30T14:00:00.000Z' });
  });

  it('RN-CAT-07: o resultado sempre traz o instante da atualização quando há saldo com hora (fresco, baixo, zerado ou desatualizado)', () => {
    for (const [q, t] of [[50, '2026-10-31T14:00:00Z'], [3, '2026-10-31T14:00:00Z'], [0, '2026-10-31T14:00:00Z'], [50, '2026-10-01T14:00:00Z']] as const) {
      const r = ver([saldo('f1', q, t)], null);
      expect(r.updated_at, `${q} ${t}`).toBe(new Date(t).toISOString());
      expect(Object.hasOwn(r, 'updated_at')).toBe(true);
    }
  });

  it('RN-CAT-07: os três padrões são parâmetros do tenant', () => {
    const p = resolverParametros({ estoque_baixo_ate: 3, estoque_mostrar_quantidade: false, estoque_defasado_horas: 2 });
    const r = ver([saldo('f1', 5, '2026-10-31T12:30:00Z')], null, p);
    expect(r).toMatchObject({ band: 'disponivel', quantity: null, stale: true, updated_at: '2026-10-31T12:30:00.000Z' });
  });
});

describe('RN-CORE-39: estoque da filial do cliente (T-0149)', () => {
  it('RN-CORE-39: com cliente no contexto vale só a filial dele', () => {
    const r = ver([saldo('f1', 50), saldo('f2', 7)], ['f2']);
    expect(r).toMatchObject({ quantity: 7, band: 'baixo' });
    expect(r.by_branch.map((b) => b.branch_id)).toEqual(['f2']);
  });

  it('RN-CORE-39: sem registro na filial do cliente o estoque é 0 (nunca o da padrão), e a filial aparece com 0', () => {
    const r = ver([saldo('f1', 50)], ['f2']);
    expect(r).toMatchObject({ quantity: 0, band: 'sem_estoque' });
    expect(r.by_branch.map((b) => [b.branch_id, b.quantity])).toEqual([['f2', 0]]);
  });
});
