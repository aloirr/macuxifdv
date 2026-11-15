import { describe, expect, it } from 'vitest';
import { CodigoEmpresaFormatoSchema, CodigoEmpresaSchema, EsqueciSenhaRequestSchema, LoginSenhaRequestSchema } from './auth';
import { erroDoCodigoEmpresa } from './ciclo-senha';

describe('RF-CORE-01: código da empresa (servidor aceita o já gravado; o campo impõe UF + 4 dígitos)', () => {
  it('RF-CORE-01: o servidor aceita código antigo ainda gravado no banco (demo, alfa, portal-t0087) e o novo', () => {
    for (const c of ['demo', 'alfa', 'portal-t0087', 'cliente-t0093', ' AM4821 ', 'am4821']) {
      expect(CodigoEmpresaSchema.safeParse(c).success, c).toBe(true);
      expect(LoginSenhaRequestSchema.safeParse({ codigo_empresa: c, email: 'a@b.com', senha: 'x' }).success, c).toBe(true);
      expect(EsqueciSenhaRequestSchema.safeParse({ codigo_empresa: c, email: 'a@b.com' }).success, c).toBe(true);
    }
    for (const c of ['a', 'a b', 'x'.repeat(41), '-abc']) expect(CodigoEmpresaSchema.safeParse(c).success, c).toBe(false);
  });

  it('RF-CORE-01: o formato novo (UF + 4 dígitos) vale só para o campo do app e do BKO', () => {
    for (const c of ['AM4821', 'am4821', ' Sp1234 ']) {
      expect(CodigoEmpresaFormatoSchema.safeParse(c).success, c).toBe(true);
      expect(erroDoCodigoEmpresa(c), c).toBeNull();
    }
    for (const c of ['demo', 'XX4821', 'AM482', 'AM48211']) {
      expect(CodigoEmpresaFormatoSchema.safeParse(c).success, c).toBe(false);
      expect(erroDoCodigoEmpresa(c), c).not.toBeNull();
    }
  });
});
