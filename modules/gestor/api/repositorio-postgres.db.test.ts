/**
 * Repositório do Gestor × Postgres (T-0055; roteiro docs/banco/gestor.md §3). Papel macuxi_app, RLS, fixture dois-tenants.
 * "Processos diferentes" = DUAS conexões (pools) sem estado em comum: o consumidor (worker) grava por uma e a API lê pela
 * outra. Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ClienteBanco } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CondicaoAlerta } from '../contracts';
import { checkin, CLIENTE_A, pedidoCriado, u } from '../domain/fixtures';
import { criarRepositorioPostgres } from './repositorio-postgres';

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;

describe.skipIf(semBanco())('Gestor × Postgres: RepositorioGestor SQL', () => {
  let poolWorker: pg.Pool;
  let poolApi: pg.Pool;
  let admin: pg.Pool;
  const repo = criarRepositorioPostgres();
  const como = <T>(pool: pg.Pool, tenant: string, fn: (a: { db: ClienteBanco; tenant_id: string }) => Promise<T>) =>
    comTenant(pool, tenant, (c) => fn({ db: c as unknown as ClienteBanco, tenant_id: tenant }));

  beforeAll(() => {
    poolWorker = new pg.Pool({ connectionString: banco().urlApp, max: 2 });
    poolApi = new pg.Pool({ connectionString: banco().urlApp, max: 2 });
    admin = new pg.Pool({ connectionString: banco().urlAdmin, max: 1 });
  });
  afterAll(async () => {
    await Promise.all([poolWorker?.end(), poolApi?.end(), admin?.end()]);
  });
  beforeEach(async () => {
    for (const t of ['evento_aplicado', 'projecao_fato', 'alerta', 'alerta_regra']) await admin.query(`delete from gestor.${t} where tenant_id = any($1::uuid[])`, [[A, B]]);
  });

  it('o consumidor (conexão do worker) grava e a API (outra conexão) lê a mesma projeção', async () => {
    const e = pedidoCriado({ pedido: u(9001), total: 100_00 }, 'ev-proc-1');
    const r = await como(poolWorker, A, (a) => repo.aplicar(a, [e]));
    expect(r.contagem.aplicado).toBe(1);
    const estado = await como(poolApi, A, (a) => repo.estado(a));
    expect(estado.processados['ev-proc-1']).toBe(true);
    expect(Object.keys(estado.pedidos)).toContain(u(9001));
  });

  it('reentrega do mesmo evento não duplica nem muda (idempotente por evento_id)', async () => {
    const e = pedidoCriado({ pedido: u(9002), total: 50_00 }, 'ev-reent-1');
    await como(poolWorker, A, (a) => repo.aplicar(a, [e]));
    const r2 = await como(poolWorker, A, (a) => repo.aplicar(a, [e]));
    expect(r2.contagem.aplicado).toBe(0);
    expect(r2.contagem.duplicado).toBe(1);
    expect((await admin.query(`select count(*)::int n from gestor.evento_aplicado where tenant_id = $1 and evento_id = 'ev-reent-1'`, [A])).rows[0].n).toBe(1);
    expect((await admin.query(`select count(*)::int n from gestor.projecao_fato where tenant_id = $1 and tabela = 'pedidos'`, [A])).rows[0].n).toBe(1);
  });

  it('dois consumidores simultâneos do mesmo tenant não perdem fatos (lock por tenant)', async () => {
    const e1 = pedidoCriado({ pedido: u(9003), total: 10_00 }, 'ev-par-1');
    const e2 = checkin({ visita: u(9004), em: '2026-10-30T15:00:00Z' });
    await Promise.all([como(poolWorker, A, (a) => repo.aplicar(a, [e1])), como(poolApi, A, (a) => repo.aplicar(a, [e2]))]);
    const estado = await como(poolApi, A, (a) => repo.estado(a));
    expect(Object.keys(estado.pedidos)).toContain(u(9003));
    expect(Object.keys(estado.visitas)).toContain(u(9004));
  });

  it('multi-tenant: o tenant B não enxerga a projeção, os alertas nem as regras do A (RN-CORE-05)', async () => {
    await como(poolWorker, A, (a) => repo.aplicar(a, [pedidoCriado({ pedido: u(9005), total: 1_00 }, 'ev-mt-1')]));
    const cond: CondicaoAlerta = { chave: `cliente_sem_visita:${CLIENTE_A}`, tipo: 'cliente_sem_visita', alvo_tipo: 'cliente', alvo_id: CLIENTE_A, responsavel_id: null, valor: 9, limiar: 7, severidade: 'atencao', mensagem: 'Sem visita há 9 dias' };
    await como(poolWorker, A, (a) => repo.aplicarOperacoesAlerta(a, { abrir: [cond], atualizar: [], encerrar: [] }, { agora: '2026-10-30T12:00:00.000Z', novoId: () => u(9100) }));
    await como(poolWorker, A, (a) => repo.gravarAjustesRegras(a, { cliente_sem_visita: { limiar: 10 } }));

    expect(Object.keys((await como(poolApi, B, (a) => repo.estado(a))).pedidos)).not.toContain(u(9005));
    expect(await como(poolApi, B, (a) => repo.alertas(a))).toEqual([]);
    expect(await como(poolApi, B, (a) => repo.ajustesRegras(a))).toEqual({});
    // tenant errado no acesso (corpo adulterado): a RLS e o filtro devolvem vazio, sem erro de vazamento
    expect(await como(poolApi, B, (a) => repo.alertas({ ...a, tenant_id: A }))).toEqual([]);

    const alertas = await como(poolApi, A, (a) => repo.alertas(a));
    expect(alertas).toHaveLength(1);
    expect(alertas[0]).toMatchObject({ id: u(9100), status: 'aberto', valor: 9, aberto_em: '2026-10-30T12:00:00.000000Z' });
  });

  it('alertas: atualizar, dispensar, encerrar libera a chave para um novo; regras: gravar e remover', async () => {
    const cond: CondicaoAlerta = { chave: `cliente_sem_visita:${CLIENTE_A}`, tipo: 'cliente_sem_visita', alvo_tipo: 'cliente', alvo_id: CLIENTE_A, responsavel_id: null, valor: 9, limiar: 7, severidade: 'atencao', mensagem: 'm' };
    const o = (id: number) => ({ agora: '2026-10-30T12:00:00.000Z', novoId: () => u(id) });
    await como(poolWorker, A, (a) => repo.aplicarOperacoesAlerta(a, { abrir: [cond], atualizar: [], encerrar: [] }, o(9201)));
    await como(poolWorker, A, (a) => repo.aplicarOperacoesAlerta(a, { abrir: [], atualizar: [{ id: u(9201), valor: 12, mensagem: 'm2', severidade: 'critica' }], encerrar: [] }, o(0)));
    const [vivo] = await como(poolApi, A, (a) => repo.alertas(a));
    expect(vivo).toMatchObject({ valor: 12, mensagem: 'm2', severidade: 'critica' });
    await como(poolApi, A, (a) => repo.gravarAlerta(a, { ...vivo!, status: 'dispensado' }));
    expect((await como(poolApi, A, (a) => repo.alertas(a)))[0]!.status).toBe('dispensado');
    // encerra e abre outro com a mesma chave na mesma operação (encerrar → abrir)
    await como(poolWorker, A, (a) => repo.aplicarOperacoesAlerta(a, { abrir: [cond], atualizar: [], encerrar: [{ id: u(9201), motivo: 'condicao_normalizada', encerrado_em: '2026-10-31T12:00:00.000Z' }] }, o(9202)));
    const todos = await como(poolApi, A, (a) => repo.alertas(a));
    expect(todos.map((x) => x.status).sort()).toEqual(['aberto', 'encerrado']);

    await como(poolApi, A, (a) => repo.gravarAjustesRegras(a, { cliente_sem_visita: { limiar: 10 }, visita_curta: { ativa: false } }));
    expect(await como(poolWorker, A, (a) => repo.ajustesRegras(a))).toEqual({ cliente_sem_visita: { limiar: 10 }, visita_curta: { ativa: false } });
    await como(poolApi, A, (a) => repo.gravarAjustesRegras(a, { visita_curta: { ativa: false } }));
    expect(await como(poolWorker, A, (a) => repo.ajustesRegras(a))).toEqual({ visita_curta: { ativa: false } });
  });

  it('retenção: aplicar apaga a idempotência com mais de 120 dias do próprio tenant e preserva a do outro', async () => {
    for (const [t, id] of [[A, 'velho-A'], [B, 'velho-B']] as const) {
      await admin.query(`insert into gestor.evento_aplicado (tenant_id, evento_id, nome, ocorrido_em, created_at) values ($1, $2, 'core.cliente.atualizado@1', now(), now() - interval '121 days')`, [t, id]); // hora-fixa-ok: idade relativa ao relógio do banco (created_at = now())
    }
    await como(poolWorker, A, (a) => repo.aplicar(a, [pedidoCriado({ pedido: u(9300), total: 1_00 }, 'ev-ret-1')]));
    const ids = (await admin.query<{ evento_id: string }>(`select evento_id from gestor.evento_aplicado where tenant_id = any($1::uuid[])`, [[A, B]])).rows.map((r) => r.evento_id);
    expect(ids).not.toContain('velho-A');
    expect(ids).toContain('velho-B');
    expect(ids).toContain('ev-ret-1');
  });
});
