/**
 * T-0065 (A) — RN-CORE-23 item 3: push do servidor no app (lista de entidades, rota ao tocar, silencioso, registro do token).
 * v1.0.10: push pelo FCM direto (token FCM cru; `data` como mapa de textos).
 */
import { describe, expect, it } from 'vitest';

import {
  chaveRegistroPush,
  dadosDoPush,
  entidadesDoPush,
  mensagemDaTarefaPush,
  precisaRegistrarPush,
  pushSilencioso,
  rotaDoPush,
  tokenFcmValido,
  VALIDADE_REGISTRO_PUSH_MS,
} from './push';

/** Formato de um token FCM real (projeto:chave), com 162 caracteres. */
const TOKEN_FCM = `dQw4w9WgXcQ:APA91b${'H_x-9Z'.repeat(24)}`;

describe('entidadesDoPush', () => {
  it('aceita lista, texto JSON e texto separado por vírgula; tira repetidas e nomes inválidos', () => {
    expect(entidadesDoPush({ entidades: ['pedido', 'pedido', 'cliente_condicao'] })).toEqual(['pedido', 'cliente_condicao']);
    expect(entidadesDoPush({ entidades: '["pedido","meta"]' })).toEqual(['pedido', 'meta']);
    expect(entidadesDoPush({ entidades: 'pedido, rota_dia' })).toEqual(['pedido', 'rota_dia']);
    expect(entidadesDoPush({ entidades: ['Pedido', '../x', 3, 'ok'] })).toEqual(['ok']);
    expect(entidadesDoPush({ entidades: '' })).toEqual([]);
  });
  it('sem lista (ou lista ilegível) = null: o app faz a verificação de novidades', () => {
    expect(entidadesDoPush({ link: '/m/pedidos' })).toBeNull();
    expect(entidadesDoPush(null)).toBeNull();
    expect(entidadesDoPush({ entidades: '[quebrado' })).toBeNull();
    expect(entidadesDoPush({ entidades: { a: 1 } })).toBeNull();
  });
});

describe('FCM direto: data como mapa de textos', () => {
  it('link e entidades chegam como texto e são lidos como antes', () => {
    const dados = dadosDoPush({ link: '/m/core/notificacoes', entidades: '["pedido","meta"]' });
    expect(rotaDoPush(dados)).toBe('/m/core/notificacoes');
    expect(entidadesDoPush(dados)).toEqual(['pedido', 'meta']);
    expect(entidadesDoPush(dadosDoPush({ entidades: 'pedido,cliente_condicao' }))).toEqual(['pedido', 'cliente_condicao']);
  });
  it('formato Expo (dataString JSON) continua aceito e prevalece sobre as chaves soltas', () => {
    const dados = dadosDoPush({ dataString: '{"link":"/m/pedido?id=abc","entidades":["pedido"]}', link: '/m/outra' });
    expect(rotaDoPush(dados)).toBe('/m/pedido?id=abc');
    expect(entidadesDoPush(dados)).toEqual(['pedido']);
    expect(dadosDoPush({ dataString: '{quebrado', link: '/m/x' })).toEqual({ dataString: '{quebrado', link: '/m/x' });
  });
  it('dados ausentes ou fora do formato viram mapa vazio', () => {
    expect(dadosDoPush(undefined)).toEqual({});
    expect(dadosDoPush('texto')).toEqual({});
    expect(dadosDoPush(['a'])).toEqual({});
  });
  it('mensagem da tarefa: só de dados (silencioso) × com bloco notification (visível)', () => {
    const silencioso = mensagemDaTarefaPush({ data: { entidades: 'pedido', dataString: null }, notification: null });
    expect(silencioso.soDados).toBe(true);
    expect(entidadesDoPush(silencioso.dados)).toEqual(['pedido']);
    const visivel = mensagemDaTarefaPush({ data: { link: '/m/pedidos' }, notification: { title: 'Pedido aprovado', body: 'ok' } });
    expect(visivel.soDados).toBe(false);
    expect(rotaDoPush(visivel.dados)).toBe('/m/pedidos');
    expect(mensagemDaTarefaPush(undefined)).toEqual({ dados: {}, soDados: true });
  });
});

describe('rotaDoPush', () => {
  it('abre a rota interna do link ou o detalhe do pedido', () => {
    expect(rotaDoPush({ link: '/m/core/notificacoes' })).toBe('/m/core/notificacoes');
    expect(rotaDoPush({ link: '/m/pedido?id=abc' })).toBe('/m/pedido?id=abc');
    expect(rotaDoPush({ pedido_id: '5b0c7b1e-3c1f-4a43-9a43-0c6f0b9a1d22' })).toBe('/m/pedido?id=5b0c7b1e-3c1f-4a43-9a43-0c6f0b9a1d22');
  });
  it('nunca abre endereço externo', () => {
    expect(rotaDoPush({ link: 'https://exemplo.com' })).toBeNull();
    expect(rotaDoPush({ link: '//exemplo.com/x' })).toBeNull();
    expect(rotaDoPush({ link: 'macuxicampo://x' })).toBeNull();
    expect(rotaDoPush({ pedido_id: 'x"; drop' })).toBeNull();
    expect(rotaDoPush(undefined)).toBeNull();
  });
});

describe('pushSilencioso e token', () => {
  it('silencioso = sem título e sem corpo', () => {
    expect(pushSilencioso({ title: null, body: null })).toBe(true);
    expect(pushSilencioso({})).toBe(true);
    expect(pushSilencioso({ title: 'Pedido aprovado', body: '' })).toBe(false);
  });
  it('só token FCM: texto sem espaço, de 20 a 300 caracteres, com letras, dígitos, _, : e -', () => {
    expect(TOKEN_FCM).toHaveLength(162);
    expect(tokenFcmValido(TOKEN_FCM)).toBe(true);
    expect(tokenFcmValido('a'.repeat(300))).toBe(true);
    expect(tokenFcmValido('a'.repeat(301))).toBe(false);
    expect(tokenFcmValido('curto:1')).toBe(false);
    expect(tokenFcmValido('')).toBe(false);
    expect(tokenFcmValido(`${TOKEN_FCM} x`)).toBe(false);
    expect(tokenFcmValido(`${TOKEN_FCM}/x`)).toBe(false);
    expect(tokenFcmValido(null)).toBe(false);
    expect(tokenFcmValido(123)).toBe(false);
  });
  it('o token do Expo não é mais aceito', () => {
    expect(tokenFcmValido('ExponentPushToken[abcdefghijklmnopqrstuvwxyz]')).toBe(false);
    expect(tokenFcmValido('ExpoPushToken[abcdefghijklmnopqrstuvwxyz]')).toBe(false);
  });
});

describe('precisaRegistrarPush', () => {
  const agora = Date.parse('2026-11-02T15:00:00Z');
  const reg = { token: 'fcm:token-a', dispositivo_id: 'd1', em: new Date(agora - 60_000).toISOString() };
  it('registra na primeira vez, com token ou aparelho novo e depois de 7 dias', () => {
    expect(chaveRegistroPush('u1')).toBe('fv:push:u1');
    expect(precisaRegistrarPush(null, 'fcm:token-a', 'd1', agora)).toBe(true);
    expect(precisaRegistrarPush(reg, 'fcm:token-a', 'd1', agora)).toBe(false);
    expect(precisaRegistrarPush(reg, 'fcm:token-b', 'd1', agora)).toBe(true);
    expect(precisaRegistrarPush(reg, 'fcm:token-a', 'd2', agora)).toBe(true);
    expect(precisaRegistrarPush(reg, 'fcm:token-a', 'd1', agora + VALIDADE_REGISTRO_PUSH_MS)).toBe(true);
  });
});
