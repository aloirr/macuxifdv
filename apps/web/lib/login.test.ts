import { ApiRequestError } from '@macuxi/platform-sdk/web';
import { describe, expect, it } from 'vitest';
import { MENSAGEM_BLOQUEADO_ADMIN, MENSAGEM_CREDENCIAIS, mensagemBloqueioPorTentativas, mensagemMuitasTentativas, validarLoginNovo as validarCampos } from '@macuxi/core/contracts';
import { mensagemDoLogin } from './login';

describe('login do BKO (T-0003 F2)', () => {
  it('valida os três campos com a ação seguinte', () => {
    expect(validarCampos({ codigo_empresa: '', email: '', senha: '' })).toEqual({
      codigo_empresa: expect.stringMatching(/código da empresa/),
      email: 'Informe o seu e-mail.',
      senha: 'Informe a sua senha.',
    });
    expect(validarCampos({ codigo_empresa: 'AM1234', email: 'a@b.com', senha: 'x' })).toEqual({});
    // R-20261114-222000: o campo só aceita UF + 4 dígitos; o código antigo é recusado na tela
    expect(validarCampos({ codigo_empresa: 'alfa', email: 'a@b.com', senha: 'x' })).toEqual({ codigo_empresa: expect.stringMatching(/código da empresa/) });
    expect(validarCampos({ codigo_empresa: 'AM 1234', email: 'ab.com', senha: 'x' })).toMatchObject({ codigo_empresa: expect.any(String), email: expect.any(String) });
  });

  it('mensagens por código da API e sem rede; nunca revela qual dado está errado', () => {
    expect(mensagemDoLogin(new ApiRequestError(401, 'CREDENCIAIS_INVALIDAS', 'x'))).toBe(MENSAGEM_CREDENCIAIS);
    expect(mensagemDoLogin(new ApiRequestError(503, 'AUTENTICACAO_INDISPONIVEL', 'x'))).toMatch(/indisponível/);
    expect(mensagemDoLogin(new ApiRequestError(0, 'network', 'x'))).toMatch(/Sem conexão/);
    expect(mensagemDoLogin(new Error('qualquer'))).toMatch(/Não foi possível entrar/);
  });

  it('RN-CORE-01 (T-0185): 423 por tentativas dá os minutos que faltam; 423 do administrador manda falar com ele; 429 dá a espera real', () => {
    expect(mensagemDoLogin(new ApiRequestError(423, 'USUARIO_BLOQUEADO', 'x', { minutos_restantes: 12 }))).toBe(mensagemBloqueioPorTentativas(12));
    expect(mensagemDoLogin(new ApiRequestError(423, 'USUARIO_BLOQUEADO', 'x', { minutos_restantes: 1 }))).toBe('Muitas tentativas. Tente de novo em 1 minuto.');
    expect(mensagemDoLogin(new ApiRequestError(423, 'USUARIO_BLOQUEADO', 'x'))).toBe(MENSAGEM_BLOQUEADO_ADMIN);
    expect(mensagemDoLogin(new ApiRequestError(423, 'USUARIO_BLOQUEADO', 'x', {}))).toBe(MENSAGEM_BLOQUEADO_ADMIN);
    expect(mensagemDoLogin(new ApiRequestError(429, 'MUITAS_TENTATIVAS', 'x', { retry_after_s: 170 }))).toBe(mensagemMuitasTentativas(170));
    expect(mensagemDoLogin(new ApiRequestError(429, 'MUITAS_TENTATIVAS', 'x', { retry_after_s: 170 }))).toBe('Muitas tentativas. Tente de novo em 3 minutos.');
    expect(mensagemDoLogin(new ApiRequestError(429, 'MUITAS_TENTATIVAS', 'x'))).toBe(mensagemMuitasTentativas(undefined));
  });
});
