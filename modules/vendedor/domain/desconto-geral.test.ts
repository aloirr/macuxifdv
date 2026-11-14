import { describe, expect, it } from 'vitest';

import { aplicarGeralNasLinhas, completarComGeral, linhasDiferentesDoGeral, passoDoGeral, perguntaDoGeral, podeAplicarGeral } from './desconto-geral';
import { descontoEfetivoAlcadaPct, nivelDeAprovacao, precoDoItem, totaisDoPedido } from './preco-pedido';

const DESC5 = { sentido: 'desconto' as const, pct: 5 };
const POLITICA = { seller_pct: 5, supervisor_pct: 10, manager_pct: 15, exceptions: [] } as never;

describe('RN-VEN-02 v3 (T-0165): Desc./Acrésc. geral aplica o % a todos os itens', () => {
  it('RN-VEN-02: Aplicar sobrescreve o ajuste de cada item (em % ou em R$) e guarda o resto da linha', () => {
    const r = aplicarGeralNasLinhas(['a', 'b@FD', 'c'], { a: { em: 'valor', desconto_cents: 50 }, 'b@FD': { em: 'pct', acrescimo_pct: 3, aplicacao_marcada: false } as never }, DESC5);
    expect(r['a']).toEqual({ em: 'pct', desconto_pct: 5 });
    expect(r['b@FD']).toEqual({ em: 'pct', desconto_pct: 5, aplicacao_marcada: false });
    expect(r['c']).toEqual({ em: 'pct', desconto_pct: 5 });
  });

  it('RN-VEN-02: o geral em acréscimo grava só acréscimo (excludentes)', () => {
    expect(aplicarGeralNasLinhas(['a'], { a: { desconto_pct: 8 } }, { sentido: 'acrescimo', pct: 3 })['a']).toEqual({ em: 'pct', acrescimo_pct: 3 });
  });

  it('RN-VEN-02: só pergunta quando algum item tem ajuste diferente; item igual ou pedido sem itens aplica direto', () => {
    const ajustes = { a: { em: 'pct' as const, desconto_pct: 5 }, b: { em: 'pct' as const, desconto_pct: 2 }, c: {} };
    expect(linhasDiferentesDoGeral(['a', 'b', 'c'], ajustes, DESC5)).toEqual(['b', 'c']);
    expect(linhasDiferentesDoGeral(['a'], ajustes, DESC5)).toEqual([]);
    expect(linhasDiferentesDoGeral([], ajustes, DESC5)).toEqual([]);
    expect(perguntaDoGeral(DESC5, 0)).toBeNull();
    // desconto em R$ nunca é igual ao geral em %
    expect(linhasDiferentesDoGeral(['a'], { a: { em: 'valor' as const, desconto_cents: 100 } }, DESC5)).toEqual(['a']);
  });

  it('RD-0148: a pergunta é "Trocar o desconto de todos os itens por 5,0%?" com Trocar e Voltar (acréscimo e zero têm o texto certo)', () => {
    expect(perguntaDoGeral(DESC5, 2)).toEqual({ titulo: 'Trocar o desconto de todos os itens por 5,0%?', confirmar: 'Trocar', voltar: 'Voltar' });
    expect(perguntaDoGeral({ sentido: 'acrescimo', pct: 3 }, 1)?.titulo).toBe('Trocar o acréscimo de todos os itens por 3,0%?');
    expect(perguntaDoGeral({ sentido: 'desconto', pct: 0 }, 1)?.titulo).toBe('Tirar o desconto e o acréscimo de todos os itens?');
  });

  it('RN-VEN-02: Aplicar fica desligado com o campo vazio ou quando todos os itens já têm o ajuste; sem itens guarda o %', () => {
    expect(podeAplicarGeral('', 3, false)).toBe(false);
    expect(podeAplicarGeral('5', 0, false)).toBe(false);
    expect(podeAplicarGeral('5', 2, false)).toBe(true);
    expect(podeAplicarGeral('5', 0, true)).toBe(true);
  });

  it('RN-VEN-02: o item adicionado depois entra com o último geral; o que já tem ajuste não muda; sem geral nada muda', () => {
    expect(completarComGeral(['a', 'novo'], { a: { em: 'pct', desconto_pct: 1 } }, DESC5)).toEqual({ a: { em: 'pct', desconto_pct: 1 }, novo: { em: 'pct', desconto_pct: 5 } });
    expect(completarComGeral(['novo'], {}, null)).toEqual({});
    expect(completarComGeral(['novo'], {}, { sentido: 'desconto', pct: 0 })).toEqual({});
  });

  it('RN-VEN-03/10: o desconto efetivo do pedido é a soma dos itens (o geral não cria desconto sobre o total) e a alçada olha esse número', () => {
    // 2 itens de R$ 100,00 (tabela) com o geral de 6%: efetivo = 6,00%, acima da alçada de 5% do vendedor
    const linha = (q: number) => {
      const p = precoDoItem({ preco_tabela_unidade_cents: 10_000, quantidade: q, fator: 1, desconto_pct: 6, acrescimo_pct: 0 });
      return { preco_tabela_cents: p.preco_tabela_cents, quantidade: q, total_cents: p.total_cents, desconto_pct: 6, acrescimo_pct: 0 };
    };
    const linhas = [linha(1), linha(1)];
    expect(descontoEfetivoAlcadaPct(linhas, null)).toBe(6);
    const t = totaisDoPedido(linhas, null);
    expect(t.total_tabela_cents).toBe(20_000);
    expect(t.total_cents).toBe(18_800);
    expect(nivelDeAprovacao(descontoEfetivoAlcadaPct(linhas, null), POLITICA)).toBe('supervisor');
    expect(nivelDeAprovacao(5, POLITICA)).toBeNull();
  });
});

describe('RD-0148 (T-0165): a pergunta do Aplicar só vem quando um item tem OUTRO ajuste', () => {
  it('RN-VEN-02: itens sem ajuste não fazem perguntar; item com outro desconto ou em R$ faz', async () => {
    const { linhasComOutroAjuste } = await import('./desconto-geral');
    expect(linhasComOutroAjuste(['a', 'b'], {}, DESC5)).toEqual([]);
    expect(linhasComOutroAjuste(['a', 'b'], { a: { em: 'pct', desconto_pct: 5 } }, DESC5)).toEqual([]);
    expect(linhasComOutroAjuste(['a', 'b'], { a: { em: 'pct', desconto_pct: 3 } }, DESC5)).toEqual(['a']);
    expect(linhasComOutroAjuste(['a', 'b'], { b: { em: 'valor', desconto_cents: 50 } }, DESC5)).toEqual(['b']);
  });
});

describe('RN-VEN-02 (dono do produto, 14/11): o − e o + do Desc./Acrésc. geral', () => {
  it('RN-VEN-02: em %, o passo é 1 ponto percentual e mantém as casas digitadas (5 → 6, 5,5 → 4,5)', () => {
    expect(passoDoGeral(5, 1, 'pct')).toBe(6);
    expect(passoDoGeral(5.5, -1, 'pct')).toBe(4.5);
    expect(passoDoGeral(0, 1, 'pct')).toBe(1);
  });

  it('RN-VEN-02: em R$, o passo é R$ 1,00 (100 centavos)', () => {
    expect(passoDoGeral(250, 1, 'valor')).toBe(350);
    expect(passoDoGeral(250, -1, 'valor')).toBe(150);
  });

  it('RN-VEN-02: nunca abaixo de 0 e, em %, nunca acima de 100', () => {
    expect(passoDoGeral(0.5, -1, 'pct')).toBe(0);
    expect(passoDoGeral(0, -1, 'pct')).toBe(0);
    expect(passoDoGeral(50, -1, 'valor')).toBe(0);
    expect(passoDoGeral(99.5, 1, 'pct')).toBe(100);
    expect(passoDoGeral(Number.NaN, 1, 'pct')).toBe(1);
  });
});
