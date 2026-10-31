import { describe, expect, it } from 'vitest';
import { atingimentoShare, calcularShare, mediaShare } from './share';

describe('RN-PRO-03 / RF-PRO-04: share de gôndola por categoria', () => {
  it('RN-PRO-03: share = frentes nossas ÷ frentes totais × 100', () => {
    const r = calcularShare({ frentes_nossas: 12, frentes_total: 40 });
    expect(r).toMatchObject({ status: 'ok', share_pct: 30, base: 'frentes' });
  });

  it('RN-PRO-03: arredonda em 2 casas (1 de 3 frentes = 33,33%)', () => {
    expect(calcularShare({ frentes_nossas: 1, frentes_total: 3 }).share_pct).toBe(33.33);
  });

  it('RN-PRO-03: usa centímetros lineares quando medido em cm (cm nossos ÷ cm totais)', () => {
    const r = calcularShare({ frentes_nossas: 12, frentes_total: 40, cm_nossos: 90, cm_total: 300 });
    expect(r).toMatchObject({ status: 'ok', share_pct: 30, base: 'cm' });
    const r2 = calcularShare({ frentes_nossas: 12, frentes_total: 40, cm_nossos: 150, cm_total: 300 });
    expect(r2.share_pct).toBe(50);
  });

  it('RF-PRO-04: cm informado pela metade é inconsistente (pede os dois valores)', () => {
    const r = calcularShare({ frentes_nossas: 1, frentes_total: 4, cm_nossos: 10 });
    expect(r.status).toBe('inconsistente');
    expect(r.share_pct).toBeNull();
    expect(r.motivo).toMatch(/centímetros/);
  });

  it('RN-PRO-03: total zero não divide por zero: sem_dados', () => {
    const r = calcularShare({ frentes_nossas: 0, frentes_total: 0 });
    expect(r).toMatchObject({ status: 'sem_dados', share_pct: null });
  });

  it('RN-PRO-03: nossas > total é inconsistente, com mensagem em português', () => {
    const r = calcularShare({ frentes_nossas: 5, frentes_total: 4 });
    expect(r.status).toBe('inconsistente');
    expect(r.share_pct).toBeNull();
    expect(r.motivo).toMatch(/total/i);
  });

  it('RN-PRO-03: nossas > total em cm também é inconsistente', () => {
    expect(calcularShare({ frentes_nossas: 1, frentes_total: 4, cm_nossos: 400, cm_total: 300 }).status).toBe('inconsistente');
  });

  it('RN-PRO-03: valores negativos, fracionados de frentes ou não numéricos são inconsistentes', () => {
    expect(calcularShare({ frentes_nossas: -1, frentes_total: 4 }).status).toBe('inconsistente');
    expect(calcularShare({ frentes_nossas: 1.5, frentes_total: 4 }).status).toBe('inconsistente');
    expect(calcularShare({ frentes_nossas: Number.NaN, frentes_total: 4 }).status).toBe('inconsistente');
  });

  it('RN-PRO-03: 100% quando todas as frentes são nossas e 0% quando nenhuma', () => {
    expect(calcularShare({ frentes_nossas: 8, frentes_total: 8 }).share_pct).toBe(100);
    expect(calcularShare({ frentes_nossas: 0, frentes_total: 8 }).share_pct).toBe(0);
  });
});

describe('RN-PRO-03: atingimento do share contra a meta da loja/categoria', () => {
  it('atingimento = share ÷ meta × 100 e desvio em pontos percentuais', () => {
    const r = atingimentoShare(24, 30);
    expect(r).toMatchObject({ meta_pct: 30, atingimento_pct: 80, desvio_pp: -6, situacao: 'abaixo' });
  });

  it('acima ou igual à meta = atingiu', () => {
    expect(atingimentoShare(30, 30)).toMatchObject({ atingimento_pct: 100, desvio_pp: 0, situacao: 'atingiu' });
    expect(atingimentoShare(36, 30)).toMatchObject({ atingimento_pct: 120, desvio_pp: 6, situacao: 'atingiu' });
  });

  it('sem meta cadastrada (ou meta zero) não calcula atingimento', () => {
    expect(atingimentoShare(24, null)).toMatchObject({ atingimento_pct: null, desvio_pp: null, situacao: 'sem_meta' });
    expect(atingimentoShare(24, 0).situacao).toBe('sem_meta');
    expect(atingimentoShare(24, undefined).situacao).toBe('sem_meta');
  });

  it('share nulo (sem dados) não calcula atingimento', () => {
    expect(atingimentoShare(null, 30)).toMatchObject({ atingimento_pct: null, situacao: 'sem_dados' });
  });
});

describe('RF-PRO-12: média de share × meta das categorias medidas', () => {
  it('média simples das categorias com share e atingimento sobre as que têm meta', () => {
    const m = mediaShare([
      { share_pct: 30, meta_pct: 40 },
      { share_pct: 20, meta_pct: 20 },
      { share_pct: null, meta_pct: 30 },
      { share_pct: 10, meta_pct: null },
    ]);
    expect(m.share_medio_pct).toBe(20);
    expect(m.meta_media_pct).toBe(30);
    expect(m.atingimento_pct).toBe(83.33);
    expect(m.categorias_medidas).toBe(3);
  });

  it('lista vazia = tudo nulo', () => {
    expect(mediaShare([])).toEqual({ share_medio_pct: null, meta_media_pct: null, atingimento_pct: null, categorias_medidas: 0 });
  });
});
