import { describe, expect, it } from 'vitest';
import { MOTIVO_SEM_PRECO, produtoNoRascunho } from './produto-no-rascunho';

const prod = (id: string, price_cents: number | null) => ({ id, description: `Prod ${id}`, price_cents });
const vazio = { lines: {} as Record<string, number> };

describe('RN-VEN-49: produto do Catálogo entra no pedido em curso com 1 unidade e o preço normal', () => {
  it('RN-VEN-49: produto novo entra com quantidade 1', () => {
    const r = produtoNoRascunho(vazio, 'p1', [prod('p1', 1000)]);
    expect(r.resultado).toBe('adicionado');
    expect(r.rascunho.lines).toEqual({ p1: 1 });
  });
  it('RN-VEN-49: produto que já está no pedido soma 1', () => {
    expect(produtoNoRascunho({ lines: { p1: 3 } }, 'p1', [prod('p1', 1000)]).rascunho.lines).toEqual({ p1: 4 });
  });
  it('RN-VEN-49: em embalagem (produto@CX) soma 1 na linha existente, sem criar linha nova', () => {
    const r = produtoNoRascunho({ lines: { 'p1@CX': 2, p2: 1 } }, 'p1', [prod('p1', 1000)]);
    expect(r.resultado).toBe('somado');
    expect(r.rascunho.lines).toEqual({ 'p1@CX': 3, p2: 1 });
  });
  it('RN-VEN-49 / RN-CAT-06: entra sem desconto nem acréscimo (preço normal da tabela do cliente)', () => {
    const base = { lines: {}, ajustes: { x: { desconto_pct: 5 } } } as { lines: Record<string, number>; ajustes: Record<string, unknown> };
    const r = produtoNoRascunho(base, 'p1', [prod('p1', 1000)]);
    expect(r.rascunho.ajustes).toEqual(base.ajustes);
    expect(Object.keys(r.rascunho.ajustes)).not.toContain('p1');
  });
  it('RN-VEN-49 / RN-CAT-06: produto sem preço para o cliente é recusado com o motivo numa linha', () => {
    const r = produtoNoRascunho(vazio, 'p1', [prod('p1', null)]);
    expect(r.resultado).toBe('sem_preco');
    expect(r.rascunho.lines).toEqual({});
    expect(r.motivo).toBe(MOTIVO_SEM_PRECO('Prod p1'));
    expect(r.motivo).not.toContain('\n');
  });
  it('RN-VEN-49: produto fora da tabela do cliente é recusado', () => {
    const r = produtoNoRascunho(vazio, 'p9', [prod('p1', 1000)]);
    expect(r.resultado).toBe('nao_encontrado');
    expect(r.motivo).toBeTruthy();
  });
});
