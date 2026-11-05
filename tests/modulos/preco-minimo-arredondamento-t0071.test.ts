/**
 * T-0071 / RN-VEN-11 — o preço mínimo é UM número só para o BKO e para a API (integração entre módulos, funções puras).
 *  - Core (BKO, ficha do produto): `precoMinimoCents` em modules/core/domain/produto-preco.ts — "arredondado para cima ao centavo".
 *  - Vendedor (app e revalidação da API): `precoMinimoBaseCents` em modules/vendedor/domain/preco-pedido.ts — também
 *    arredondado para cima (Math.ceil), por decisão do gerente (RN-VEN-11 no doc 03).
 * Quando a conta não fecha em centavo inteiro (ex.: 1891 × 0,85 = 1607,35), os dois dão 1608: o BKO mostra o mesmo mínimo que a API cobra.
 *
 * Convenção: `it` = vale hoje; `it.fails` = defeito aberto (fica vermelho quando corrigir e vira `it`).
 * Defeito D-T0071-C6r corrigido (R-20261105-125015-modulo-vendedor); o C6r-1 fixa a equivalência. Matriz: docs/testes/T-0071.md (C6r).
 */
import { describe, expect, it } from 'vitest';
import { descontoMaximoAplicavel, precoMinimoCents } from '../../modules/core/domain/produto-preco';
import { precoMinimoBaseCents } from '../../modules/vendedor/domain/preco-pedido';

const casos: Array<{ venda: number; desconto: number }> = [
  { venda: 1890, desconto: 15 }, // Café da demo: 1606,5
  { venda: 1891, desconto: 15 }, // 1607,35
  { venda: 999, desconto: 15 }, // 849,15
  { venda: 1234, desconto: 7.5 }, // 1141,45
  { venda: 2000, desconto: 10 }, // exato: 1800
  { venda: 1001, desconto: 33.33 }, // 667,3667
];

describe('RN-VEN-11 — preço mínimo igual no Core (BKO) e no Vendedor (app/API)', () => {
  it('C6r-0. contas exatas e o Café da demo coincidem: 2000 × 0,90 = 1800; 1890 × 0,85 = 1607 nos dois', () => {
    expect(precoMinimoCents(2000, 10)).toBe(1800);
    expect(precoMinimoBaseCents({ preco_venda_cents: 2000, desconto_maximo_pct: 10 })).toBe(1800);
    expect(precoMinimoCents(1890, null)).toBe(1607);
    expect(precoMinimoBaseCents({ preco_venda_cents: 1890, desconto_maximo_pct: descontoMaximoAplicavel(null) })).toBe(1607);
  });

  it('C6r-0b. sem preço de venda o Vendedor não trava (null)', () => {
    expect(precoMinimoBaseCents({ preco_venda_cents: null, desconto_maximo_pct: 15 })).toBeNull();
  });

  // D-T0071-C6r corrigido: os dois arredondam para cima; este caso impede que voltem a divergir abaixo da metade do centavo.
  it('C6r-1. para todo preço de venda e desconto, o mínimo do BKO = o mínimo que a API cobra', () => {
    for (const c of casos) {
      expect(precoMinimoBaseCents({ preco_venda_cents: c.venda, desconto_maximo_pct: c.desconto }), `${c.venda} com ${c.desconto}%`).toBe(precoMinimoCents(c.venda, c.desconto));
    }
  });
});
