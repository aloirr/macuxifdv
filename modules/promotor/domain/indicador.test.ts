import { describe, expect, it } from 'vitest';
import { consolidarIndicadorDia, type EntradaIndicadorDia } from './indicador';

const base: EntradaIndicadorDia = {
  lojas_planejadas: 5,
  visitas: [
    { visita_id: 'v1', cliente_id: 'c1', permanencia_min: 40 },
    { visita_id: 'v2', cliente_id: 'c2', permanencia_min: 20 },
    { visita_id: 'v3', cliente_id: 'c3', permanencia_min: 6 },
    { visita_id: 'v4', cliente_id: 'c4', permanencia_min: null },
  ],
  conformidades: [
    { visita_id: 'v1', conformidade: 'conforme' },
    { visita_id: 'v2', conformidade: 'nao_conforme' },
    { visita_id: 'v3', conformidade: 'conforme' },
  ],
  shares: [
    { visita_id: 'v1', share_pct: 30, meta_pct: 40 },
    { visita_id: 'v2', share_pct: 20, meta_pct: 20 },
    { visita_id: 'v3', share_pct: 90, meta_pct: 10 },
  ],
  presencas: [
    { visita_id: 'v1', status: 'presente' },
    { visita_id: 'v1', status: 'ruptura_total' },
    { visita_id: 'v2', status: 'ruptura_gondola' },
    { visita_id: 'v2', status: 'presente' },
    { visita_id: 'v3', status: 'ruptura_total' },
  ],
  indices_preco: [
    { visita_id: 'v1', indice_preco: 110 },
    { visita_id: 'v2', indice_preco: 90 },
    { visita_id: 'v2', indice_preco: null },
    { visita_id: 'v3', indice_preco: 300 },
  ],
};

describe('RF-PRO-12: indicador do dia do promotor', () => {
  it('RN-PRO-07: só visitas com 10 min ou mais contam como visitadas; curtas são sinalizadas', () => {
    const r = consolidarIndicadorDia(base);
    expect(r.lojas_planejadas).toBe(5);
    expect(r.lojas_visitadas).toBe(2);
    expect(r.cobertura_pct).toBe(40);
    expect(r.visitas_curtas).toBe(1);
    expect(r.visitas_abertas).toBe(1);
  });

  it('tempo médio em loja considera só as visitas que contam', () => {
    expect(consolidarIndicadorDia(base).tempo_medio_min).toBe(30);
  });

  it('RN-PRO-07: coletas de visita curta ficam fora dos indicadores (conformidade, share, ruptura, preço)', () => {
    const r = consolidarIndicadorDia(base);
    expect(r.conformidade_pct).toBe(50);
    expect(r.share_medio_pct).toBe(25);
    expect(r.meta_share_media_pct).toBe(30);
    expect(r.atingimento_share_pct).toBe(83.33);
    expect(r.indice_preco_medio).toBe(100);
  });

  it('RN-PRO-05: ruptura do dia = itens em ruptura ÷ itens do mix (agregado das visitas válidas) e falha de reposição à parte', () => {
    const r = consolidarIndicadorDia(base);
    expect(r.ruptura_pct).toBe(50);
    expect(r.falha_reposicao_pct).toBe(25);
  });

  it('mesma loja visitada duas vezes conta uma vez em lojas visitadas', () => {
    const r = consolidarIndicadorDia({
      ...base,
      visitas: [
        { visita_id: 'v1', cliente_id: 'c1', permanencia_min: 40 },
        { visita_id: 'v2', cliente_id: 'c1', permanencia_min: 20 },
      ],
      conformidades: [],
      shares: [],
      presencas: [],
      indices_preco: [],
    });
    expect(r.lojas_visitadas).toBe(1);
    expect(r.tempo_medio_min).toBe(30);
  });

  it('dia sem dados: indicadores nulos e sem divisão por zero', () => {
    const r = consolidarIndicadorDia({ lojas_planejadas: 0, visitas: [], conformidades: [], shares: [], presencas: [], indices_preco: [] });
    expect(r).toMatchObject({
      lojas_visitadas: 0,
      cobertura_pct: null,
      tempo_medio_min: null,
      conformidade_pct: null,
      share_medio_pct: null,
      atingimento_share_pct: null,
      ruptura_pct: null,
      indice_preco_medio: null,
    });
  });

  it('permanência mínima configurável', () => {
    const r = consolidarIndicadorDia(base, { permanencia_min_min: 30 });
    expect(r.lojas_visitadas).toBe(1);
    expect(r.visitas_curtas).toBe(2);
  });
});
