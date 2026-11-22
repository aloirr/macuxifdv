/**
 * Campos de segredo na redação do log (ADR 0066; RN-INT-17 proposta). O teste com o pino real fica na API
 * (`apps/api/test/log-seguro.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { CAMINHOS_SEGREDO_LOG, CAMPOS_SEGREDO_LOG } from './segredos-log';

describe('CAMINHOS_SEGREDO_LOG', () => {
  it('cobre os campos do desenho §2.2: senha, segredo, token, authorization e cookie', () => {
    for (const c of ['senha', 'segredo', 'token', 'authorization', 'cookie']) expect(CAMPOS_SEGREDO_LOG).toContain(c);
  });

  it('cada campo solto (se for identificador), no 2º e no 3º nível; hífen vai entre colchetes', () => {
    expect(CAMINHOS_SEGREDO_LOG).toEqual(expect.arrayContaining(['senha', '*.senha', '*.*.senha', '*["x-api-key"]', '*.*["x-api-key"]', '*["set-cookie"]']));
    expect(CAMINHOS_SEGREDO_LOG).not.toContain('x-api-key');
    expect(new Set(CAMINHOS_SEGREDO_LOG).size).toBe(CAMINHOS_SEGREDO_LOG.length);
  });
});
