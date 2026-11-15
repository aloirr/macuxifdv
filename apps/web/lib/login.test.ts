import { ApiRequestError } from '@macuxi/platform-sdk/web';
import { describe, expect, it } from 'vitest';
import { MENSAGEM_BLOQUEADO_ADMIN, mensagemBloqueioPorTentativas, mensagemMuitasTentativas, validarLogin as validarCampos } from '@macuxi/core/contracts';
import { mensagemDoLogin } from './login';

describe('login do BKO (T-0003 F2)', () => {
  it('valida os três campos com a ação seguinte', () => {
    expect(validarCampos({ codigo_empresa: '', email: '', senha: '' })).toEqual({
      codigo_empresa: expect.stringMatching(/código da empresa/),
      email: 'Informe o seu e-mail.',
      senha: 'Informe a sua senha.',
    });
    expect(validarCampos({ codigo_empresa: 'alfa', email: 'a@b.com', senha: 'x' })).toEqual({});
    expect(validarCampos({ codigo_empresa: 'al fa', email: 'ab.com', senha: 'x' })).toMatchObject({ codigo_empresa: expect.any(String), email: expect.any(String) });
  });

  it('mensagens por código da API e sem rede; nunca revela qual dado está errado', () => {
    expect(mensagemDoLogin(new ApiRequestError(401, 'CREDENCIAIS_INVALIDAS', 'x'))).toMatch(/Código da empresa, e-mail ou senha incorretos/);
    expect(mensagemDoLogin(new ApiRequestError(423, 'USUARIO_BLOQUEADO', 'x'))).toBe(MENSAGEM_BLOQUEADO_ADMIN);
    expect(mensagemDoLogin(new ApiRequestError(503, 'AUTENTICACAO_INDISPONIVEL', 'x'))).toMatch(/indisponível/);
    expect(mensagemDoLogin(new ApiRequestError(0, 'network', 'x'))).toMatch(/Sem conexão/);
    expect(mensagemDoLogin(new Error('qualquer'))).toMatch(/Não foi possível entrar/);
  });

  it('RN-CORE-01: bloqueio por tentativas diz quanto falta e não manda procurar o administrador', () => {
    const e = new ApiRequestError(423, 'LOGIN_BLOQUEADO_TENTATIVAS', 'x', { minutos_restantes: 12 });
    expect(mensagemDoLogin(e)).toBe(mensagemBloqueioPorTentativas(12));
    expect(mensagemDoLogin(e)).toBe('Muitas tentativas. Tente de novo em 12 minutos.');
    expect(mensagemDoLogin(e)).not.toMatch(/administrador/);
    // sem `details`: o padrão de 15 min (RN-CORE-01)
    expect(mensagemDoLogin(new ApiRequestError(423, 'LOGIN_BLOQUEADO_TENTATIVAS', 'x'))).toBe('Muitas tentativas. Tente de novo em 15 minutos.');
  });

  it('RF-CORE-01: 429 por limite de falhas usa o tempo de `retry_after_s`; bloqueio do administrador manda falar com ele', () => {
    expect(mensagemDoLogin(new ApiRequestError(429, 'MUITAS_TENTATIVAS', 'x', { retry_after_s: 90 }))).toBe(mensagemMuitasTentativas(90));
    expect(mensagemDoLogin(new ApiRequestError(429, 'MUITAS_TENTATIVAS', 'x', { retry_after_s: 90 }))).toBe('Muitas tentativas. Tente de novo em 2 minutos.');
    expect(mensagemDoLogin(new ApiRequestError(429, 'MUITAS_TENTATIVAS', 'x'))).toBe(mensagemMuitasTentativas());
    expect(mensagemDoLogin(new ApiRequestError(423, 'USUARIO_BLOQUEADO', 'x'))).toMatch(/administrador/);
  });
});
