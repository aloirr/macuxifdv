import { describe, expect, it } from 'vitest';
import { reconciliar } from './reconciliacao';

const lado = (contagem: number, soma: number | null = null) => ({ contagem, soma });

describe('RN-INT-07: reconciliação por entidade', () => {
  it('RN-INT-07: contagem e soma iguais não divergem', () => {
    const r = reconciliar({ entidade: 'titulo', erp: lado(100, 500000), macuxi: lado(100, 500000) });
    expect(r.divergente).toBe(false);
    expect(r.motivos).toEqual([]);
    expect(r.contagem).toMatchObject({ erp: 100, macuxi: 100, diferenca: 0, dentro: true });
  });

  it('RN-INT-07: tolerância de contagem padrão é 0 (uma a menos já diverge)', () => {
    const r = reconciliar({ entidade: 'cliente', erp: lado(1000), macuxi: lado(999) });
    expect(r.divergente).toBe(true);
    expect(r.contagem).toMatchObject({ diferenca: -1, dentro: false });
    expect(r.motivos).toEqual(['contagem_divergente']);
  });

  it('RN-INT-07: tolerância de contagem é parametrizável', () => {
    expect(reconciliar({ entidade: 'cliente', erp: lado(1000), macuxi: lado(998) }, { toleranciaContagem: 2 }).divergente).toBe(false);
    expect(reconciliar({ entidade: 'cliente', erp: lado(1000), macuxi: lado(997) }, { toleranciaContagem: 2 }).divergente).toBe(true);
  });

  it('RN-INT-07: soma tolera 0,5% por padrão; o limite exato ainda está dentro', () => {
    expect(reconciliar({ entidade: 'nota', erp: lado(10, 200000), macuxi: lado(10, 201000) }).divergente).toBe(false);
    const fora = reconciliar({ entidade: 'nota', erp: lado(10, 200000), macuxi: lado(10, 201001) });
    expect(fora.divergente).toBe(true);
    expect(fora.motivos).toEqual(['soma_divergente']);
    expect(fora.soma).toMatchObject({ diferenca: 1001, dentro: false });
    expect(fora.soma?.diferenca_pct).toBeCloseTo(0.5005, 4);
  });

  it('RN-INT-07: tolerância da soma é parametrizável e por entidade', () => {
    const entrada = { entidade: 'estoque' as const, erp: lado(5, 1000), macuxi: lado(5, 1030) };
    expect(reconciliar(entrada).divergente).toBe(true);
    expect(reconciliar(entrada, { toleranciaSomaPct: 5 }).divergente).toBe(false);
    expect(reconciliar(entrada, { porEntidade: { estoque: { toleranciaSomaPct: 5 } } }).divergente).toBe(false);
    expect(reconciliar(entrada, { toleranciaSomaPct: 5, porEntidade: { estoque: { toleranciaSomaPct: 0 } } }).divergente).toBe(true);
  });

  it('RN-INT-07: soma de ERP zerada com Macuxi diferente de zero diverge; zero com zero não', () => {
    expect(reconciliar({ entidade: 'titulo', erp: lado(0, 0), macuxi: lado(0, 0) }).divergente).toBe(false);
    const r = reconciliar({ entidade: 'titulo', erp: lado(1, 0), macuxi: lado(1, 100) });
    expect(r.divergente).toBe(true);
    expect(r.soma?.diferenca_pct).toBeNull();
  });

  it('RN-INT-07: entidade só com contagem ignora a soma; entidade com soma sem um dos lados diverge', () => {
    expect(reconciliar({ entidade: 'cliente', erp: lado(3, 10), macuxi: lado(3, 99999) }).soma).toBeNull();
    const r = reconciliar({ entidade: 'preco', erp: lado(3, 1000), macuxi: lado(3, null) });
    expect(r.divergente).toBe(true);
    expect(r.motivos).toEqual(['soma_ausente']);
  });

  it('RN-INT-07: contagem e soma divergentes geram os dois motivos', () => {
    const r = reconciliar({ entidade: 'nota', erp: lado(10, 1000), macuxi: lado(8, 500) });
    expect(r.motivos).toEqual(['contagem_divergente', 'soma_divergente']);
  });
});
