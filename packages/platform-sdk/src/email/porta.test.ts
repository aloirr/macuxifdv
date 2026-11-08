import { describe, expect, it } from 'vitest';
import { CODIGOS_EMAIL, CodigoEmailSchema, OpcoesEnvioEmailSchema, ResultadoEnvioEmailSchema } from './porta';

const ID = '0b6f3c2e-6d1a-4f7e-9c2b-1a2b3c4d5e6f';

describe('porta EnvioEmail — contrato do resultado', () => {
  it('sucesso: idEnvio UUID e situação enfileirado|enviado', () => {
    expect(ResultadoEnvioEmailSchema.parse({ ok: true, idEnvio: ID, situacao: 'enfileirado' })).toEqual({
      ok: true,
      idEnvio: ID,
      situacao: 'enfileirado',
    });
    expect(() => ResultadoEnvioEmailSchema.parse({ ok: true, idEnvio: 'x', situacao: 'enviado' })).toThrowError();
    expect(() => ResultadoEnvioEmailSchema.parse({ ok: true, idEnvio: ID, situacao: 'perdido' })).toThrowError();
  });

  it('falha: só código conhecido + retentável (nada de mensagem livre)', () => {
    expect(ResultadoEnvioEmailSchema.parse({ ok: false, codigo: 'EMAIL_DADOS_INVALIDOS', retentavel: false }).ok).toBe(false);
    expect(() => ResultadoEnvioEmailSchema.parse({ ok: false, codigo: 'OUTRO', retentavel: true })).toThrowError();
    expect(() =>
      ResultadoEnvioEmailSchema.parse({ ok: false, codigo: 'EMAIL_CONEXAO', retentavel: true, mensagem: 'servidor disse x' }),
    ).toThrowError();
  });

  it('códigos com prefixo EMAIL_ e únicos', () => {
    const lista = Object.values(CODIGOS_EMAIL);
    expect(new Set(lista).size).toBe(lista.length);
    for (const c of lista) {
      expect(c).toMatch(/^EMAIL_[A-Z_]+$/);
      expect(CodigoEmailSchema.parse(c)).toBe(c);
    }
  });

  it('opções: idEnvio e tenantId são UUID', () => {
    expect(OpcoesEnvioEmailSchema.parse({ idEnvio: ID, tenantId: ID })).toEqual({ idEnvio: ID, tenantId: ID });
    expect(() => OpcoesEnvioEmailSchema.parse({ idEnvio: '1' })).toThrowError();
    expect(() => OpcoesEnvioEmailSchema.parse({ email: 'a@b.c' })).toThrowError();
  });
});
