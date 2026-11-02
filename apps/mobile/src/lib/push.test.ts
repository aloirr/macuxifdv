/** T-0065 (A) — RN-CORE-23 item 3: push do servidor no app (lista de entidades, rota ao tocar, silencioso, registro do token). */
import { describe, expect, it } from 'vitest';

import { chaveRegistroPush, entidadesDoPush, precisaRegistrarPush, pushSilencioso, rotaDoPush, tokenExpoValido, VALIDADE_REGISTRO_PUSH_MS } from './push';

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
  it('só token do Expo', () => {
    expect(tokenExpoValido('ExponentPushToken[abc]')).toBe(true);
    expect(tokenExpoValido('ExpoPushToken[abc]')).toBe(true);
    expect(tokenExpoValido('fcm-token-cru')).toBe(false);
    expect(tokenExpoValido(null)).toBe(false);
  });
});

describe('precisaRegistrarPush', () => {
  const agora = Date.parse('2026-11-02T15:00:00Z');
  const reg = { token: 'ExponentPushToken[a]', dispositivo_id: 'd1', em: new Date(agora - 60_000).toISOString() };
  it('registra na primeira vez, com token ou aparelho novo e depois de 7 dias', () => {
    expect(chaveRegistroPush('u1')).toBe('fv:push:u1');
    expect(precisaRegistrarPush(null, 'ExponentPushToken[a]', 'd1', agora)).toBe(true);
    expect(precisaRegistrarPush(reg, 'ExponentPushToken[a]', 'd1', agora)).toBe(false);
    expect(precisaRegistrarPush(reg, 'ExponentPushToken[b]', 'd1', agora)).toBe(true);
    expect(precisaRegistrarPush(reg, 'ExponentPushToken[a]', 'd2', agora)).toBe(true);
    expect(precisaRegistrarPush(reg, 'ExponentPushToken[a]', 'd1', agora + VALIDADE_REGISTRO_PUSH_MS)).toBe(true);
  });
});
