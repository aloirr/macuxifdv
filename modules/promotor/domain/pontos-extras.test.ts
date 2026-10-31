import { describe, expect, it } from 'vitest';
import { conferirPontoExtra, resumirPontosExtras } from './pontos-extras';

describe('RF-PRO-08: pontos extras negociados × encontrados', () => {
  it('existe, no lugar e abastecido = cumprido', () => {
    expect(conferirPontoExtra({ existe: true, no_lugar: true, abastecido: true })).toMatchObject({ situacao: 'cumprido', erros: [] });
  });

  it('existe mas fora do lugar ou vazio = parcial', () => {
    expect(conferirPontoExtra({ existe: true, no_lugar: false, abastecido: true }).situacao).toBe('parcial');
    expect(conferirPontoExtra({ existe: true, no_lugar: true, abastecido: false }).situacao).toBe('parcial');
  });

  it('não existe = não cumprido', () => {
    expect(conferirPontoExtra({ existe: false, no_lugar: false, abastecido: false }).situacao).toBe('nao_cumprido');
  });

  it('não existe mas marcado "no lugar"/"abastecido" é inconsistente e continua não cumprido', () => {
    const r = conferirPontoExtra({ existe: false, no_lugar: true, abastecido: true });
    expect(r.situacao).toBe('nao_cumprido');
    expect(r.erros[0]).toMatch(/não existe/i);
  });

  it('% de cumprimento = pontos negociados cumpridos ÷ pontos negociados × 100', () => {
    const r = resumirPontosExtras([
      { negociado: true, existe: true, no_lugar: true, abastecido: true },
      { negociado: true, existe: true, no_lugar: true, abastecido: false },
      { negociado: true, existe: false, no_lugar: false, abastecido: false },
      { negociado: true, existe: true, no_lugar: true, abastecido: true },
    ]);
    expect(r).toMatchObject({ negociados: 4, cumpridos: 2, parciais: 1, nao_cumpridos: 1, cumprimento_pct: 50 });
  });

  it('pontos encontrados sem negociação não entram no % e contam à parte', () => {
    const r = resumirPontosExtras([
      { negociado: true, existe: true, no_lugar: true, abastecido: true },
      { negociado: false, existe: true, no_lugar: true, abastecido: true },
      { negociado: false, existe: true, no_lugar: true, abastecido: true },
    ]);
    expect(r.negociados).toBe(1);
    expect(r.cumprimento_pct).toBe(100);
    expect(r.encontrados_nao_negociados).toBe(2);
  });

  it('sem pontos negociados = % nulo', () => {
    expect(resumirPontosExtras([]).cumprimento_pct).toBeNull();
  });
});
