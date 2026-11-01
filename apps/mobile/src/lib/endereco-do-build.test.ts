/**
 * T-0038 — domínio fixo da demo: endereço do build, login sem o campo Servidor fora do desenvolvimento, endereço salvo
 * por versão antiga ignorado e "Servidor indisponível — tente mais tarde" quando o `/v1/saude` falha.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ErroHttp, ErroSemConexao } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

import { completarApiUrl, defaultApiUrl } from './api-url';
import {
  avisoDeServidorNoLogin,
  cartaoServidorNoLogin,
  CODIGO_SERVIDOR_INDISPONIVEL,
  enderecoEmUso,
  enderecoSalvoValido,
  erroDaVerificacao,
  lerPerfilBuild,
  MENSAGEM_SERVIDOR_INDISPONIVEL,
  mensagemServidorFalhou,
  servidorEditavel,
} from './endereco-do-build';
import { CODIGO_SERVIDOR_INVALIDO, erroDoTesteServidor } from './servidor';

const DEMO = 'https://api-demo.macuxifdv.com.br/v1';
const PRODUCAO = 'https://api.macuxifdv.com.br/v1';
const ANTIGO = 'https://andrew-directions-multimedia-interests.trycloudflare.com/v1';

describe('perfil do build (EXPO_PUBLIC_PERFIL_BUILD)', () => {
  it('lê a flag do build; sem ela, o bundle de desenvolvimento edita e o de release fica fixo', () => {
    expect(lerPerfilBuild({ EXPO_PUBLIC_PERFIL_BUILD: 'preview' }, true)).toBe('preview');
    expect(lerPerfilBuild({ EXPO_PUBLIC_PERFIL_BUILD: ' Producao ' }, true)).toBe('producao');
    expect(lerPerfilBuild({ EXPO_PUBLIC_PERFIL_BUILD: 'desenvolvimento' }, false)).toBe('desenvolvimento');
    expect(lerPerfilBuild({}, true)).toBe('desenvolvimento');
    expect(lerPerfilBuild({}, false)).toBe('producao');
    expect(lerPerfilBuild({ EXPO_PUBLIC_PERFIL_BUILD: 'qualquer' }, false)).toBe('producao');
  });
});

describe('login: campo Servidor', () => {
  it('preview e producao: sem campo Servidor (nem em "Avançado")', () => {
    expect(cartaoServidorNoLogin('preview')).toBe('oculto');
    expect(cartaoServidorNoLogin('producao')).toBe('oculto');
    expect(servidorEditavel('preview')).toBe(false);
    expect(servidorEditavel('producao')).toBe(false);
  });
  it('desenvolvimento: o campo continua, em "Avançado", para a rede local', () => {
    expect(cartaoServidorNoLogin('desenvolvimento')).toBe('avancado');
    expect(servidorEditavel('desenvolvimento')).toBe(true);
  });
});

describe('endereço salvo por versão antiga do app', () => {
  it('preview e producao: ignorado; vale sempre o endereço do build', () => {
    expect(enderecoSalvoValido('preview', ANTIGO)).toBeNull();
    expect(enderecoEmUso('preview', ANTIGO, DEMO)).toBe(DEMO);
    expect(enderecoEmUso('producao', ANTIGO, PRODUCAO)).toBe(PRODUCAO);
  });
  it('desenvolvimento: o endereço salvo vale (vazio volta ao do build)', () => {
    expect(enderecoEmUso('desenvolvimento', 'http://192.168.0.10:8100/v1', DEMO)).toBe('http://192.168.0.10:8100/v1');
    expect(enderecoEmUso('desenvolvimento', '  ', DEMO)).toBe(DEMO);
    expect(enderecoEmUso('desenvolvimento', null, DEMO)).toBe(DEMO);
  });
});

describe('servidor fora do ar: "Servidor indisponível — tente mais tarde"', () => {
  const semResposta = erroDoTesteServidor({ ok: false, testado: `${DEMO}/saude`, motivo: 'sem_resposta', mensagem: `Sem resposta de ${DEMO}/saude. Confira o endereço; ele termina em /v1.` });
  const naoMacuxi = erroDoTesteServidor({ ok: false, testado: `${DEMO}/saude`, motivo: 'erro_do_servidor', status: 502, mensagem: 'Este endereço não é um servidor Macuxi' });

  it('build de endereço fixo: qualquer falha da verificação vira SERVIDOR_INDISPONIVEL, sem endereço nem dica de /v1', () => {
    for (const original of [semResposta, naoMacuxi]) {
      const e = erroDaVerificacao('preview', original);
      expect(e).toBeInstanceOf(ErroHttp);
      expect((e as ErroHttp).codigo).toBe(CODIGO_SERVIDOR_INDISPONIVEL);
      expect((e as ErroHttp).message).toBe(MENSAGEM_SERVIDOR_INDISPONIVEL);
      expect((e as ErroHttp).message).not.toMatch(/endereço|\/v1|https?:/i);
      expect(avisoDeServidorNoLogin('preview', e)).toBe('Servidor indisponível — tente mais tarde');
    }
    expect(mensagemServidorFalhou('producao')).toBe(MENSAGEM_SERVIDOR_INDISPONIVEL);
    // sem conexão no meio do login (depois da verificação) também não pede endereço
    expect(avisoDeServidorNoLogin('producao', new ErroSemConexao())).toBe(MENSAGEM_SERVIDOR_INDISPONIVEL);
  });

  it('erro de credencial continua com a tela do Core', () => {
    expect(avisoDeServidorNoLogin('preview', new ErroHttp(401, 'CREDENCIAIS_INVALIDAS', 'x'))).toBeNull();
  });

  it('desenvolvimento: mantém a mensagem detalhada (ajuda a acertar o endereço da rede local)', () => {
    expect(erroDaVerificacao('desenvolvimento', naoMacuxi)).toBe(naoMacuxi);
    expect((naoMacuxi as ErroHttp).codigo).toBe(CODIGO_SERVIDOR_INVALIDO);
    expect(avisoDeServidorNoLogin('desenvolvimento', semResposta)).toBeNull();
    expect(mensagemServidorFalhou('desenvolvimento')).toBeNull();
  });
});

describe('perfis EAS (apps/mobile/eas.json)', () => {
  const eas = JSON.parse(readFileSync(fileURLToPath(new URL('../../eas.json', import.meta.url)), 'utf8')) as {
    build: Record<string, { env?: Record<string, string>; developmentClient?: boolean }>;
  };
  const esperado: Record<string, [string, string, string]> = {
    campo: ['campo', DEMO, 'desenvolvimento'],
    gestao: ['gestao', DEMO, 'desenvolvimento'],
    'campo-preview': ['campo', DEMO, 'preview'],
    'gestao-preview': ['gestao', DEMO, 'preview'],
    'campo-producao': ['campo', PRODUCAO, 'producao'],
    'gestao-producao': ['gestao', PRODUCAO, 'producao'],
  };
  it.each(Object.entries(esperado))('%s: variante, endereço da API e perfil do build', (perfil, [variante, url, flag]) => {
    const env = eas.build[perfil]?.env;
    expect(env?.APP_VARIANT).toBe(variante);
    expect(env?.EXPO_PUBLIC_API_URL).toBe(url);
    expect(env?.EXPO_PUBLIC_PERFIL_BUILD).toBe(flag);
    // o endereço do build já vem completo (o app não precisa completar nada)
    expect(completarApiUrl(url)).toBe(url);
    expect(defaultApiUrl({ envUrl: url, platform: 'android' })).toBe(url);
    // só os perfis de desenvolvimento têm expo-dev-client (e o campo Servidor em "Avançado")
    expect(Boolean(eas.build[perfil]?.developmentClient)).toBe(flag === 'desenvolvimento');
  });
});
