import { describe, expect, it } from 'vitest';
import { CODIGO_MAX_DP, CODIGO_MIN_DP, larguraDoCodigo } from './tabela-itens';

describe('tabela de itens: largura do Código pelo conteúdo', () => {
  it('AGU-1500 (8 caracteres) cabe em cerca de 60 dp', () => {
    const l = larguraDoCodigo(['AGU-1500', 'LPO-400']);
    expect(l).toBeGreaterThanOrEqual(58);
    expect(l).toBeLessThanOrEqual(62);
  });
  it('sem linhas, vale o cabeçalho "Código" e nunca fica abaixo do mínimo', () => {
    expect(larguraDoCodigo([])).toBeGreaterThanOrEqual(CODIGO_MIN_DP);
  });
  it('código muito longo é preso no máximo', () => {
    expect(larguraDoCodigo(['X'.repeat(30)])).toBe(CODIGO_MAX_DP);
  });
});
