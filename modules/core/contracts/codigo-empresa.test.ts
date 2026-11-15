import { describe, expect, it } from 'vitest';
import { CODIGO_EMPRESA_REGEX, CODIGO_EMPRESA_TAMANHO, CodigoEmpresaFormatoSchema, CodigoEmpresaSchema, EsqueciSenhaRequestSchema, LoginSenhaRequestSchema, TrocarSenhaRequestSchema } from './auth';
import { validarCodigoEmpresaNovo, validarLogin, validarLoginNovo } from './ciclo-senha';

const ANTIGOS = ['demo', 'alfa', 'beta', 'portal-t0087', 'cliente-t0093'];

describe('RF-CORE-01: código da empresa (campo só UF + 4 dígitos; servidor aceita também o antigo até o lote de migração)', () => {
  it('RF-CORE-01: aceita UF + 4 dígitos, sem diferenciar maiúscula e aparando as pontas', () => {
    for (const c of ['AM4821', 'am4821', ' Sp1234 ']) {
      expect(CodigoEmpresaSchema.safeParse(c).success, c).toBe(true);
      expect(LoginSenhaRequestSchema.safeParse({ codigo_empresa: c, email: 'a@b.com', senha: 'x' }).success, c).toBe(true);
      expect(EsqueciSenhaRequestSchema.safeParse({ codigo_empresa: c, email: 'a@b.com' }).success, c).toBe(true);
      expect(validarCodigoEmpresaNovo(c), c).toBeNull();
    }
  });

  it('RF-CORE-01: o servidor aceita o código antigo e o novo no login, na troca e no "Esqueci a senha" (R-20261114-222000)', () => {
    for (const c of [...ANTIGOS, 'AM4821']) {
      expect(CodigoEmpresaSchema.safeParse(c).success, c).toBe(true);
      expect(LoginSenhaRequestSchema.safeParse({ codigo_empresa: c, email: 'a@b.com', senha: 'x' }).success, c).toBe(true);
      expect(EsqueciSenhaRequestSchema.safeParse({ codigo_empresa: c, email: 'a@b.com' }).success, c).toBe(true);
      expect(TrocarSenhaRequestSchema.safeParse({ codigo_empresa: c, email: 'a@b.com', senha_atual: 'x', senha_nova: 'Nova-senha-123' }).success, c).toBe(true);
    }
    for (const c of ['a b', '', 'x']) expect(CodigoEmpresaSchema.safeParse(c).success, c).toBe(false);
  });

  it('RF-CORE-01: o campo recusa o antigo e o fora do formato, com a ação seguinte', () => {
    for (const c of [...ANTIGOS, 'XX4821', 'AM482', 'AM48211', 'AM48A1', 'A4821', 'a b', '']) {
      expect(CodigoEmpresaFormatoSchema.safeParse(c).success, c).toBe(false);
      expect(validarCodigoEmpresaNovo(c), c).not.toBeNull();
    }
  });
});

describe('RF-CORE-01: duas regras convivem até o BKO migrar', () => {
  it('RF-CORE-01: validarLogin (BKO) segue aceitando o código antigo; validarLoginNovo (app) exige UF + 4 dígitos', () => {
    const c = { codigo_empresa: 'alfa', email: 'a@b.com', senha: 'x' };
    expect(validarLogin(c)).toEqual({});
    expect(validarLoginNovo(c).codigo_empresa).toBeDefined();
    expect(validarLoginNovo({ ...c, codigo_empresa: 'AM4821' })).toEqual({});
    expect(CODIGO_EMPRESA_TAMANHO).toBe(6);
    expect(CODIGO_EMPRESA_REGEX.test('AM4821')).toBe(true);
  });
  it('RN-CORE-32: senha com espaço nas pontas é recusada no login nas duas regras', () => {
    expect(validarLogin({ codigo_empresa: 'AM4821', email: 'a@b.com', senha: ' x' }).senha).toBeDefined();
    expect(validarLoginNovo({ codigo_empresa: 'AM4821', email: 'a@b.com', senha: 'x ' }).senha).toBeDefined();
  });
});
