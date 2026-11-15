import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { tipoDoToken, tokenPushFcmValido } from '../contracts';
import { assinarJwtGoogle, enviarPush, montarMensagemExpo, montarMensagemFcm, pushAtivo, type CacheOAuth } from './push';

const destino = { token: 'ExponentPushToken[abc]', titulo: 'Recado', corpo: 'Reunião às 9h', link: '/m/core/notificacoes', prioridade: 'alta' as const };

describe('RF-CORE-09: push atrás de configuração', () => {
  it('desligado por padrão: não toca na rede', async () => {
    const f = vi.fn();
    expect(pushAtivo({})).toBe(false);
    expect(await enviarPush([destino], { env: {}, fetcher: f as never })).toEqual({ enviadas: 0, ignoradas: 1, limpas: 0 });
    expect(f).not.toHaveBeenCalled();
  });
  it('ligado sem FCM configurado: envia só tokens do Expo, prioridade alta vira high, sem texto fora da mensagem', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    const r = await enviarPush([destino, { ...destino, token: 'lixo' }], { env: { MACUXI_PUSH_ATIVO: '1' }, fetcher: f as never, log: () => undefined });
    expect(r).toEqual({ enviadas: 1, ignoradas: 1, limpas: 0 });
    const corpo = JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(corpo).toEqual([{ to: destino.token, title: 'Recado', body: 'Reunião às 9h', priority: 'high', data: { link: '/m/core/notificacoes' } }]);
  });
  it('RN-CORE-23: push silencioso não leva title nem body, só data.entidades, com prioridade alta', () => {
    const m = montarMensagemExpo({ ...destino, titulo: '', corpo: '', prioridade: 'normal', entidades: ['meta', 'notificacao'] })!;
    expect(m).toEqual({ to: destino.token, priority: 'high', data: { link: '/m/core/notificacoes', entidades: ['meta', 'notificacao'] } });
    expect('title' in m || 'body' in m).toBe(false);
  });
  it('corpo longo é cortado e token inválido não gera mensagem', () => {
    expect(montarMensagemExpo({ ...destino, corpo: 'x'.repeat(500) })!.body).toHaveLength(178);
    expect(montarMensagemExpo({ ...destino, token: '' })).toBeNull();
  });
});

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const conta = { client_email: 'srv@proj.iam.gserviceaccount.com', private_key: privateKey, private_key_id: 'kid1' };
const envFcm = {
  MACUXI_PUSH_ATIVO: '1',
  FCM_PROJECT_ID: 'proj-x',
  FCM_SERVICE_ACCOUNT_JSON: Buffer.from(JSON.stringify(conta)).toString('base64'),
};
const dFcm = { ...destino, token: 'fcm-token-opaco:APA91b', entidades: ['catalogo.produto'] };

interface Chamada {
  url: string;
  init: { headers: Record<string, string>; body: string };
}
function fcmFalso(respostaFcm: (n: number, c: Chamada) => { status: number; json?: unknown }) {
  const chamadas: Chamada[] = [];
  let nOauth = 0;
  let nFcm = 0;
  const fetcher = vi.fn(async (url: string, init: Chamada['init']) => {
    chamadas.push({ url, init });
    if (url.startsWith('https://oauth2.googleapis.com')) {
      nOauth++;
      return new Response(JSON.stringify({ access_token: `tok${nOauth}`, expires_in: 3600 }), { status: 200 });
    }
    const r = respostaFcm(++nFcm, { url, init });
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status });
  });
  return { fetcher: fetcher as never, chamadas, oauth: () => nOauth, fcm: () => nFcm };
}

describe('ADR 0053: tipo do token', () => {
  it('RD-0442: tokenPushFcmValido aceita só FCM de 1 a 300 caracteres', () => {
    expect(tokenPushFcmValido('ExponentPushToken[abc]')).toBe(false);
    expect(tokenPushFcmValido('cXyz:APA91b')).toBe(true);
    expect(tokenPushFcmValido('')).toBe(false);
    expect(tokenPushFcmValido('a'.repeat(301))).toBe(false);
  });

  it('tipoDoToken: Expo pelo formato, o resto é FCM', () => {
    expect(tipoDoToken('ExponentPushToken[abc]')).toBe('expo');
    expect(tipoDoToken('ExpoPushToken[abc]')).toBe('expo');
    expect(tipoDoToken('ExpoPushToken[]')).toBe('fcm');
    expect(tipoDoToken('cXyz:APA91b')).toBe('fcm');
  });
});

describe('ADR 0053: FCM HTTP v1', () => {
  it('mensagem: HIGH, canal avisos, data só texto, link omitido se nulo', () => {
    const m = montarMensagemFcm(dFcm);
    expect(m).toEqual({
      message: {
        token: dFcm.token,
        notification: { title: 'Recado', body: 'Reunião às 9h' },
        android: { priority: 'HIGH', notification: { channel_id: 'avisos' } },
        data: { link: '/m/core/notificacoes', entidades: '["catalogo.produto"]' },
      },
    });
    expect(Object.values(m.message.data).every((v) => typeof v === 'string')).toBe(true);
    expect(montarMensagemFcm({ ...dFcm, link: null, entidades: undefined }).message.data).toEqual({});
  });
  it('RN-CORE-23: silencioso só com data e prioridade HIGH', () => {
    const m = montarMensagemFcm({ ...dFcm, titulo: '', corpo: '' });
    expect('notification' in m.message).toBe(false);
    expect(m.message.android).toEqual({ priority: 'HIGH' });
    expect(m.message.data.entidades).toBe('["catalogo.produto"]');
  });
  it('JWT RS256 com assinatura válida na chave pública e carga esperada', () => {
    const jwt = assinarJwtGoogle(conta, 1_700_000_000_000);
    const [h, c, a] = jwt.split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'kid1' });
    expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toEqual({
      iss: conta.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    expect(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(a, 'base64url'))).toBe(true);
  });
  it('envia ao FCM com Bearer, mistura com Expo e faz cache do token OAuth', async () => {
    const f = fcmFalso(() => ({ status: 200 }));
    const cache: CacheOAuth = {};
    let agora = 0;
    const o = { env: envFcm, fetcher: f.fetcher, cache, agora: () => agora };
    const r = await enviarPush([destino, dFcm], o);
    expect(r).toEqual({ enviadas: 2, ignoradas: 0, limpas: 0 });
    const chamadaFcm = f.chamadas.find((c) => c.url.includes('fcm.googleapis.com'))!;
    expect(chamadaFcm.url).toBe('https://fcm.googleapis.com/v1/projects/proj-x/messages:send');
    expect(chamadaFcm.init.headers.authorization).toBe('Bearer tok1');
    await enviarPush([dFcm], o);
    expect(f.oauth()).toBe(1);
    agora = 3600_000 - 299_000; // dentro dos 5 min finais: renova
    await enviarPush([dFcm], o);
    expect(f.oauth()).toBe(2);
  });
  it('401 renova o token OAuth e tenta uma vez', async () => {
    const f = fcmFalso((n) => (n === 1 ? { status: 401 } : { status: 200 }));
    const r = await enviarPush([dFcm], { env: envFcm, fetcher: f.fetcher, cache: {} });
    expect(r.enviadas).toBe(1);
    expect(f.oauth()).toBe(2);
    expect(f.chamadas.filter((c) => c.url.includes('fcm.googleapis.com'))[1]!.init.headers.authorization).toBe('Bearer tok2');
    const g = fcmFalso(() => ({ status: 401 }));
    await expect(enviarPush([dFcm], { env: envFcm, fetcher: g.fetcher, cache: {} })).rejects.toThrow(/401/);
    expect(g.fcm()).toBe(2);
  });
  it('UNREGISTERED (404) e INVALID_ARGUMENT do token limpam o push_token sem erro', async () => {
    const limpos: string[] = [];
    const limparToken = async (t: string) => void limpos.push(t);
    const a = fcmFalso(() => ({ status: 404, json: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } }));
    expect(await enviarPush([dFcm], { env: envFcm, fetcher: a.fetcher, cache: {}, limparToken })).toEqual({ enviadas: 0, ignoradas: 0, limpas: 1 });
    const b = fcmFalso(() => ({ status: 400, json: { error: { status: 'INVALID_ARGUMENT', details: [{ fieldViolations: [{ field: 'message.token' }] }] } } }));
    await enviarPush([dFcm], { env: envFcm, fetcher: b.fetcher, cache: {}, limparToken });
    expect(limpos).toEqual([dFcm.token, dFcm.token]);
  });
  it('5xx, 429 e rede viram erro para a outbox, sem derrubar os outros tokens', async () => {
    const f = fcmFalso((_n, c) => (JSON.parse(c.init.body).message.token === 'ruim' ? { status: 503 } : { status: 200 }));
    await expect(enviarPush([{ ...dFcm, token: 'ruim' }, dFcm], { env: envFcm, fetcher: f.fetcher, cache: {} })).rejects.toThrow(/503/);
    expect(f.fcm()).toBe(2);
    const g = fcmFalso(() => ({ status: 429 }));
    await expect(enviarPush([dFcm], { env: envFcm, fetcher: g.fetcher, cache: {} })).rejects.toThrow(/429/);
    const rede = vi.fn(async (url: string) => {
      if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
      throw new TypeError('fetch failed');
    });
    await expect(enviarPush([dFcm], { env: envFcm, fetcher: rede as never, cache: {} })).rejects.toThrow(/rede/);
  });
  it('no máximo 5 em paralelo', async () => {
    let ativos = 0;
    let pico = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
      ativos++;
      pico = Math.max(pico, ativos);
      await new Promise((r) => setTimeout(r, 5));
      ativos--;
      return new Response('{}');
    });
    const ds = Array.from({ length: 12 }, (_, i) => ({ ...dFcm, token: `t${i}` }));
    expect((await enviarPush(ds, { env: envFcm, fetcher: fetcher as never, cache: {} })).enviadas).toBe(12);
    expect(pico).toBe(5);
  });
  it('sem os secrets: FCM ignorado com log sem dado pessoal e Expo intacto', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }));
    const log = vi.fn();
    const r = await enviarPush([destino, dFcm], { env: { MACUXI_PUSH_ATIVO: '1' }, fetcher: f as never, log });
    expect(r).toEqual({ enviadas: 1, ignoradas: 1, limpas: 0 });
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls as unknown as string[][])[0]![0]).toContain('exp.host');
    expect(log).toHaveBeenCalledWith('push_fcm_desligado');
    expect(JSON.stringify(log.mock.calls)).not.toContain(dFcm.token);
    const r2 = await enviarPush([dFcm], { env: { ...envFcm, FCM_SERVICE_ACCOUNT_JSON: 'lixo' }, fetcher: f as never, log });
    expect(r2.enviadas).toBe(0);
  });
});
