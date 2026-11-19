import { describe, expect, it } from 'vitest';
import { expurgarRastreamento, LOTE_EXPURGO, SQL_EXPURGO_RASTREAMENTO } from './expurgo-rastreamento';

type Linha = { tenant_id: string; pontos: number; resumos: number };

function poolFalso(respostas: Linha[][]) {
  const chamadas: unknown[][] = [];
  return {
    chamadas,
    async query(sql: string, params: unknown[]) {
      expect(sql).toBe(SQL_EXPURGO_RASTREAMENTO);
      chamadas.push(params);
      return { rows: respostas.shift() ?? [] };
    },
  };
}

const T1 = '00000000-0000-4000-8000-000000000001';
const T2 = '00000000-0000-4000-8000-000000000002';
const AGORA = new Date('2026-11-19T07:00:00.000Z');

describe('expurgo diário do rastreamento (ADR 0061, desenho tracking §5.4; RN-CORE-13)', () => {
  it('RN-CORE-13: chama de novo enquanto um lote vem cheio e soma as contagens por tenant', async () => {
    const pool = poolFalso([
      [{ tenant_id: T1, pontos: LOTE_EXPURGO - 10, resumos: 0 }, { tenant_id: T2, pontos: 10, resumos: 3 }],
      [{ tenant_id: T1, pontos: 5, resumos: 0 }],
    ]);
    const r = await expurgarRastreamento(pool, AGORA);
    expect(pool.chamadas).toHaveLength(2);
    expect(pool.chamadas[0]).toEqual([AGORA.toISOString(), LOTE_EXPURGO]);
    expect(r).toEqual({ lotes: 2, pontos: LOTE_EXPURGO + 5, resumos: 3, tenants: 2 });
  });

  it('RN-CORE-13: nada a apagar = uma chamada só', async () => {
    const pool = poolFalso([[]]);
    expect(await expurgarRastreamento(pool, AGORA)).toEqual({ lotes: 1, pontos: 0, resumos: 0, tenants: 0 });
  });

  it('RN-CORE-13: para no teto de lotes por rodada (o resto fica para o dia seguinte)', async () => {
    const cheio = [{ tenant_id: T1, pontos: LOTE_EXPURGO, resumos: 0 }];
    const pool = poolFalso(Array.from({ length: 10 }, () => cheio));
    const r = await expurgarRastreamento(pool, AGORA, 3);
    expect(r.lotes).toBe(3);
    expect(pool.chamadas).toHaveLength(3);
  });

  it('RN-CORE-13: o resultado traz só contagens, sem usuário nem coordenada', async () => {
    const r = await expurgarRastreamento(poolFalso([[{ tenant_id: T1, pontos: 2, resumos: 1 }]]), AGORA);
    expect(Object.keys(r).sort()).toEqual(['lotes', 'pontos', 'resumos', 'tenants']);
  });
});
