import { describe, expect, it, vi } from 'vitest';
import { ConsultaIndisponivel } from '@macuxi/platform-sdk';
import { buscaProdutosOnline, portaDaCarga, precosClienteOnline, textosProdutoOnline } from './consultas-online';
import type { PortaCargaOnline } from './carga-online';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CLI = '33333333-3333-4333-8333-333333333333';
const preco = (id: string, cents: number | null) => ({ product_id: id, price_cents: cents, price_table_id: cents === null ? null : CLI, sellable: cents !== null, notice: cents === null ? 'Sem preço para este cliente.' : null });
const porta = (get: PortaCargaOnline['get'], o: Partial<PortaCargaOnline> = {}): PortaCargaOnline => ({ pendentes: () => ['catalogo_precos'], online: () => true, get, ...o });

describe('consultas do Catálogo durante a carga (ADR 0054)', () => {
  it('RF-CAT-01: pendente sem sinal = ConsultaIndisponivel com o texto de carregando; sem pendência = local', () => {
    expect(() => portaDaCarga('catalogo.busca_produtos@1', porta(vi.fn(), { online: () => false }))).toThrow(ConsultaIndisponivel);
    expect(portaDaCarga('x', porta(vi.fn(), { pendentes: () => [] }))).toBeNull();
    expect(portaDaCarga('x', null)).toBeNull();
  });

  it('RN-CAT-06: busca_produtos manda customer_id e descarta o que o cliente não pode comprar', async () => {
    const get = vi.fn().mockResolvedValue({ items: [{ id: A, score: 1, price: preco(A, 100) }, { id: B, price: preco(B, null) }], total: 2, next_offset: null });
    const r = await buscaProdutosOnline(porta(get), { q: 'tinta', cliente_id: CLI, limite: 100 });
    expect(get).toHaveBeenCalledWith('/v1/catalogo/busca', { q: 'tinta', customer_id: CLI, limit: 50, offset: 0 });
    expect(r.itens.map((i) => i.produto_id)).toEqual([A]);
    expect(r.total).toBe(1);
  });

  it('RF-CAT-01: busca_produtos com produto_ids recorta ao seletor', async () => {
    const get = vi.fn().mockResolvedValue({ items: [{ id: A, price: null }, { id: B, price: null }], total: 2, next_offset: null });
    const r = await buscaProdutosOnline(porta(get), { q: 'tinta', produto_ids: [B], limite: 100 });
    expect(r.itens.map((i) => i.produto_id)).toEqual([B]);
  });

  it('RF-CAT-01: falha da API em busca_produtos vira ConsultaIndisponivel (plano B do Vendedor)', async () => {
    await expect(buscaProdutosOnline(porta(vi.fn().mockRejectedValue(new Error('x'))), { q: 'tinta', limite: 10 })).rejects.toBeInstanceOf(ConsultaIndisponivel);
  });

  it('RN-CAT-06: precos_cliente traz o preço do cliente da ficha e o motivo quando não há', async () => {
    const get = vi.fn().mockImplementation(async (c: string) => ({ product: { id: c.endsWith(A) ? A : B, price: c.endsWith(A) ? preco(A, 1990) : preco(B, null) } }));
    const r = await precosClienteOnline(porta(get), { cliente_id: CLI, produto_ids: [A, B], em: '2026-11-15T12:00:00.000Z' });
    expect(r.tabela_preco_id).toBe(CLI);
    expect(r.itens).toEqual([
      { produto_id: A, preco_cents: 1990, motivo_sem_preco: null },
      { produto_id: B, preco_cents: null, motivo_sem_preco: 'Sem preço para este cliente.' },
    ]);
  });

  it('RN-CAT-05: perfil sem preço (price nulo na API) = sem preço e sem motivo, nunca preço inventado', async () => {
    const get = vi.fn().mockResolvedValue({ product: { id: A, price: null } });
    const r = await precosClienteOnline(porta(get), { cliente_id: CLI, produto_ids: [A], em: '2026-11-15T12:00:00.000Z' });
    expect(r).toEqual({ tabela_preco_id: null, itens: [{ produto_id: A, preco_cents: null, motivo_sem_preco: null }] });
  });

  it('RN-CAT-09: textos_produto traz aplicação e referências da ficha', async () => {
    const ref = { marca_id: A, marca_nome: 'Acme', codigo: 'X1' };
    const get = vi.fn().mockResolvedValue({ product: { id: A }, catalogo: { aplicacao: 'Gol 2010', referencias: [ref], oferece_junto: [], etiquetas: [] } });
    const r = await textosProdutoOnline(porta(get), { produto_ids: [A] });
    expect(r.itens).toEqual([{ produto_id: A, aplicacao: 'Gol 2010', referencias: [ref] }]);
  });
});
