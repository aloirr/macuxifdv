import { describe, expect, it } from 'vitest';
import { CodigoEmpresaFormatoSchema, CodigoEmpresaSchema, EsqueciSenhaRequestSchema, LoginSenhaRequestSchema, TrocarSenhaRequestSchema } from './auth';
import { erroDoCodigoEmpresa } from './ciclo-senha';

const ANTIGOS = ['demo', 'alfa', 'beta', 'portal-t0087', 'cliente-t0093'];

describe('RF-CORE-01: código da empresa (campo só UF + 4 dígitos; servidor aceita também o antigo até o lote de migração)', () => {
  it('RF-CORE-01: aceita UF + 4 dígitos, sem diferenciar maiúscula e aparando as pontas', () => {
    for (const c of ['AM4821', 'am4821', ' Sp1234 ']) {
      expect(CodigoEmpresaSchema.safeParse(c).success, c).toBe(true);
      expect(LoginSenhaRequestSchema.safeParse({ codigo_empresa: c, email: 'a@b.com', senha: 'x' }).success, c).toBe(true);
      expect(EsqueciSenhaRequestSchema.safeParse({ codigo_empresa: c, email: 'a@b.com' }).success, c).toBe(true);
      expect(erroDoCodigoEmpresa(c), c).toBeNull();
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
      expect(erroDoCodigoEmpresa(c), c).not.toBeNull();
    }
  });
});
