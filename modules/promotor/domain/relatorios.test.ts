import { criarRelogio } from '@macuxi/comum/relogio';
import { describe, expect, it } from 'vitest';
import { relatorioRupturaPorLoja, relatorioShareMeta, visitasQueContam } from './relatorios';

const relogio = criarRelogio({ agora: '2026-11-03T14:00:00Z' });
const ins = (min: number) => relogio.relativo({ minutos: min }).toISOString();

const L1 = 'loja-1';
const L2 = 'loja-2';
const CAT_A = 'cat-a';
const CAT_B = 'cat-b';

describe('RN-PRO-07: só coletas de visitas que contam entram nos relatórios', () => {
  it('RN-PRO-07: visita com permanência mínima conta; curta e aberta ficam fora', () => {
    const s = visitasQueContam([
      { id: 'v1', permanencia_min: 40 },
      { id: 'v2', permanencia_min: 6 },
      { id: 'v3', permanencia_min: null },
      { id: 'v4', permanencia_min: 10 },
    ]);
    expect([...s].sort()).toEqual(['v1', 'v4']);
  });

  it('RN-PRO-07: permanência mínima do tenant', () => {
    expect([...visitasQueContam([{ id: 'v1', permanencia_min: 12 }], 15)]).toEqual([]);
  });
});

describe('RN-PRO-03 / RF-PRO-12: share × meta por loja e categoria', () => {
  const m = (cliente_id: string, categoria_gondola_id: string, share_pct: number | null, meta_pct: number | null, min: number, visita_loja_id = 'v1') => ({
    cliente_id,
    categoria_gondola_id,
    share_pct,
    meta_pct,
    medido_em: ins(min),
    visita_loja_id,
  });

  it('RN-PRO-03: vale a última medição de cada loja/categoria, com atingimento e desvio', () => {
    const r = relatorioShareMeta([m(L1, CAT_A, 20, 40, 0), m(L1, CAT_A, 30, 40, 10), m(L1, CAT_B, 25, 20, 5)], new Set(['v1']));
    expect(r.linhas).toEqual([
      { cliente_id: L1, categoria_gondola_id: CAT_A, share_pct: 30, meta_pct: 40, atingimento_pct: 75, desvio_pp: -10, situacao: 'abaixo', medido_em: ins(10) },
      { cliente_id: L1, categoria_gondola_id: CAT_B, share_pct: 25, meta_pct: 20, atingimento_pct: 125, desvio_pp: 5, situacao: 'atingiu', medido_em: ins(5) },
    ]);
  });

  it('RF-PRO-12: resumo = média simples do share e atingimento sobre as categorias com meta', () => {
    const r = relatorioShareMeta([m(L1, CAT_A, 30, 40, 0), m(L1, CAT_B, 20, 20, 0), m(L2, CAT_A, 10, null, 0)], new Set(['v1']));
    expect(r.resumo).toEqual({ share_medio_pct: 20, meta_media_pct: 30, atingimento_pct: 83.33, categorias_medidas: 3 });
    expect(r.linhas.find((l) => l.cliente_id === L2)).toMatchObject({ situacao: 'sem_meta', atingimento_pct: null });
  });

  it('RN-PRO-07: medição de visita que não conta fica fora (a anterior válida continua valendo)', () => {
    const r = relatorioShareMeta([m(L1, CAT_A, 30, 40, 0, 'v1'), m(L1, CAT_A, 90, 40, 10, 'curta')], new Set(['v1']));
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]).toMatchObject({ share_pct: 30 });
  });

  it('sem medições = sem linhas e resumo nulo', () => {
    expect(relatorioShareMeta([], new Set())).toEqual({ linhas: [], resumo: { share_medio_pct: null, meta_media_pct: null, atingimento_pct: null, categorias_medidas: 0 } });
  });
});

describe('RN-PRO-05: ruptura do mix por loja', () => {
  const v = (id: string, cliente_id: string, min: number) => ({ id, cliente_id, checkin_em: ins(min) });
  const i = (visita_loja_id: string, status: 'presente' | 'ruptura_gondola' | 'ruptura_total', quantidade_reposta = 0) => ({ visita_loja_id, status, quantidade_reposta });

  it('RN-PRO-05: % da última visita válida de cada loja, com falha de reposição à parte', () => {
    const visitas = [v('v1', L1, 0), v('v2', L1, 60), v('v3', L2, 30)];
    const itens = [
      i('v1', 'ruptura_total'),
      i('v2', 'presente'),
      i('v2', 'presente'),
      i('v2', 'ruptura_gondola', 4),
      i('v2', 'ruptura_total'),
      i('v3', 'presente'),
      i('v3', 'presente'),
    ];
    const r = relatorioRupturaPorLoja(itens, visitas, new Set(['v1', 'v2', 'v3']));
    expect(r.map((x) => x.cliente_id)).toEqual([L1, L2]); // maior ruptura primeiro
    expect(r[0]).toMatchObject({ visita_loja_id: 'v2', checkin_em: ins(60), total: 4, em_ruptura: 2, ruptura_pct: 50, falha_reposicao_pct: 25, ruptura_total_pct: 25, quantidade_reposta: 4 });
    expect(r[1]).toMatchObject({ visita_loja_id: 'v3', ruptura_pct: 0 });
  });

  it('RN-PRO-07: visita que não conta não vira a "última" da loja', () => {
    const r = relatorioRupturaPorLoja([i('v1', 'ruptura_total'), i('v2', 'presente')], [v('v1', L1, 0), v('v2', L1, 60)], new Set(['v1']));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ visita_loja_id: 'v1', ruptura_pct: 100 });
  });

  it('visita sem item do mix conferido não aparece', () => {
    expect(relatorioRupturaPorLoja([], [v('v1', L1, 0)], new Set(['v1']))).toEqual([]);
  });
});
