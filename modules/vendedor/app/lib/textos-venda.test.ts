import { describe, expect, it } from 'vitest';

import { linhaDaObsNoResumo, tabelaDoCredito } from './textos-venda';

describe('textos da aba Venda (RF-VEN-11, RN-VEN-12, RN-VEN-13)', () => {
  it('RN-VEN-12: crédito em tabela, Limite e Disponível, sem Prazo médio (decisão R-20261118-2250), na ordem da prancha (T-0141 A)', () => {
    const t = tabelaDoCredito({ tipo: 'dados', limite_cents: 2000000, disponivel_cents: 1790000, alerta: null });
    expect(t.estado).toBe('tabela');
    expect(t.linhas.map((l) => [l.id, l.rotulo])).toEqual([['limite', 'Limite'], ['disponivel', 'Disponível']]);
    expect(t.linhas[0]!.valor).toMatch(/^R\$\s20\.000,00$/);
    expect(t.linhas[1]!.valor).toMatch(/^R\$\s17\.900,00$/);
    expect(t.linhas.every((l) => !('tom' in l))).toBe(true);
  });
  it('RN-VEN-42 (RD-0083): disponível negativo sai só com o sinal − (U+2212), sem vermelho: o alerta é o de crédito excedido', () => {
    const t = tabelaDoCredito({ tipo: 'dados', limite_cents: 1000000, disponivel_cents: -120000, alerta: null });
    expect(t.linhas[1]!.valor).toMatch(/^−R\$\s1\.200,00$/);
    expect(t.linhas.every((l) => !('tom' in l))).toBe(true);
  });
  it('RN-VEN-12: cliente sem dados de crédito mostra travessão em Limite e Disponível e sem frase (RD-0178)', () => {
    const t = tabelaDoCredito({ tipo: 'vazio' });
    expect(t.estado).toBe('tabela');
    expect(t.linhas.map((l) => l.valor)).toEqual(['—', '—']);
    expect(t).not.toHaveProperty('apoio');
  });
  it('RN-VEN-12: lendo do aparelho (undefined) são barras, nunca R$ 0,00; consulta indisponível (null) fica com "—", sem frase (RD-0178)', () => {
    expect(tabelaDoCredito(undefined)).toMatchObject({ estado: 'carregando' });
    const i = tabelaDoCredito(null);
    expect(i.estado).toBe('tabela');
    expect(i.linhas.map((l) => l.valor)).toEqual(['—', '—']);
  });
});

describe('linha Obs. do Resumo (RF-VEN-11, T-0137)', () => {
  it('RF-VEN-11: observação vazia vira "—"', () => {
    expect(linhaDaObsNoResumo(undefined)).toBe('—');
    expect(linhaDaObsNoResumo(' entregar de manhã ')).toBe('entregar de manhã');
  });
});
