import { ErroSemConexao } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { camposIniciaisDoLogin, entrarComSenha, ehServidorInvalido, mensagemDeErroDeLogin, propsDoCampoSenhaDoLogin, rotuloOlhoSenha, validarLogin } from './login';

const U = '0b000000-0000-4000-8000-000000000001';
const resposta = {
  access_token: 'a.b.c',
  token_type: 'Bearer',
  expires_in: 900,
  refresh_token: `${U}.segredo-segredo-segredo`,
  usuario: { id: U, nome: 'Vera', nome_curto: null, email: 'v@x.com', perfil: 'vendedor' },
  tenant: { id: U, codigo: 'alfa', nome: 'Alfa', fuso: 'America/Manaus' },
};

describe('RF-CORE-01: login do app', () => {
  it('RF-CORE-01: valida os três campos com mensagem em português e a ação seguinte', () => {
    expect(validarLogin({ codigo_empresa: '', email: '', senha: '' })).toMatchObject({
      codigo_empresa: expect.stringContaining('código da empresa'),
      email: expect.any(String),
      senha: expect.any(String),
    });
    expect(validarLogin({ codigo_empresa: 'alfa', email: 'sem-arroba', senha: 'x' }).email).toContain('e-mail');
    expect(validarLogin({ codigo_empresa: 'a b', email: 'v@x.com', senha: 'x' }).codigo_empresa).toContain('letras, números e hífen');
    expect(validarLogin({ codigo_empresa: 'a'.repeat(41), email: 'v@x.com', senha: 'x' }).codigo_empresa).toContain('no máximo 40 caracteres');
    expect(validarLogin({ codigo_empresa: `${'a'.repeat(30)} ${'b'.repeat(15)}`, email: 'v@x.com', senha: 'x' }).codigo_empresa).toContain('no máximo 40');
    expect(validarLogin({ codigo_empresa: 'a', email: 'v@x.com', senha: 'x' }).codigo_empresa).toContain('no mínimo 2');
    expect(validarLogin({ codigo_empresa: 'a'.repeat(40), email: 'v@x.com', senha: 'x' })).toEqual({});
    expect(validarLogin({ codigo_empresa: ' Alfa ', email: ' v@x.com ', senha: 'x' })).toEqual({});
  });

  it('RF-CORE-01: mensagens por código de erro — credencial, bloqueio, limite, sem conexão', () => {
    expect(mensagemDeErroDeLogin({ codigo: 'CREDENCIAIS_INVALIDAS' })).toContain('incorretos');
    expect(mensagemDeErroDeLogin({ codigo: 'USUARIO_BLOQUEADO' })).toBe('Seu acesso está bloqueado. Fale com o administrador da sua empresa.');
    expect(mensagemDeErroDeLogin({ codigo: 'MUITAS_TENTATIVAS' })).toBe('Muitas tentativas. Tente de novo em 5 minutos.');
    expect(mensagemDeErroDeLogin(new ErroSemConexao())).toContain('Sem conexão');
    expect(mensagemDeErroDeLogin(new Error('boom'))).toContain('Tente de novo');
  });

  it('RN-CORE-01: bloqueio por tentativas avisa o tempo e não manda procurar o administrador; o 429 usa o retry_after_s', () => {
    const t = mensagemDeErroDeLogin({ codigo: 'LOGIN_BLOQUEADO_TENTATIVAS', detalhes: { minutos_restantes: 12 } });
    expect(t).toBe('Muitas tentativas. Tente de novo em 12 minutos.');
    expect(t).not.toContain('administrador');
    expect(mensagemDeErroDeLogin({ codigo: 'LOGIN_BLOQUEADO_TENTATIVAS' })).toBe('Muitas tentativas. Tente de novo em 15 minutos.');
    expect(mensagemDeErroDeLogin({ codigo: 'LOGIN_BLOQUEADO_TENTATIVAS', detalhes: { minutos_restantes: 1 } })).toBe('Muitas tentativas. Tente de novo em 1 minuto.');
    expect(mensagemDeErroDeLogin({ codigo: 'MUITAS_TENTATIVAS', detalhes: { retry_after_s: 61 } })).toBe('Muitas tentativas. Tente de novo em 2 minutos.');
  });

  it('RF-CORE-01: entrarComSenha envia o contrato (código sem espaços, aparelho) e valida a resposta', async () => {
    let enviado: unknown;
    const r = await entrarComSenha(
      async (c, corpo) => {
        expect(c).toBe('/auth/login');
        enviado = corpo;
        return resposta;
      },
      { codigo_empresa: ' alfa ', email: 'v@x.com', senha: 'segredo' },
      { id: U, nome: 'Moto G' },
    );
    expect(enviado).toEqual({ codigo_empresa: 'alfa', email: 'v@x.com', senha: 'segredo', dispositivo_id: U, dispositivo_nome: 'Moto G' });
    expect(r.tenant.fuso).toBe('America/Manaus');
    await expect(entrarComSenha(async () => ({ ...resposta, token_type: 'Basic' }), { codigo_empresa: 'alfa', email: 'v@x.com', senha: 'x' })).rejects.toThrow();
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

  it('RF-CORE-01: rótulo do botão de olho alterna entre mostrar e ocultar', () => {
    expect(rotuloOlhoSenha(false)).toBe('Mostrar senha');
    expect(rotuloOlhoSenha(true)).toBe('Esconder senha');
  });
});

describe('RF-CORE-01: TelaLogin reabre com o e-mail (T-0094)', () => {
  it('RF-CORE-01: o e-mail devolvido pelo shell vem preenchido, junto do código; a senha começa vazia', () => {
    expect(camposIniciaisDoLogin('alfa', 'v@x.com')).toEqual({ codigo_empresa: 'alfa', email: 'v@x.com', senha: '' });
  });
  it('RF-CORE-01: sem emailInicial nem código salvo, os campos abrem vazios', () => {
    expect(camposIniciaisDoLogin(null, undefined)).toEqual({ codigo_empresa: '', email: '', senha: '' });
  });
});

describe('RN-CORE-32: campo Senha do login não pode alterar o que a pessoa digita', () => {
  it('RN-CORE-32: sem maiúscula automática, corretor nem sugestão (a temporária chega com maiúsculas e minúsculas misturadas)', () => {
    expect(propsDoCampoSenhaDoLogin).toEqual({
      autoCapitalize: 'none',
      autoCorrect: false,
      spellCheck: false,
      autoComplete: 'current-password',
      textContentType: 'password',
    });
  });

  it('RN-CORE-32: a senha vai ao servidor exatamente como digitada (sem trim)', async () => {
    let enviado: Record<string, unknown> = {};
    await entrarComSenha(
      async (_c, corpo) => {
        enviado = corpo as Record<string, unknown>;
        return resposta;
      },
      { codigo_empresa: ' alfa ', email: ' v@x.com ', senha: ' Ab1#cD ' },
    );
    expect(enviado.senha).toBe(' Ab1#cD ');
    expect(enviado.email).toBe('v@x.com');
  });
});
