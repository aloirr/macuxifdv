import { describe, expect, it } from 'vitest';
import { classificarMudancaContrato, situacaoVersao, validarVersaoContrato } from './versao';

describe('RN-INT-09: versão do contrato', () => {
  it('RN-INT-09: v1 é suportada por padrão; outras são recusadas listando as suportadas', () => {
    expect(validarVersaoContrato('v1')).toEqual({ ok: true, versao: 'v1' });
    const r = validarVersaoContrato('v2');
    expect(r).toMatchObject({ ok: false, codigo: 'versao_nao_suportada', suportadas: ['v1'] });
    if (!r.ok) expect(r.mensagem).toMatch(/v1/);
  });
  it('RN-INT-09: versões suportadas são parâmetro (convivência v1 + v2)', () => {
    expect(validarVersaoContrato('v2', { suportadas: ['v1', 'v2'] }).ok).toBe(true);
  });
  it('RN-INT-09: valor que não é texto é recusado', () => {
    expect(validarVersaoContrato(1).ok).toBe(false);
    expect(validarVersaoContrato(undefined).ok).toBe(false);
  });

  it('RN-INT-09: campo novo opcional é compatível; o resto exige /v2', () => {
    for (const m of ['campo_opcional_adicionado', 'valor_enum_adicionado', 'endpoint_adicionado'] as const) expect(classificarMudancaContrato(m)).toBe('compativel');
    for (const m of ['campo_obrigatorio_adicionado', 'campo_removido', 'campo_renomeado', 'tipo_alterado', 'valor_enum_removido', 'campo_tornado_obrigatorio', 'limite_reduzido'] as const) {
      expect(classificarMudancaContrato(m)).toBe('incompativel');
    }
  });

  it('RN-INT-09: a versão anterior fica ativa por 6 meses depois da substituição', () => {
    expect(situacaoVersao({ substituidaEm: null }, '2027-01-01T00:00:00Z')).toEqual({ estado: 'ativa', encerraEm: null });
    const sub = '2026-11-30T12:00:00Z';
    expect(situacaoVersao({ substituidaEm: sub }, '2027-05-30T11:59:59Z')).toEqual({ estado: 'em_descontinuacao', encerraEm: '2027-05-30T12:00:00.000Z' });
    expect(situacaoVersao({ substituidaEm: sub }, '2027-05-30T12:00:00Z').estado).toBe('encerrada');
  });

  it('RN-INT-09: a janela é parâmetro e o fim de mês é ajustado (31/08 + 6 meses = 28/02)', () => {
    expect(situacaoVersao({ substituidaEm: '2026-08-31T00:00:00Z' }, '2026-09-01T00:00:00Z').encerraEm).toBe('2027-02-28T00:00:00.000Z');
    expect(situacaoVersao({ substituidaEm: '2026-01-10T00:00:00Z' }, '2026-02-01T00:00:00Z', { janelaMeses: 1 }).estado).toBe('em_descontinuacao');
    expect(situacaoVersao({ substituidaEm: '2026-01-10T00:00:00Z' }, '2026-02-10T00:00:00Z', { janelaMeses: 1 }).estado).toBe('encerrada');
  });
});
