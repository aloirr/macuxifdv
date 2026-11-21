import { describe, expect, it } from 'vitest';
import { cargaDoEstoque, estoqueCarregandoVisivel } from './carga-do-cartao';

describe('cargaDoEstoque (T-0192, docs/design/catalogo-grade.md §7.2)', () => {
  it('RF-CAT-01: sem pendência nenhuma, o estoque não está carregando', () => {
    expect(cargaDoEstoque({ pendentes: [] }, 'local')).toBe(false);
    expect(cargaDoEstoque({}, 'local')).toBe(false);
  });
  it('RF-CAT-01: estoque_saldo pendente em modo local marca o estoque', () => {
    expect(cargaDoEstoque({ pendentes: ['estoque_saldo'] }, 'local')).toBe(true);
    expect(cargaDoEstoque({ pendentes: ['produto', 'catalogo_precos', 'estoque_saldo'] }, 'local')).toBe(true);
  });
  it('RF-CAT-01: preço e outras entidades pendentes não marcam o estoque', () => {
    expect(cargaDoEstoque({ pendentes: ['produto', 'catalogo_precos', 'sinonimo'] }, 'local')).toBe(false);
  });
  it('RF-CAT-01: em modo api ou sem_sinal a marca fica falsa', () => {
    for (const modo of ['api', 'sem_sinal'] as const) expect(cargaDoEstoque({ pendentes: ['estoque_saldo'] }, modo)).toBe(false);
  });
});

describe('estoqueCarregandoVisivel (RN-CAT-05)', () => {
  it('RN-CAT-05: o chip "Estoque: —" só aparece para quem vê preço e estoque', () => {
    expect(estoqueCarregandoVisivel(true, true)).toBe(true);
    expect(estoqueCarregandoVisivel(true, false)).toBe(false);
    expect(estoqueCarregandoVisivel(false, true)).toBe(false);
  });
});
