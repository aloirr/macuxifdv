import { describe, expect, it } from 'vitest';

import { ajusteDoItemEmPct, linhasDosTotais, ROTULO_VALOR_FINAL } from './apresentacao-totais';

const limpo = (s: string) => s.replace(/[\u00A0\u202F]/g, ' ');

describe('RN-VEN-03 (T-0165, R-20261112-032141): os Totais em linhas separadas', () => {
  it('RN-VEN-03: com desconto, Valor de tabela · Desconto (%) · Desconto (R$); o % sai dos centavos (22.386 − 1.364 = 6,1%)', () => {
    const l = linhasDosTotais({ subtotal_cents: 22_386, total_cents: 22_386 - 1_364 });
    expect(l.map((x) => [x.rotulo, limpo(x.valor)])).toEqual([
      ['Valor de tabela', 'R$ 223,86'],
      ['Desconto (%)', '6,1%'],
      ['Desconto (R$)', '− R$ 13,64'],
    ]);
    expect(ROTULO_VALOR_FINAL).toBe('Valor final');
  });

  it('RN-VEN-03: com acréscimo, as linhas são Acréscimo (%) e Acréscimo (R$), com sinal +', () => {
    const l = linhasDosTotais({ subtotal_cents: 10_000, total_cents: 10_500 });
    expect(l.map((x) => x.rotulo)).toEqual(['Valor de tabela', 'Acréscimo (%)', 'Acréscimo (R$)']);
    expect(l[1]?.valor).toBe('5,0%');
    expect(l[2]?.valor.startsWith('+ ')).toBe(true);
  });

  it('RN-VEN-03: sem ajuste nenhuma linha aparece (só o Valor final)', () => {
    expect(linhasDosTotais({ subtotal_cents: 10_000, total_cents: 10_000 })).toEqual([]);
  });

  it('RN-VEN-02 (T-0165): a coluna Desc./Acrésc. é sempre em % com 1 casa: −5,0%, +10,0%, 0,0%', () => {
    expect(ajusteDoItemEmPct({ discount_pct: 5 })).toBe('−5,0%');
    expect(ajusteDoItemEmPct({ surcharge_pct: 10 })).toBe('+10,0%');
    expect(ajusteDoItemEmPct({})).toBe('0,0%');
  });
});
