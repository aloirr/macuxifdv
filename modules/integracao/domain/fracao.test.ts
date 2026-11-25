import { describe, expect, it } from 'vitest';
import { CODIGO_FRACAO_BLOQUEADA, CODIGO_FRACAO_INVALIDA, MENSAGEM_FRACAO_BLOQUEADA } from '@macuxi/platform-sdk';
import { avaliarFracaoLote, avaliarFracaoRetorno, itemPedidoTemFracao } from './fracao';
import { VERSAO_CONECTOR_FRACAO, VERSAO_CONECTOR_FILIAL, exigeConector } from './pedido-versao';

const item = (o: Record<string, unknown> = {}) => ({ sequencia: 1, produto_external_id: 'P1', quantidade: 2, preco_unitario_cents: 100, desconto_cents: 0, total_cents: 200, ...o }) as never;

describe('ADR 0076 / RN-VEN-02 v3: fração no Conector (exigeConector)', () => {
  it('RN-VEN-02 v3: pedido com quantidade fracionária exige o Conector 1.6.0', () => {
    expect(VERSAO_CONECTOR_FRACAO).toBe('1.6.0');
    expect(exigeConector({ itens: [item({ quantidade: 1.25, unidade: 'KG' })] })).toBe('1.6.0');
  });
  it('RN-VEN-15: fator ou quantidade_venda fracionários também exigem o 1.6.0', () => {
    expect(exigeConector({ itens: [item({ fator: 12.5, unidade: 'CX' })] })).toBe('1.6.0');
    expect(exigeConector({ itens: [item({ quantidade_venda: 0.5, fator: 1 })] })).toBe('1.6.0');
  });
  it('ADR 0076 D6: a exigência maior vence a da filial (1.4.0)', () => {
    expect(exigeConector({ itens: [item({ quantidade: 1.5 })], filial: { padrao: false } } as never)).toBe('1.6.0');
    expect(exigeConector({ itens: [item()], filial: { padrao: false } } as never)).toBe(VERSAO_CONECTOR_FILIAL);
  });
  it('RN-VEN-02 v3: quantidade inteira não muda a exigência de hoje', () => {
    expect(exigeConector({ itens: [item({ quantidade: 3.0 })] })).toBeNull();
    expect(exigeConector({ itens: [item({ fator: 12 })] })).toBe('1.3.0');
  });
  it('RN-VEN-02 v3: itemPedidoTemFracao olha quantidade, quantidade_venda e fator', () => {
    expect(itemPedidoTemFracao({ quantidade: 1, fator: 0.5 })).toBe(true);
    expect(itemPedidoTemFracao({ quantidade: 1, quantidade_venda: null, fator: null })).toBe(false);
  });
});

describe('ADR 0076 D6: trava no lote (produto_unidade.fator)', () => {
  const reg = (fator: number) => ({ external_id: 'x', fator });
  it('trava fechada: fator fracionário vira 422 quantidade_fracionaria_bloqueada, um erro por registro', () => {
    const r = avaliarFracaoLote('produto_unidade', [reg(12), reg(12.5), reg(0.5)], false);
    expect(r).toMatchObject({ ok: false, status: 422, codigo: CODIGO_FRACAO_BLOQUEADA, mensagem: MENSAGEM_FRACAO_BLOQUEADA });
    if (!r.ok) expect(r.erros.map((e) => e.campo)).toEqual(['registros[1].fator', 'registros[2].fator']);
  });
  it('trava aberta: fator fracionário passa', () => {
    expect(avaliarFracaoLote('produto_unidade', [reg(12.5)], true)).toEqual({ ok: true });
  });
  it('RN-VEN-15: fator com mais de 4 casas é 422 quantidade_fracionaria_invalida, com a trava aberta ou fechada', () => {
    for (const liberada of [true, false]) {
      expect(avaliarFracaoLote('produto_unidade', [reg(1.23456)], liberada)).toMatchObject({ ok: false, status: 422, codigo: CODIGO_FRACAO_INVALIDA });
    }
  });
  it('outras entidades e fator inteiro não são afetados', () => {
    expect(avaliarFracaoLote('produto', [{ fator: 1.5 }], false)).toEqual({ ok: true });
    expect(avaliarFracaoLote('produto_unidade', [reg(12), { external_id: 'sem fator' }, null], false)).toEqual({ ok: true });
  });
});

describe('ADR 0076 D6: trava no retorno (itens_faturados[].quantidade)', () => {
  const f = (quantidade: number) => ({ sequencia: 1, produto_external_id: 'P1', quantidade, valor_cents: 100 });
  it('trava fechada: quantidade faturada fracionária é 422 quantidade_fracionaria_bloqueada', () => {
    const r = avaliarFracaoRetorno([f(1), f(1.25)], false);
    expect(r).toMatchObject({ ok: false, status: 422, codigo: CODIGO_FRACAO_BLOQUEADA });
    if (!r.ok) expect(r.erros[0]).toMatchObject({ codigo: CODIGO_FRACAO_BLOQUEADA, campo: 'itens_faturados[1].quantidade' });
  });
  it('trava aberta: passa', () => {
    expect(avaliarFracaoRetorno([f(1.25)], true)).toEqual({ ok: true });
    expect(avaliarFracaoRetorno(undefined, false)).toEqual({ ok: true });
  });
  it('RN-VEN-02 v3: mais de 4 casas é 422 quantidade_fracionaria_invalida', () => {
    expect(avaliarFracaoRetorno([f(1.00001)], true)).toMatchObject({ ok: false, codigo: CODIGO_FRACAO_INVALIDA });
  });
});
