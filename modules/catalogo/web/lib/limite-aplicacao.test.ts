import { describe, expect, it } from 'vitest';
import { estadoDoLimiteAplicacao } from './limite-aplicacao';

describe('painel Catálogo (RN-CAT-11): limite da Aplicação', () => {
  it('RN-CAT-11: sem mudança o Salvar fica desligado e não há erro (salvar só no painel alterado)', () => {
    expect(estadoDoLimiteAplicacao('2000', 2000)).toEqual({ valor: 2000, erro: undefined, podeSalvar: false });
    expect(estadoDoLimiteAplicacao(null, 800)).toEqual({ valor: 800, erro: undefined, podeSalvar: false });
  });

  it('RN-CAT-11: número de 100 a 2.000 diferente do salvo liga o Salvar', () => {
    for (const t of ['100', '1500', ' 2000 ']) expect(estadoDoLimiteAplicacao(t, 500).podeSalvar, t).toBe(t.trim() !== '500');
    expect(estadoDoLimiteAplicacao('1.500', 500)).toMatchObject({ valor: 1500, podeSalvar: true });
  });

  it('RN-CAT-11: decimal com vírgula ou vazio mostra erro e desliga o Salvar', () => {
    for (const t of ['10,5', '']) {
      const e = estadoDoLimiteAplicacao(t, 500);
      expect(e.podeSalvar, t).toBe(false);
      expect(e.erro, t).toBeDefined();
    }
  });
});
