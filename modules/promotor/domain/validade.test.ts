import { describe, expect, it } from 'vitest';
import {
  dataLocal,
  diasAteVencer,
  ehValidadeProxima,
  faixaDeRisco,
  resumirAvarias,
  resumirValidade,
  validarAvaria,
  validarItemValidade,
} from './validade';

describe('RN-PRO-08 / RF-PRO-07: validade próxima', () => {
  it('dias até vencer = validade − hoje (datas civis)', () => {
    expect(diasAteVencer('2026-11-30', '2026-10-31')).toBe(30);
    expect(diasAteVencer('2026-10-31', '2026-10-31')).toBe(0);
    expect(diasAteVencer('2026-10-30', '2026-10-31')).toBe(-1);
  });

  it('data inválida é recusada', () => {
    expect(() => diasAteVencer('31/10/2026', '2026-10-31')).toThrow(/AAAA-MM-DD/);
  });

  it('RN-PRO-08: validade próxima = vencimento em até 30 dias (padrão)', () => {
    expect(ehValidadeProxima(30)).toBe(true);
    expect(ehValidadeProxima(31)).toBe(false);
    expect(ehValidadeProxima(0)).toBe(true);
  });

  it('RN-PRO-08: item já vencido também entra como validade próxima/crítica', () => {
    expect(ehValidadeProxima(-3)).toBe(true);
  });

  it('RN-PRO-08: o limite é configurável', () => {
    expect(ehValidadeProxima(45, 60)).toBe(true);
    expect(ehValidadeProxima(45, 30)).toBe(false);
  });

  it('RN-PRO-08: faixas de risco (vencido < 0; crítico 0–7; atenção 8–30; ok > 30)', () => {
    expect(faixaDeRisco(-1)).toBe('vencido');
    expect(faixaDeRisco(0)).toBe('critico');
    expect(faixaDeRisco(7)).toBe('critico');
    expect(faixaDeRisco(8)).toBe('atencao');
    expect(faixaDeRisco(30)).toBe('atencao');
    expect(faixaDeRisco(31)).toBe('ok');
  });

  it('RN-PRO-08: faixas com limites configuráveis', () => {
    expect(faixaDeRisco(10, { validade_critica_dias: 15, validade_proxima_dias: 45 })).toBe('critico');
    expect(faixaDeRisco(40, { validade_critica_dias: 15, validade_proxima_dias: 45 })).toBe('atencao');
  });

  it('RN-PRO-08: limite crítico maior que o de validade próxima é configuração inválida', () => {
    expect(() => faixaDeRisco(5, { validade_critica_dias: 40, validade_proxima_dias: 30 })).toThrow();
  });

  it('datas UTC: o "hoje" vem do fuso do tenant (Manaus, UTC−4)', () => {
    // 2026-11-01 02:00Z ainda é 31/10 em Manaus
    expect(dataLocal('2026-11-01T02:00:00Z', 'America/Manaus')).toBe('2026-10-31');
    expect(dataLocal('2026-11-01T05:00:00Z', 'America/Manaus')).toBe('2026-11-01');
  });

  it('RF-PRO-07: valida item de validade (data, quantidade inteira positiva)', () => {
    expect(validarItemValidade({ validade: '2026-11-15', quantidade: 12 })).toEqual([]);
    expect(validarItemValidade({ validade: '2026-11-15', quantidade: 0 }).length).toBeGreaterThan(0);
    expect(validarItemValidade({ validade: 'amanhã', quantidade: 2 }).length).toBeGreaterThan(0);
  });

  it('RF-PRO-07: resumo por faixa, com unidades em risco', () => {
    const r = resumirValidade(
      [
        { validade: '2026-10-25', quantidade: 3 },
        { validade: '2026-11-03', quantidade: 10 },
        { validade: '2026-11-20', quantidade: 5 },
        { validade: '2027-03-01', quantidade: 100 },
      ],
      '2026-10-31',
    );
    expect(r.por_faixa.vencido).toEqual({ itens: 1, unidades: 3 });
    expect(r.por_faixa.critico).toEqual({ itens: 1, unidades: 10 });
    expect(r.por_faixa.atencao).toEqual({ itens: 1, unidades: 5 });
    expect(r.por_faixa.ok).toEqual({ itens: 1, unidades: 100 });
    expect(r.proximas_itens).toBe(3);
    expect(r.proximas_unidades).toBe(18);
  });
});

describe('RF-PRO-07: avarias', () => {
  it('avaria exige quantidade inteira positiva, motivo e foto', () => {
    expect(validarAvaria({ quantidade: 2, motivo: 'Embalagem rasgada', tem_foto: true })).toEqual([]);
    expect(validarAvaria({ quantidade: 2, motivo: 'Embalagem rasgada', tem_foto: false })[0]).toMatch(/foto/i);
    expect(validarAvaria({ quantidade: 2, motivo: ' ', tem_foto: true })[0]).toMatch(/motivo/i);
    expect(validarAvaria({ quantidade: 0, motivo: 'x', tem_foto: true })[0]).toMatch(/quantidade/i);
  });

  it('resumo de avarias por motivo', () => {
    const r = resumirAvarias([
      { quantidade: 2, motivo: 'Embalagem rasgada' },
      { quantidade: 3, motivo: 'Embalagem rasgada' },
      { quantidade: 1, motivo: 'Amassado' },
    ]);
    expect(r).toEqual({ ocorrencias: 3, unidades: 6, por_motivo: { 'Embalagem rasgada': 5, Amassado: 1 } });
  });
});
