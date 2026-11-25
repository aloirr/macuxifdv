import { ErroSemConexao } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { ehServidorInvalido, mensagemDeErroDeLogin } from './troca-senha-voluntaria';

describe('RF-CORE-01: mensagens de erro do login', () => {
  it('RF-CORE-01: mensagens por código de erro — credencial, bloqueio, limite, sem conexão', () => {
    expect(mensagemDeErroDeLogin({ codigo: 'CREDENCIAIS_INVALIDAS' })).toContain('incorretos');
    expect(mensagemDeErroDeLogin({ codigo: 'USUARIO_BLOQUEADO' })).toBe('Seu acesso está bloqueado. Fale com o administrador da sua empresa.');
    expect(mensagemDeErroDeLogin({ codigo: 'MUITAS_TENTATIVAS' })).toBe('Muitas tentativas. Tente de novo em 5 minutos.');
    expect(mensagemDeErroDeLogin(new ErroSemConexao())).toContain('Sem conexão');
    expect(mensagemDeErroDeLogin(new Error('boom'))).toContain('Tente de novo');
  });

  it('RN-CORE-01: bloqueio por tentativas avisa o tempo e não manda procurar o administrador; o 429 usa o retry_after_s', () => {
    // mesmo código USUARIO_BLOQUEADO (o APK em uso segue funcionando); `minutos_restantes` marca o bloqueio temporário
    const t = mensagemDeErroDeLogin({ codigo: 'USUARIO_BLOQUEADO', detalhes: { minutos_restantes: 12 } });
    expect(t).toBe('Muitas tentativas. Tente de novo em 12 minutos.');
    expect(t).not.toContain('administrador');
    expect(mensagemDeErroDeLogin({ codigo: 'USUARIO_BLOQUEADO', detalhes: { minutos_restantes: 1 } })).toBe('Muitas tentativas. Tente de novo em 1 minuto.');
    expect(mensagemDeErroDeLogin({ codigo: 'MUITAS_TENTATIVAS', detalhes: { retry_after_s: 61 } })).toBe('Muitas tentativas. Tente de novo em 2 minutos.');
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
