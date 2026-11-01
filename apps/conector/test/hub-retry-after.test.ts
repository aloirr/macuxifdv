import { describe, expect, it } from 'vitest';
import { ClienteHub, esperaRetryAfter } from '../src/hub/cliente';

describe('Retry-After do Hub (RFC 9110)', () => {
  const AGORA = Date.parse('2026-03-10T12:00:00Z');

  it('aceita segundos inteiros ou decimais', () => {
    expect(esperaRetryAfter('30', AGORA)).toBe(30_000);
    expect(esperaRetryAfter('1.5', AGORA)).toBe(1500);
  });

  it('aceita data HTTP: a espera é a diferença até a data', () => {
    expect(esperaRetryAfter('Tue, 10 Mar 2026 12:00:45 GMT', AGORA)).toBe(45_000);
  });

  it('ausente, zero, inválido ou data passada: sem espera mínima (vale o backoff normal)', () => {
    expect(esperaRetryAfter(null, AGORA)).toBeUndefined();
    expect(esperaRetryAfter('', AGORA)).toBeUndefined();
    expect(esperaRetryAfter('0', AGORA)).toBeUndefined();
    expect(esperaRetryAfter('-5', AGORA)).toBeUndefined();
    expect(esperaRetryAfter('em breve', AGORA)).toBeUndefined();
    expect(esperaRetryAfter('Tue, 10 Mar 2026 11:59:00 GMT', AGORA)).toBeUndefined();
  });

  it('o cliente respeita Retry-After em data HTTP no retry (limitado ao teto)', async () => {
    const esperas: number[] = [];
    let n = 0;
    const fetchFalso = (async () => {
      n++;
      if (n === 1) return new Response('{}', { status: 503, headers: { 'Retry-After': 'Tue, 10 Mar 2026 12:00:20 GMT' } });
      return new Response(JSON.stringify({ entidade: 'cliente', cursor: null, atualizado_em: null }), { status: 200 });
    }) as unknown as typeof fetch;
    const hub = new ClienteHub({
      url: 'https://hub.exemplo.com.br',
      token: async () => 't',
      agora: () => AGORA,
      fetch: fetchFalso,
      retry: { tentativas: 2, baseMs: 1, maxMs: 60_000, aleatorio: () => 0, dormir: async () => undefined },
      aoRetentar: (i) => esperas.push(i.esperaMs),
    });
    const r = await hub.consultarCursor('cliente');
    expect(r.cursor).toBeNull();
    expect(n).toBe(2);
    expect(esperas).toEqual([20_000]);
  });
});
