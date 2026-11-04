import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PrecosClienteSaidaSchema, type ItemTabelaPreco } from '../contracts';
import { dataDoPreco, MOTIVO_PERFIL_SEM_PRECO, precosDoCliente } from './precos-cliente';
import { MENSAGEM_SEM_PRECO_CLIENTE } from './preco';

const T = '0a000000-0000-4000-8000-000000000001';
const P1 = '0b000000-0000-4000-8000-000000000001';
const P2 = '0b000000-0000-4000-8000-000000000002';
const AGORA = '2026-11-01T12:00:00.000Z';
const item = (p: string, cents: number, extra: Partial<ItemTabelaPreco> = {}): ItemTabelaPreco => ({ price_table_id: T, product_id: p, price_cents: cents, ...extra });
const base = { tabelaId: T, itens: [item(P1, 1000)], agora: AGORA, em: AGORA, verPreco: true };

describe('catalogo.precos_cliente@1 (domain)', () => {
  it('RN-CAT-06: preço vem da tabela do cliente', () => {
    expect(precosDoCliente({ ...base, produtoIds: [P1] })).toEqual({ tabela_preco_id: T, itens: [{ produto_id: P1, preco_cents: 1000, motivo_sem_preco: null }] });
  });

  it('RN-CAT-06: item fora da tabela do cliente = sem preço, sem cair na tabela padrão', () => {
    const r = precosDoCliente({ ...base, produtoIds: [P1, P2], itens: [item(P1, 1000), { price_table_id: null, product_id: P2, price_cents: 500 }] });
    expect(r.itens[1]).toEqual({ produto_id: P2, preco_cents: null, motivo_sem_preco: MENSAGEM_SEM_PRECO_CLIENTE });
    expect(MENSAGEM_SEM_PRECO_CLIENTE).toBe('Sem preço para este cliente.');
  });

  it('RN-CAT-06: cliente sem tabela ativa = todo item sem preço', () => {
    const r = precosDoCliente({ ...base, tabelaId: null, produtoIds: [P1] });
    expect(r).toEqual({ tabela_preco_id: null, itens: [{ produto_id: P1, preco_cents: null, motivo_sem_preco: MENSAGEM_SEM_PRECO_CLIENTE }] });
  });

  it('RN-CAT-05: perfil sem direito (promotor) não recebe preço nem a tabela', () => {
    const r = precosDoCliente({ ...base, verPreco: false, produtoIds: [P1] });
    expect(r).toEqual({ tabela_preco_id: null, itens: [{ produto_id: P1, preco_cents: null, motivo_sem_preco: MOTIVO_PERFIL_SEM_PRECO }] });
  });

  it('RN-CAT-06: vale a vigência na data informada (início inclusivo, fim exclusivo)', () => {
    const itens = [
      item(P1, 900, { valid_from: '2026-10-01T00:00:00.000Z', valid_to: '2026-10-30T00:00:00.000Z' }),
      item(P1, 1100, { valid_from: '2026-10-30T00:00:00.000Z' }),
    ];
    const em = (iso: string) => precosDoCliente({ ...base, itens, produtoIds: [P1], em: iso, agora: '2026-11-02T00:00:00.000Z' }).itens[0]!.preco_cents;
    expect(em('2026-10-29T23:59:59.000Z')).toBe(900);
    expect(em('2026-10-30T00:00:00.000Z')).toBe(1100);
  });

  it('P-4: a data do preço recua no máximo 7 dias e nunca vai ao futuro', () => {
    expect(dataDoPreco('2026-10-01T00:00:00.000Z', AGORA)).toBe('2026-10-25T12:00:00.000Z');
    expect(dataDoPreco('2026-11-05T00:00:00.000Z', AGORA)).toBe(AGORA);
    expect(dataDoPreco('2026-10-30T08:00:00.000Z', AGORA)).toBe('2026-10-30T08:00:00.000Z');
  });

  it('P-4: preço antigo fora dos 7 dias não vale (usa a data limitada)', () => {
    const itens = [item(P1, 800, { valid_to: '2026-10-20T00:00:00.000Z' }), item(P1, 1000, { valid_from: '2026-10-20T00:00:00.000Z' })];
    expect(precosDoCliente({ ...base, itens, produtoIds: [P1], em: '2026-10-10T00:00:00.000Z' }).itens[0]!.preco_cents).toBe(1000);
  });

  it('ADR 0012: ids repetidos saem uma vez, na ordem pedida', () => {
    expect(precosDoCliente({ ...base, produtoIds: [P2, P1, P2] }).itens.map((i) => i.produto_id)).toEqual([P2, P1]);
  });
});

describe('catalogo.precos_cliente@1: embalagens[] (RN-VEN-15, T-0071)', () => {
  it('RN-VEN-15: preco_cents vem só da linha sem unidade; a linha CX vai para embalagens[]', () => {
    const itens = [item(P1, 1890, { unit: null }), item(P1, 21546, { unit: 'CX' })];
    const r = precosDoCliente({ ...base, itens, produtoIds: [P1] });
    expect(r.itens[0]).toEqual({ produto_id: P1, preco_cents: 1890, motivo_sem_preco: null, embalagens: [{ unidade: 'CX', preco_cents: 21546 }] });
  });

  it('RN-VEN-15: linha CX mais cara ou mais nova não vira o preço da UN (correção da 🟡)', () => {
    const itens = [item(P1, 1890, { valid_from: '2026-01-01T00:00:00.000Z' }), item(P1, 30000, { unit: 'CX', valid_from: '2026-10-01T00:00:00.000Z' })];
    expect(precosDoCliente({ ...base, itens, produtoIds: [P1] }).itens[0]!.preco_cents).toBe(1890);
  });

  it('RN-VEN-15: só linha com unidade, sem linha base = sem preço (não vendável)', () => {
    const r = precosDoCliente({ ...base, itens: [item(P1, 21546, { unit: 'CX' })], produtoIds: [P1] });
    expect(r.itens[0]).toEqual({ produto_id: P1, preco_cents: null, motivo_sem_preco: MENSAGEM_SEM_PRECO_CLIENTE });
  });

  it('RN-VEN-15: embalagem respeita a vigência em `em`', () => {
    const itens = [item(P1, 1890), item(P1, 21546, { unit: 'CX', valid_from: '2026-12-01T00:00:00.000Z' })];
    expect(precosDoCliente({ ...base, itens, produtoIds: [P1] }).itens[0]).not.toHaveProperty('embalagens');
  });

  it('compatibilidade: sem preço de embalagem a saída é a do consumidor antigo e passa no schema @1', () => {
    const r = precosDoCliente({ ...base, produtoIds: [P1] });
    expect(r.itens[0]).toEqual({ produto_id: P1, preco_cents: 1000, motivo_sem_preco: null });
    expect(PrecosClienteSaidaSchema.parse(r)).toEqual(r);
  });

  it('compatibilidade: o consumidor antigo (schema sem embalagens) ainda lê a saída nova', () => {
    const antigo = z.object({ tabela_preco_id: z.string().nullable(), itens: z.array(z.object({ produto_id: z.string(), preco_cents: z.number().nullable(), motivo_sem_preco: z.string().nullable() })) });
    const r = precosDoCliente({ ...base, itens: [item(P1, 1890), item(P1, 21546, { unit: 'CX' })], produtoIds: [P1] });
    expect(antigo.parse(r).itens[0]).toEqual({ produto_id: P1, preco_cents: 1890, motivo_sem_preco: null });
    expect(PrecosClienteSaidaSchema.parse(r).itens[0]!.embalagens).toEqual([{ unidade: 'CX', preco_cents: 21546 }]);
  });
});
