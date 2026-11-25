/** T-0121 N2: o push (FCM, ADR 0053) sai por `ctx.aposConfirmar` (depois do commit), não dentro da transação do consumo. */
import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { criarConsumidorPushNotificacao } from './consumidores';
const P = { notificacao_id: 'n1', usuario_id: 'u1', tipo: 'recado', prioridade: 'alta' };
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const ENV = {
    MACUXI_PUSH_ATIVO: '1',
    FCM_PROJECT_ID: 'proj-x',
    FCM_SERVICE_ACCOUNT_JSON: Buffer.from(JSON.stringify({ client_email: 'srv@proj.iam.gserviceaccount.com', private_key: privateKey })).toString('base64'),
};
/** Responde o OAuth do Google (200) e o FCM com `statusFcm`. */
const fetcherFcm = (statusFcm, json = {}) => vi.fn(async (url) => url.startsWith('https://oauth2.googleapis.com')
    ? new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
    : new Response(JSON.stringify(json), { status: statusFcm }));
const chamadasFcm = (f) => f.mock.calls.filter((c) => String(c[0]).includes('fcm.googleapis.com'));
function montar(fetcher) {
    const efeitos = [];
    const queries = [];
    const db = {
        query: vi.fn(async (sql) => {
            queries.push(sql);
            if (sql.includes('from core.notificacao'))
                return { rows: [{ titulo: 'T', corpo: 'C', link: null, prioridade: 'alta', push_enviado_em: null, lida_em: null }] };
            if (sql.includes('from core.dispositivo'))
                return { rows: [{ push_token: 'fcm-token-x:APA91b' }] };
            return { rows: [] };
        }),
    };
    const ctx = { db, agora: () => new Date('2026-11-09T10:00:00Z'), aposConfirmar: (e) => void efeitos.push(e) };
    const c = { comTenant: async (fn) => fn(db), agora: () => new Date('2026-11-09T10:00:00Z') };
    const consumidor = criarConsumidorPushNotificacao({ env: ENV, fetcher });
    return { consumidor, ctx, efeitos, c, queries };
}
describe('T-0121 N2: push depois do commit', () => {
    it('o handler não chama a rede; agenda o envio e só ele marca push_enviado_em', async () => {
        const fetcher = fetcherFcm(200);
        const { consumidor, ctx, efeitos, c, queries } = montar(fetcher);
        await consumidor.executar(P, ctx);
        expect(fetcher).not.toHaveBeenCalled();
        expect(efeitos).toHaveLength(1);
        await efeitos[0](c);
        expect(chamadasFcm(fetcher)).toHaveLength(1);
        expect(queries.some((q) => q.includes('update core.notificacao set push_enviado_em') && q.includes('push_enviado_em is null'))).toBe(true);
    });
    it('FCM recusando faz o efeito lançar (o despachante desfaz o consumo) e não marca', async () => {
        const fetcher = fetcherFcm(503);
        const { consumidor, ctx, efeitos, c, queries } = montar(fetcher);
        await consumidor.executar(P, ctx);
        await expect(efeitos[0](c)).rejects.toThrow(/HTTP 503/);
        expect(queries.some((q) => q.includes('update core.notificacao'))).toBe(false);
    });
    it('RF-CORE-09: token que o FCM recusa como inexistente (UNREGISTERED) é limpo do aparelho, sem erro e sem marcar', async () => {
        const fetcher = fetcherFcm(404, { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } });
        const { consumidor, ctx, efeitos, c, queries } = montar(fetcher);
        await consumidor.executar(P, ctx);
        await efeitos[0](c);
        expect(queries.some((q) => q.includes('update core.dispositivo set push_token = null'))).toBe(true);
        expect(queries.some((q) => q.includes('update core.notificacao'))).toBe(false);
    });
    it('flag desligada: nada agendado', async () => {
        const { ctx, efeitos } = montar(vi.fn());
        await criarConsumidorPushNotificacao({ env: {} }).executar(P, ctx);
        expect(efeitos).toHaveLength(0);
    });
});
