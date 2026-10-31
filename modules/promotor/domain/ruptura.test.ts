import { describe, expect, it } from 'vitest';
import { classificarPresenca, quantidadeRepostaValida, resumirRuptura, type StatusPresenca } from './ruptura';

const itens = (...s: StatusPresenca[]) => s.map((status) => ({ status }));

describe('RN-PRO-05 / RF-PRO-06: presença e ruptura do mix obrigatório', () => {
  it('RF-PRO-06: item na gôndola = presente', () => {
    expect(classificarPresenca({ na_gondola: true, no_deposito: null })).toBe('presente');
    expect(classificarPresenca({ na_gondola: true, no_deposito: false })).toBe('presente');
  });

  it('RF-PRO-06: fora da gôndola com produto no depósito = ruptura na gôndola (falha de reposição)', () => {
    expect(classificarPresenca({ na_gondola: false, no_deposito: true })).toBe('ruptura_gondola');
  });

  it('RF-PRO-06: fora da gôndola e sem produto no depósito = ruptura total', () => {
    expect(classificarPresenca({ na_gondola: false, no_deposito: false })).toBe('ruptura_total');
  });

  it('RF-PRO-06: fora da gôndola sem conferir o depósito não classifica (exige a resposta)', () => {
    expect(() => classificarPresenca({ na_gondola: false, no_deposito: null })).toThrow(/depósito/);
  });

  it('RN-PRO-05: ruptura (%) = itens do mix em ruptura ÷ itens do mix × 100', () => {
    const r = resumirRuptura(itens('presente', 'presente', 'presente', 'presente', 'presente', 'presente', 'ruptura_total', 'ruptura_total', 'ruptura_gondola', 'presente'));
    expect(r.total).toBe(10);
    expect(r.em_ruptura).toBe(3);
    expect(r.ruptura_pct).toBe(30);
  });

  it('RN-PRO-05: ruptura na gôndola com produto no depósito é contada à parte (falha de reposição)', () => {
    const r = resumirRuptura(itens('presente', 'presente', 'ruptura_gondola', 'ruptura_total'));
    expect(r.ruptura_gondola).toBe(1);
    expect(r.ruptura_total).toBe(1);
    expect(r.falha_reposicao_pct).toBe(25);
    expect(r.ruptura_total_pct).toBe(25);
    expect(r.ruptura_pct).toBe(50);
  });

  it('RN-PRO-05: opção para tirar a falha de reposição do % de ruptura (só ruptura total)', () => {
    const r = resumirRuptura(itens('presente', 'presente', 'ruptura_gondola', 'ruptura_total'), { incluirFalhaDeReposicao: false });
    expect(r.ruptura_pct).toBe(25);
    expect(r.falha_reposicao_pct).toBe(25);
  });

  it('RN-PRO-05: mix vazio não divide por zero', () => {
    const r = resumirRuptura([]);
    expect(r).toMatchObject({ total: 0, ruptura_pct: null, falha_reposicao_pct: null, ruptura_total_pct: null, quantidade_reposta: 0 });
  });

  it('RF-PRO-06: soma a quantidade reposta pelo promotor', () => {
    const r = resumirRuptura([
      { status: 'ruptura_gondola', quantidade_reposta: 12 },
      { status: 'presente', quantidade_reposta: 6 },
      { status: 'ruptura_total' },
    ]);
    expect(r.quantidade_reposta).toBe(18);
  });

  it('RF-PRO-06: quantidade reposta é inteira ≥ 0 e só existe quando há produto (ruptura total = 0)', () => {
    expect(quantidadeRepostaValida('ruptura_gondola', 12)).toBe(true);
    expect(quantidadeRepostaValida('presente', 0)).toBe(true);
    expect(quantidadeRepostaValida('presente', -1)).toBe(false);
    expect(quantidadeRepostaValida('presente', 1.5)).toBe(false);
    expect(quantidadeRepostaValida('ruptura_total', 0)).toBe(true);
    expect(quantidadeRepostaValida('ruptura_total', 3)).toBe(false);
  });
});
