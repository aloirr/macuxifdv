import { describe, expect, it } from 'vitest';
import type { EstoqueVisivel } from '../../contracts';
import { linhasEstoquePorFilial } from './estoque-filial';

const estoque = (by_branch: EstoqueVisivel['by_branch']): EstoqueVisivel => ({ product_id: '0b000000-0000-4000-8000-000000000001', band: 'disponivel', quantity: 1, by_branch, updated_at: null, stale: false });
const filial = (branch_name: string, band: 'disponivel' | 'baixo' | 'sem_estoque', quantity: number | null) => ({ branch_id: `0f000000-0000-4000-8000-0000000000${branch_name.length}`, branch_name, band, quantity });

describe('RN-CORE-39: estoque por filial na ficha do BKO', () => {
  it('RN-CORE-39: uma linha por filial, com faixa e número em pt-BR', () => {
    const r = linhasEstoquePorFilial(estoque([filial('Manaus', 'disponivel', 1200), filial('Boa Vista', 'baixo', 7)]));
    expect(r.map((x) => x.texto)).toEqual(['Manaus: Disponível · 1.200', 'Boa Vista: Estoque baixo · 7']);
  });

  it('RN-CORE-39: filial sem estoque mostra só a faixa; tenant que não mostra o número mostra só a faixa', () => {
    expect(linhasEstoquePorFilial(estoque([filial('Boa Vista', 'sem_estoque', 0)]))[0]!.texto).toBe('Boa Vista: Sem estoque');
    expect(linhasEstoquePorFilial(estoque([filial('Manaus', 'disponivel', null)]))[0]!.texto).toBe('Manaus: Disponível');
  });

  it('RN-CAT-05: perfil sem direito a estoque (sem availability) não tem linhas', () => {
    expect(linhasEstoquePorFilial(null)).toEqual([]);
    expect(linhasEstoquePorFilial(undefined)).toEqual([]);
  });
});
