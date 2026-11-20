/**
 * RN-VEN-44 (T-0188): na troca de prazo o item mantém o preço final, a tabela vira a original ajustada pelo % novo
 * (RN-VEN-43) e o desconto ou acréscimo do item é refeito a partir do preço final. O preço congelado do orçamento
 * (RN-VEN-18) só vale no prazo em que foi gravado.
 */
import { describe, expect, it } from 'vitest';

import { precoUnitarioFinal } from './preco-pedido';
import { ajusteMantendoPrecoFinal, ajustesNaTrocaDePrazo, percentualDoPrazoNoDocumento, precoDoItemNoPrazo } from './troca-prazo';

describe('RN-VEN-44: ajusteMantendoPrecoFinal', () => {
  it('RN-VEN-44: tabela sobe → o desconto do item aumenta e o final fica igual', () => {
    // tabela 10 000 com 5% de desconto = 9 500; prazo +2,50% → tabela 10 250
    const a = ajusteMantendoPrecoFinal(10_250, 9_500);
    expect(a).toEqual({ sentido: 'desconto', em: 'valor', cents: 750 });
    expect(precoUnitarioFinal(10_250, a)).toBe(9_500);
  });

  it('RN-VEN-44: tabela cai abaixo do final → o desconto vira acréscimo', () => {
    // final 9 900 (1% de desconto sobre 10 000); prazo -1,71% → tabela 9 829
    const a = ajusteMantendoPrecoFinal(9_829, 9_900);
    expect(a).toEqual({ sentido: 'acrescimo', em: 'valor', cents: 71 });
    expect(precoUnitarioFinal(9_829, a)).toBe(9_900);
  });

  it('RN-VEN-44: final igual à tabela nova → sem ajuste', () => {
    expect(ajusteMantendoPrecoFinal(9_829, 9_829)).toBeNull();
  });

  it('RN-VEN-44: valores inválidos são erro', () => {
    expect(() => ajusteMantendoPrecoFinal(10_000, -1)).toThrow('RN-VEN-44');
    expect(() => ajusteMantendoPrecoFinal(10_000, 1.5)).toThrow('RN-VEN-44');
    expect(() => ajusteMantendoPrecoFinal(-1, 100)).toThrow('RN-VEN-44');
  });
});

describe('RN-VEN-44: ajustesNaTrocaDePrazo', () => {
  it('RN-VEN-44: cada linha mantém o preço final do prazo anterior sobre a tabela do prazo novo', () => {
    const antes = [
      { chave: 'a', preco_tabela_cents: 10_000, preco_unitario_cents: 9_500 },
      { chave: 'b', preco_tabela_cents: 2_000, preco_unitario_cents: 2_000 },
    ];
    const depois = [
      { chave: 'a', preco_tabela_cents: 10_250 },
      { chave: 'b', preco_tabela_cents: 2_050 },
    ];
    expect(ajustesNaTrocaDePrazo(antes, depois)).toEqual({
      a: { sentido: 'desconto', em: 'valor', cents: 750 },
      b: { sentido: 'desconto', em: 'valor', cents: 50 },
    });
  });

  it('RN-VEN-44: linha que só existe de um lado (sem preço, medida fora) fica de fora', () => {
    expect(ajustesNaTrocaDePrazo([{ chave: 'a', preco_unitario_cents: 90 }], [{ chave: 'b', preco_tabela_cents: 100 }])).toEqual({});
  });
});

describe('RN-VEN-44/18: precoDoItemNoPrazo', () => {
  it('RN-VEN-18: item novo entra pelo preço de hoje, com as faixas e o % do prazo', () => {
    expect(precoDoItemNoPrazo({ hoje_cents: 1_000, faixas_hoje: ['f'], percentual_ajuste_bp: -171 })).toEqual({ preco_unidade_cents: 1_000, faixas: ['f'], congelado: false, percentual_ajuste_bp: -171 });
  });

  it('RN-VEN-18: no prazo em que foi gravado, o preço congelado vale como está, sem faixa e sem ajustar de novo', () => {
    expect(precoDoItemNoPrazo({ congelado_cents: 983, congelado_bp: -171, hoje_cents: 1_200, faixas_hoje: ['f'], percentual_ajuste_bp: -171 })).toEqual({ preco_unidade_cents: 983, faixas: undefined, congelado: true, percentual_ajuste_bp: 0 });
  });

  it('RN-VEN-44: em outro prazo, o item volta à tabela original do produto ajustada pelo % novo', () => {
    expect(precoDoItemNoPrazo({ congelado_cents: 983, congelado_bp: -171, hoje_cents: 1_000, percentual_ajuste_bp: 250 })).toEqual({ preco_unidade_cents: 1_000, faixas: undefined, congelado: false, percentual_ajuste_bp: 250 });
  });

  it('RN-VEN-18: sem o prazo do congelado (rascunho antigo), o congelado vale em qualquer prazo', () => {
    expect(precoDoItemNoPrazo({ congelado_cents: 983, hoje_cents: 1_000, percentual_ajuste_bp: 250 }).congelado).toBe(true);
  });
});

describe('percentualDoPrazoNoDocumento (RN-VEN-43/44/45)', () => {
  const gravado = { prazo_id: 'p30', percentual: -1.71 };
  it('RN-VEN-45: no prazo em que foi gravado vale o % gravado, mesmo que o ERP tenha mudado', () => {
    expect(percentualDoPrazoNoDocumento({ prazo_id: 'p30', vigente: 2.5, gravado })).toBe(-1.71);
  });
  it('RN-VEN-44: em outro prazo vale o vigente', () => {
    expect(percentualDoPrazoNoDocumento({ prazo_id: 'p60', vigente: 2.5, gravado })).toBe(2.5);
  });
  it('RN-VEN-45: % gravado 0 vale, não cai no vigente', () => {
    expect(percentualDoPrazoNoDocumento({ prazo_id: 'p30', vigente: 2.5, gravado: { prazo_id: 'p30', percentual: 0 } })).toBe(0);
  });
  it('RN-VEN-45: sem retrato gravado vale o vigente', () => {
    expect(percentualDoPrazoNoDocumento({ prazo_id: 'p30', vigente: 2.5 })).toBe(2.5);
    expect(percentualDoPrazoNoDocumento({ prazo_id: 'p30', vigente: 2.5, gravado: { prazo_id: 'p30', percentual: null } })).toBe(2.5);
  });
  it('RN-VEN-14: sem prazo o % é 0', () => {
    expect(percentualDoPrazoNoDocumento({ prazo_id: null, vigente: null, gravado })).toBe(0);
  });
});
