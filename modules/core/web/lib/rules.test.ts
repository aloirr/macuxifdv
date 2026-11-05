import { describe, expect, it } from 'vitest';
import { criarPermissoes, perfilDaFaseM } from '@macuxi/platform-sdk';
import type { SellerGoals } from '../../contracts';
import { manifest } from '../../manifest';
import { canApprove, canEditParams, canEditRoutes, canManagePeriod, sortSellerGoals } from './rules';

const permissoes = criarPermissoes([manifest]);

describe('permissões por perfil', () => {
  it.each([
    ['manager', true, false, true, true],
    ['admin', true, true, true, true],
    ['analyst', false, true, true, true],
    ['bko_assistant', false, false, false, false],
    ['seller', false, false, false, false],
  ] as const)('%s', (role, approve, params, period, routes) => {
    expect(canApprove(role)).toBe(approve);
    expect(canEditParams(role)).toBe(params);
    expect(canManagePeriod(role)).toBe(period);
    expect(canEditRoutes(role)).toBe(routes);
    // as ações do manifesto (usadas pelas páginas via usePode) dizem o mesmo que as funções acima
    const ctx = { perfil: perfilDaFaseM(role), modulosAtivos: ['core' as const] };
    expect(permissoes.pode('plano_rv.editar', ctx)).toBe(params);
    expect(permissoes.pode('meta.fechar_periodo', ctx)).toBe(period);
    expect(permissoes.pode('rota.editar', ctx)).toBe(routes);
  });
});

describe('ordenação da tabela de metas', () => {
  const g = (short_name: string, revenue_projected_pct: number, incentive_cents: number) => ({ short_name, revenue_projected_pct, incentive_cents }) as SellerGoals;
  const list = [g('Paula V.', 79, 0), g('Bruna T.', 121, 361920), g('Diego M.', 101, 246200), g('Ana B.', 101, 1)];

  it('projeção: maior primeiro, empate por nome', () => {
    expect(sortSellerGoals(list, 'projection').map((s) => s.short_name)).toEqual(['Bruna T.', 'Ana B.', 'Diego M.', 'Paula V.']);
  });
  it('RV projetada: maior primeiro', () => {
    expect(sortSellerGoals(list, 'incentive').map((s) => s.short_name)).toEqual(['Bruna T.', 'Diego M.', 'Ana B.', 'Paula V.']);
  });
  it('nome: ordem alfabética, sem mudar a lista original', () => {
    expect(sortSellerGoals(list, 'name').map((s) => s.short_name)).toEqual(['Ana B.', 'Bruna T.', 'Diego M.', 'Paula V.']);
    expect(list[0]!.short_name).toBe('Paula V.');
  });
});
