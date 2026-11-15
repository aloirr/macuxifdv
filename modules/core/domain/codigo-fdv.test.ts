import { describe, expect, it } from 'vitest';
import { CODIGOS_CODIGO_FDV, formatarCodigoFdv, proximoSequencialFdv, recusarCodigoFdvNoCorpo, validarCodigoFdv } from './codigo-fdv';

describe('RN-CORE-59: Código FDV (código próprio do Macuxi, gerado, só de leitura)', () => {
  it('RN-CORE-59: formata em FDV- com no mínimo 4 dígitos e cresce passando de 9999', () => {
    expect(formatarCodigoFdv(1)).toBe('FDV-0001');
    expect(formatarCodigoFdv(42)).toBe('FDV-0042');
    expect(formatarCodigoFdv(9999)).toBe('FDV-9999');
    expect(formatarCodigoFdv(10000)).toBe('FDV-10000');
    expect(formatarCodigoFdv(123456)).toBe('FDV-123456');
  });

  it('RN-CORE-59: o sequencial é inteiro a partir de 1; fora disso é erro', () => {
    for (const ruim of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => formatarCodigoFdv(ruim)).toThrow();
  });

  it('RN-CORE-59: valida o formato e devolve o sequencial', () => {
    expect(validarCodigoFdv('FDV-0001')).toEqual({ ok: true, sequencial: 1, codigo: 'FDV-0001' });
    expect(validarCodigoFdv('FDV-10000')).toEqual({ ok: true, sequencial: 10000, codigo: 'FDV-10000' });
    for (const ruim of ['', 'FDV-1', 'FDV-001', 'FDV-0000', 'fdv-0001', 'FDV0001', 'FDV-00012', 'FDV-0001 ', 'ERP-0001', 'FDV-1e4a']) {
      expect(validarCodigoFdv(ruim).ok, ruim).toBe(false);
    }
  });

  it('RN-CORE-59: o formato é redondo (formatar e validar se desfazem)', () => {
    for (const n of [1, 9, 10, 999, 9999, 10000, 99999, 1000000]) {
      const v = validarCodigoFdv(formatarCodigoFdv(n));
      expect(v.ok && v.sequencial).toBe(n);
    }
  });

  it('RN-CORE-59: o próximo sequencial nunca reaproveita (maior já usado + 1, inclusive de apagados)', () => {
    expect(proximoSequencialFdv(null)).toBe(1);
    expect(proximoSequencialFdv(0)).toBe(1);
    expect(proximoSequencialFdv(9999)).toBe(10000);
  });

  it('RN-CORE-59: criar ou editar com codigo_fdv no corpo é recusado (422), mesmo igual ao atual', () => {
    expect(recusarCodigoFdvNoCorpo({ nome: 'A' })).toBeNull();
    expect(recusarCodigoFdvNoCorpo({ codigo_fdv: undefined })).toBeNull();
    for (const valor of ['FDV-0001', null, '', 7]) {
      const e = recusarCodigoFdvNoCorpo({ codigo_fdv: valor });
      expect(e?.codigo).toBe(CODIGOS_CODIGO_FDV.somenteLeitura);
      expect(e?.campo).toBe('codigo_fdv');
      expect(e?.mensagem).toMatch(/gerado pelo sistema/);
    }
  });
});
