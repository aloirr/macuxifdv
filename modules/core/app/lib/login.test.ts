import { ErroSemConexao } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { camposIniciaisDoLogin, entrarComSenha, ehServidorInvalido, mensagemDeErroDeLogin, propsDoCampoCodigoEmpresa, validarLogin } from './login';
import { MENSAGEM_SENHA_ESPACO_NAS_PONTAS } from '../../contracts';

const U = '0b000000-0000-4000-8000-000000000001';
const resposta = {
  access_token: 'a.b.c',
  token_type: 'Bearer',
  expires_in: 900,
  refresh_token: `${U}.segredo-segredo-segredo`,
  usuario: { id: U, nome: 'Vera', nome_curto: null, email: 'v@x.com', perfil: 'vendedor' },
  tenant: { id: U, codigo: 'AM4821', nome: 'Alfa', fuso: 'America/Manaus' },
};

describe('RF-CORE-01: login do app', () => {
  it('RF-CORE-01: valida os três campos com mensagem em português e a ação seguinte', () => {
    expect(validarLogin({ codigo_empresa: '', email: '', senha: '' })).toMatchObject({
      codigo_empresa: expect.stringContaining('código da empresa'),
      email: expect.any(String),
      senha: expect.any(String),
    });
    expect(validarLogin({ codigo_empresa: 'AM4821', email: 'sem-arroba', senha: 'x' }).email).toContain('e-mail');
    expect(validarLogin({ codigo_empresa: 'AM 821', email: 'v@x.com', senha: 'x' }).codigo_empresa).toContain('duas letras da UF e quatro números');
    expect(validarLogin({ codigo_empresa: 'AM48211', email: 'v@x.com', senha: 'x' }).codigo_empresa).toContain('duas letras da UF e quatro números');
    expect(validarLogin({ codigo_empresa: 'AM48', email: 'v@x.com', senha: 'x' }).codigo_empresa).toContain('duas letras da UF e quatro números');
    expect(validarLogin({ codigo_empresa: 'XX4821', email: 'v@x.com', senha: 'x' }).codigo_empresa).toContain('duas letras da UF e quatro números');
    expect(validarLogin({ codigo_empresa: 'alfa12', email: 'v@x.com', senha: 'x' }).codigo_empresa).toContain('duas letras da UF e quatro números');
    expect(validarLogin({ codigo_empresa: 'alfa', email: 'v@x.com', senha: 'x' }).codigo_empresa).toContain('duas letras da UF e quatro números');
    expect(validarLogin({ codigo_empresa: 'AM4821', email: 'v@x.com', senha: 'x' })).toEqual({});
    expect(validarLogin({ codigo_empresa: ' Am4821 ', email: ' v@x.com ', senha: 'x' })).toEqual({});
  });
  it('RN-CORE-32: senha com espaço no começo ou no fim é avisada no login', () => {
    expect(validarLogin({ codigo_empresa: 'AM4821', email: 'v@x.com', senha: ' Ab1#cDef' }).senha).toBe(MENSAGEM_SENHA_ESPACO_NAS_PONTAS);
    expect(validarLogin({ codigo_empresa: 'AM4821', email: 'v@x.com', senha: 'Ab1#cDef ' }).senha).toBe(MENSAGEM_SENHA_ESPACO_NAS_PONTAS);
    expect(validarLogin({ codigo_empresa: 'AM4821', email: 'v@x.com', senha: 'Ab1# cDef' }).senha).toBeUndefined();
  });

  it('RF-CORE-01: mensagens por código de erro — credencial, bloqueio, limite, sem conexão', () => {
    expect(mensagemDeErroDeLogin({ codigo: 'CREDENCIAIS_INVALIDAS' })).toContain('incorretos');
    expect(mensagemDeErroDeLogin({ codigo: 'USUARIO_BLOQUEADO' })).toContain('administrador');
    expect(mensagemDeErroDeLogin({ codigo: 'MUITAS_TENTATIVAS' })).toContain('Aguarde');
    expect(mensagemDeErroDeLogin(new ErroSemConexao())).toContain('Sem conexão');
    expect(mensagemDeErroDeLogin(new Error('boom'))).toContain('Tente de novo');
  });

  it('RF-CORE-01: entrarComSenha envia o contrato (código sem espaços, aparelho) e valida a resposta', async () => {
    let enviado: unknown;
    const r = await entrarComSenha(
      async (c, corpo) => {
        expect(c).toBe('/auth/login');
        enviado = corpo;
        return resposta;
      },
      { codigo_empresa: ' am4821 ', email: 'v@x.com', senha: 'segredo' },
      { id: U, nome: 'Moto G' },
    );
    expect(enviado).toEqual({ codigo_empresa: 'AM4821', email: 'v@x.com', senha: 'segredo', dispositivo_id: U, dispositivo_nome: 'Moto G' });
    expect(r.tenant.fuso).toBe('America/Manaus');
    await expect(entrarComSenha(async () => ({ ...resposta, token_type: 'Basic' }), { codigo_empresa: 'AM4821', email: 'v@x.com', senha: 'x' })).rejects.toThrow();
  });

  it('RF-CORE-01: três casos separados — sem conexão, servidor inválido, credencial incorreta', () => {
    const semConexao = mensagemDeErroDeLogin(new ErroSemConexao());
    const invalido = mensagemDeErroDeLogin({ codigo: 'SERVIDOR_INVALIDO' });
    const credencial = mensagemDeErroDeLogin({ codigo: 'CREDENCIAIS_INVALIDAS' });
    expect(invalido).toContain('não é um servidor Macuxi');
    expect(semConexao).toContain('não respondeu');
    expect(credencial).toContain('incorretos');
    expect(new Set([semConexao, invalido, credencial]).size).toBe(3);
    expect(mensagemDeErroDeLogin({ name: 'ZodError' })).toBe(invalido);
    expect(mensagemDeErroDeLogin({ status: 404 })).toBe(invalido);
    expect(ehServidorInvalido({ status: 401, codigo: 'CREDENCIAIS_INVALIDAS' })).toBe(false);
    expect(mensagemDeErroDeLogin(new Error('boom'))).toContain('Não foi possível entrar agora');
  });
});

describe('RF-CORE-01: TelaLogin reabre com o e-mail (T-0094)', () => {
  it('RF-CORE-01: o e-mail devolvido pelo shell vem preenchido, junto do código; a senha começa vazia', () => {
    expect(camposIniciaisDoLogin('AM4821', 'v@x.com')).toEqual({ codigo_empresa: 'AM4821', email: 'v@x.com', senha: '' });
  });
  it('RF-CORE-01: sem emailInicial nem código salvo, os campos abrem vazios', () => {
    expect(camposIniciaisDoLogin(null, undefined)).toEqual({ codigo_empresa: '', email: '', senha: '' });
  });
});

describe('RF-CORE-01: campo Código da empresa do login', () => {
  it('RF-CORE-01: o campo aceita no máximo 6 caracteres (UF + 4 dígitos), igual ao contrato', () => {
    expect(propsDoCampoCodigoEmpresa).toMatchObject({ maxLength: 6, autoCapitalize: 'characters', autoCorrect: false, spellCheck: false });
  });
});

describe('RF-CORE-01: teclado não muda a senha nem o código da empresa (v1.0.10)', () => {
  it('RF-CORE-01: código "aM2808 " é validado e enviado como "AM2808"', async () => {
    expect(validarLogin({ codigo_empresa: 'aM2808 ', email: 'a@b.com', senha: 'x' })).toEqual({});
    let corpo: { codigo_empresa?: string } = {};
    await entrarComSenha(async (_c, c) => { corpo = c as { codigo_empresa: string }; return {}; }, { codigo_empresa: ' aM2808 ', email: 'a@b.com', senha: 'x' }).catch(() => undefined);
    expect(corpo.codigo_empresa).toBe('AM2808');
  });
});
