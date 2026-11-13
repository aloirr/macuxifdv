import { describe, expect, it } from 'vitest';
import { ConsultaIndisponivel, type ClienteBanco } from '@macuxi/platform-sdk';
import { definirProvedorSaldoDaFilial, faltaDeEstoqueNaFilial, provedorDaTransacao, provedorSaldoDaFilial, reservadoNaFilial } from './estoque-filial';

const F = 'aaaaaaaa-0000-4000-8000-000000000002';
const P1 = 'bbbbbbbb-0000-4000-8000-000000000001';

/** Banco falso: devolve as linhas de reserva e guarda os parâmetros da consulta. */
function bancoComReserva(reservado: number | null) {
  const chamadas: unknown[][] = [];
  const db = {
    query: async (_sql: string, params: unknown[]) => {
      chamadas.push(params);
      return { rows: reservado === null ? [] : [{ produto_id: P1, reservado: String(reservado) }], rowCount: 1 };
    },
  } as unknown as ClienteBanco;
  return { db, chamadas };
}
const saldo = (n: number) => async () => new Map([[P1, n]]);

describe('RN-VEN-20: a API confere o estoque da filial do pedido', () => {
  it('RN-VEN-20: a reserva é consultada pela filial do pedido, sem contar o próprio pedido', async () => {
    const { db, chamadas } = bancoComReserva(4);
    expect((await reservadoNaFilial(db, [P1], F, 'ped-1')).get(P1)).toBe(4);
    expect(chamadas[0]![1]).toBe(F);
    expect(chamadas[0]![2]).toBe('ped-1');
    expect(chamadas[0]![3]).toContain('invoiced_partial');
    expect(chamadas[0]![3]).not.toContain('cancelled');
  });
  it('RN-VEN-20: saldo da filial − reservas da filial; acima disso falta estoque (só orçamento)', async () => {
    const { db } = bancoComReserva(50);
    expect(await faltaDeEstoqueNaFilial(db, saldo(60), [{ produto_id: P1, quantidade_base: 11 }], F, 'x')).toEqual([{ produto_id: P1, pedido_base: 11, disponivel_base: 10 }]);
    expect(await faltaDeEstoqueNaFilial(db, saldo(60), [{ produto_id: P1, quantidade_base: 10 }], F, 'x')).toEqual([]);
  });
  it('RN-VEN-20: fallback seguro — sem filial, sem provedor ou sem saldo conhecido, a API não recusa por estoque', async () => {
    const { db, chamadas } = bancoComReserva(999);
    const itens = [{ produto_id: P1, quantidade_base: 1000 }];
    expect(await faltaDeEstoqueNaFilial(db, saldo(1), itens, null, 'x')).toEqual([]);
    expect(await faltaDeEstoqueNaFilial(db, null, itens, F, 'x')).toEqual([]);
    expect(await faltaDeEstoqueNaFilial(db, async () => null, itens, F, 'x')).toEqual([]);
    expect(chamadas).toHaveLength(0);
  });
});

describe('RN-VEN-20: provedor real lê catalogo.estoque_filial@1 na transação', () => {
  const tx = (itens: Array<{ produto_id: string; quantidade_base: number }> | 'indisponivel') => {
    const entradas: unknown[] = [];
    return {
      entradas,
      consultar: (async (def: { nome: string }, entrada: unknown) => {
        entradas.push([def.nome, entrada]);
        if (itens === 'indisponivel') throw new ConsultaIndisponivel('catalogo.estoque_filial@1', 'catalogo');
        return { itens };
      }) as never,
    };
  };
  it('RN-VEN-20: manda produtos e filial ao Catálogo e devolve o saldo por produto; pedido acima do saldo da filial é recusado', async () => {
    const t = tx([{ produto_id: P1, quantidade_base: 5 }]);
    const saldoFilial = await provedorDaTransacao(t)([P1], F);
    expect(t.entradas).toEqual([['catalogo.estoque_filial@1', { produto_ids: [P1], filial_id: F }]]);
    const { db } = bancoComReserva(null);
    expect(await faltaDeEstoqueNaFilial(db, async () => saldoFilial, [{ produto_id: P1, quantidade_base: 6 }], F, 'x')).toEqual([{ produto_id: P1, pedido_base: 6, disponivel_base: 5 }]);
  });
  it('RN-VEN-20: Catálogo indisponível = sem saldo (comportamento anterior); outro erro sobe', async () => {
    expect(await provedorDaTransacao(tx('indisponivel'))([P1], F)).toBeNull();
    await expect(provedorDaTransacao({ consultar: (async () => { throw new Error('falha'); }) as never })([P1], F)).rejects.toThrow('falha');
  });
  it('RN-VEN-20: definirProvedorSaldoDaFilial troca o provedor (provedor falso nos testes); null volta ao real', async () => {
    const falso = async () => new Map([[P1, 1]]);
    definirProvedorSaldoDaFilial(falso);
    expect(provedorSaldoDaFilial(tx([]))).toBe(falso);
    definirProvedorSaldoDaFilial(null);
    expect(provedorSaldoDaFilial(tx([]))).not.toBe(falso);
  });
});
