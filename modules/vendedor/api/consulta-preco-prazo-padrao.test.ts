import type { ClienteBanco } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { precoPrazoPadrao } from './consulta-preco-prazo-padrao';

const C1 = '11111111-1111-4111-8111-111111111111';
const FORA = '22222222-2222-4222-8222-222222222222';

function banco(pct: number): ClienteBanco {
  return {
    query: async (sql: string) => {
      if (sql.includes('vendedor.forma_pagamento')) return { rows: [{ id: 'f1', codigo: 'BOL', nome: 'Boleto', ativo: true, ordem: 1 }] };
      return { rows: [{ id: 'p1', forma_pagamento_id: 'f1', codigo: 'P1', descricao: '28', parcelas_dias: [28], prazo_medio_dias: 28, percentual_ajuste: pct, ativo: true, ordem: 1 }] };
    },
  } as unknown as ClienteBanco;
}
// o cadastro do Core só devolve cliente da carteira de quem consulta
const cadastro = async (e: { cliente_ids: string[] }) => ({ clientes: e.cliente_ids.filter((i) => i === C1).map((id) => ({ id, prazo_medio_max_dias: null, formas_pagamento: null })) });

describe('RN-VEN-43: vendedor.preco_prazo_padrao@1 na API', () => {
  it('RN-VEN-43: ajusta pelo prazo padrão (-1,71% e +2,5%), mesmo tamanho e ordem', async () => {
    expect(await precoPrazoPadrao(banco(-1.71), cadastro, C1, [1000, 0, 333])).toEqual([983, 0, 327]);
    expect(await precoPrazoPadrao(banco(2.5), cadastro, C1, [1000, 0, 333])).toEqual([1025, 0, 341]);
  });
  it('RN-VEN-43: cliente fora da carteira não vaza: valores iguais, sem ler forma nem prazo', async () => {
    const db = { query: async () => { throw new Error('não deveria consultar o banco'); } } as unknown as ClienteBanco;
    expect(await precoPrazoPadrao(db, cadastro, FORA, [1000, 50])).toEqual([1000, 50]);
  });
  it('RN-VEN-43: sem percentual no prazo padrão, valores iguais; lista vazia, saída vazia', async () => {
    expect(await precoPrazoPadrao(banco(0), cadastro, C1, [1000])).toEqual([1000]);
    expect(await precoPrazoPadrao(banco(5), cadastro, C1, [])).toEqual([]);
  });
});
