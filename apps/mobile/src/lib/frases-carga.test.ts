/**
 * Mensagem de erro da sincronização no Perfil, sem detalhe técnico (T-0059, R-20261102-090915).
 */
import { describe, expect, it } from 'vitest';

import { mensagemDeErroDaCarga } from './frases-carga';

describe('mensagemDeErroDaCarga', () => {
  it('erro amigável, sem detalhe técnico', () => {
    expect(mensagemDeErroDaCarga(false)).toBe('Não conseguimos baixar seus dados. Confira o sinal e tente de novo.');
    expect(mensagemDeErroDaCarga(true)).toMatch(/modo sem sinal/);
  });
});
