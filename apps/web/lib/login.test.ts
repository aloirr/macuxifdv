import { ApiRequestError } from '@macuxi/platform-sdk/web';
import { describe, expect, it } from 'vitest';
import { validarLogin as validarCampos } from '@macuxi/core/contracts';
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
    expect(mensagemDoLogin(new ApiRequestError(423, 'USUARIO_BLOQUEADO', 'x'))).toMatch(/bloqueado/);
    expect(mensagemDoLogin(new ApiRequestError(429, 'MUITAS_TENTATIVAS', 'x'))).toMatch(/Aguarde/);
    expect(mensagemDoLogin(new ApiRequestError(503, 'AUTENTICACAO_INDISPONIVEL', 'x'))).toMatch(/indisponível/);
    expect(mensagemDoLogin(new ApiRequestError(0, 'network', 'x'))).toMatch(/Sem conexão/);
    expect(mensagemDoLogin(new Error('qualquer'))).toMatch(/Não foi possível entrar/);
  });
});
