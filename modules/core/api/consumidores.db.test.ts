/**
 * T-0022 × Postgres real: handler do push de `core.notificacao.criada@1` (RF-CORE-09). Cobre o handler com `ctx.db` do
 * `comTenant` (como o despachante o entrega) e a ligação no manifesto/`moduloApi`; o ciclo do despachante em si
 * (consumo único, reentrega) é do teste de `apps/api`. Pula sem Postgres.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ContextoConsumo } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { manifest } from '../manifest';
import { criarConsumidorPushNotificacao } from './consumidores';
import { moduloApi } from './index';

const A = DOIS_TENANTS.A;
const U = A.usuarios;
const NIDS = [1, 2, 3].map((n) => `0e500000-0000-4000-8000-${String(n).padStart(12, '0')}`);
const TOKEN = 'ExponentPushToken[fixture-push]';

describe('T-0022: o Core consome o próprio evento de notificação', () => {
  it('manifesto declara o consumo e o moduloApi expõe o consumidor (o despachante só entrega o que está em consome)', () => {
    expect(manifest.consome).toContain('core.notificacao.criada@1');
    expect(moduloApi.consumidores?.map((c) => c.evento.nome)).toContain('core.notificacao.criada@1');
  });
});

describe.skipIf(semBanco())('Core T-0022 × Postgres: push da notificação', () => {
  let pool: pg.Pool;
  /** Relógio congelado uma vez (uma linha do tempo só, junto das colunas `now()` do banco); sem data fixa. */
  const agora = new Date();
  const consumo = (fn: (db: pg.ClientBase) => Promise<void>) => comTenant(pool, A.tenantId, (c) => fn(c));
  const rodar = (opcoes: Parameters<typeof criarConsumidorPushNotificacao>[0], notificacaoId: string, tenant = A.tenantId) =>
    comTenant(pool, tenant, (db) =>
      criarConsumidorPushNotificacao(opcoes).executar(
        { notificacao_id: notificacaoId, usuario_id: U.vendedor1, tipo: 'recado', prioridade: 'alta' },
        { db, agora: () => agora, envelope: { evento_id: 'x', tenant_id: tenant }, publicar: vi.fn(), log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as unknown as ContextoConsumo,
      ),
    );
  const enviadoEm = (id: string) => comTenant(pool, A.tenantId, async (c) => (await c.query<{ push_enviado_em: Date | null }>('select push_enviado_em from core.notificacao where id = $1', [id])).rows[0]!.push_enviado_em);

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 3 });
    await consumo(async (c) => {
      await c.query('update core.dispositivo set push_token = $2, push_plataforma = $3 where id = $1', [A.dispositivos.vendedor1, TOKEN, 'android']);
      for (const id of NIDS) {
        await c.query(
          `insert into core.notificacao (id, tenant_id, usuario_id, tipo, titulo, corpo, origem_modulo, prioridade)
           values ($1, plataforma.tenant_atual(), $2, 'recado', 'Aviso de push', 'Corpo do aviso', 'core', 'alta') on conflict (id) do nothing`,
          [id, U.vendedor1],
        );
      }
    });
  });
  afterAll(async () => {
    if (pool) {
      await consumo(async (c) => {
        await c.query('delete from core.notificacao where id = any($1::uuid[])', [NIDS]);
        await c.query('update core.dispositivo set push_token = null, push_plataforma = null where id = $1', [A.dispositivos.vendedor1]);
      });
    }
    await pool?.end();
  });

  it('flag desligada: consome sem rede e não marca push_enviado_em', async () => {
    const fetcher = vi.fn();
    await rodar({ env: {}, fetcher: fetcher as never }, NIDS[0]!);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await enviadoEm(NIDS[0]!)).toBeNull();
  });

  it('flag ligada: envia ao token do aparelho com título/corpo do banco e marca push_enviado_em; repetir o evento não reenvia', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    const opcoes = { env: { MACUXI_PUSH_ATIVO: '1' }, fetcher: fetcher as never };
    await rodar(opcoes, NIDS[1]!);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const corpo = JSON.parse((fetcher.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(corpo).toEqual([{ to: TOKEN, title: 'Aviso de push', body: 'Corpo do aviso', priority: 'high', data: { link: null } }]);
    expect((await enviadoEm(NIDS[1]!))?.toISOString()).toBe(agora.toISOString());
    await rodar(opcoes, NIDS[1]!);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('já lida não gera push; HTTP recusado lança (o despachante retenta) e não marca; outro tenant não enxerga a notificação (RLS)', async () => {
    await consumo(async (c) => void (await c.query('update core.notificacao set lida_em = now() where id = $1', [NIDS[2]!])));
    const fetcher = vi.fn(async () => ({ ok: false, status: 500 }) as Response);
    const opcoes = { env: { MACUXI_PUSH_ATIVO: '1' }, fetcher: fetcher as never };
    await rodar(opcoes, NIDS[2]!);
    expect(fetcher).not.toHaveBeenCalled();
    await consumo(async (c) => void (await c.query('update core.notificacao set lida_em = null where id = $1', [NIDS[2]!])));
    await expect(rodar(opcoes, NIDS[2]!)).rejects.toThrow(/HTTP 500/);
    expect(await enviadoEm(NIDS[2]!)).toBeNull();
    fetcher.mockClear();
    await rodar(opcoes, NIDS[2]!, DOIS_TENANTS.B.tenantId);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
