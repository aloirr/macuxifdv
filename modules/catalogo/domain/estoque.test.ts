import { describe, expect, it } from 'vitest';
import { EstoqueVisivel } from '../contracts';
import { faixaDeEstoque, estoqueVisivel } from './estoque';
import { PARAMETROS_PADRAO, resolverParametros } from './parametros';

const AGORA = '2026-10-31T15:00:00Z';
const saldo = (branch_id: string, quantity: number, updated_at: string | null = '2026-10-31T12:00:00Z') => ({ branch_id, branch_name: `Filial ${branch_id}`, quantity, updated_at });
const ver = (saldos: ReturnType<typeof saldo>[], filiais: string[] | null, p = PARAMETROS_PADRAO) => estoqueVisivel('p1', saldos, { filiais, agora: AGORA, parametros: p });

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

  it('RF-CAT-03: saldo negativo do ERP conta como zero na soma', () => {
    expect(ver([saldo('f1', -3), saldo('f2', 8)], null)).toMatchObject({ quantity: 8 });
    expect(ver([saldo('f1', -3)], null)).toMatchObject({ quantity: 0, band: 'sem_estoque' });
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
