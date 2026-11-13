/**
 * T-0118 (D-T0107a) × Postgres real: pushes de pedido SIMULTÂNEOS em número maior que o pool da API não travam.
 *
 * O defeito: o push do pedido abre a transação (`ctx.comTenant`, modules/vendedor/api/receber.ts) e, dentro dela,
 * `ctx.carteira()` pedia OUTRA conexão ao mesmo pool. Com pushes em voo >= pool, todas as conexões ficavam presas em
 * transação esperando mais uma. A correção (apps/api/src/app.ts): dentro de `ctx.comTenant`, carteira e usuários visíveis
 * leem pela transação corrente. A guarda (`transacao-corrente.ts`) acusa qualquer outro pedido de conexão dentro de
 * transação do mesmo pool.
 *
 * Aqui: banco efêmero próprio (dois-tenants), `createApp` com os módulos reais (`MODULOS_API`: o push e a carteira do Core
 * de verdade), pool de 2 com `connectionTimeoutMillis` (o travamento vira erro em vez de pendurar o arquivo):
 *  - 6 pushes ao mesmo tempo, 1 pedido cada: os 6 aceitos;
 *  - os mesmos 6 de novo, ao mesmo tempo (reenvio do aparelho, corpo idêntico ao 1º envio): aceitos pela idempotência,
 *    nenhum pedido duplicado;
 *  - a guarda em modo erro: conexão pedida dentro de transação do mesmo pool é recusada antes de esperar o pool;
 *  - 6 pushes NOVOS ao mesmo tempo com a guarda em modo erro: nenhum ponto do push (carteira, consultas, filial, outbox)
 *    pede 2ª conexão (critério 1 da T-0118);
 *  - pool cheio de verdade (1 conexão presa, espera de 300 ms): 503 BANCO_OCUPADO com Retry-After, nada gravado, e o
 *    reenvio do mesmo corpo depois é aceito (a rede de segurança: nunca fila sem prazo).
 * Pula sem Docker/Postgres (aviso no fim); com MACUXI_PG_EXIGIR=1 (CI) falha.
 */
import { randomUUID } from 'node:crypto';
import { carregarDoisTenants, criarBancoDeTeste, DOIS_TENANTS, type BancoDeTeste } from '@macuxi/db/teste';
import { semBanco } from '@macuxi/db/teste/estado';
import type { ModuloId, UsuarioAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { criarBancoApp, RETRY_AFTER_BANCO_OCUPADO_S } from '../src/banco';
import type { LicencasUsuario } from '../src/licencas';
import { MODULOS_API } from '../src/modulos';
import { ErroConexaoNaTransacao } from '../src/transacao-corrente';

const A = DOIS_TENANTS.A;
const POOL = 2;
const SIMULTANEOS = 6;

const vendedor1: UsuarioAutenticado = { id: A.usuarios.vendedor1, tenant_id: A.tenantId, perfil: 'vendedor' };
const autenticar = async (h: Readonly<Record<string, string | undefined>>) => (h['x-teste-usuario'] === 'vendedor1' ? vendedor1 : null);
// licenças fixas (o resto é real: carteira e usuários visíveis do Core, RLS, push do Vendedor, consultas ao Catálogo)
const licencas = async (): Promise<LicencasUsuario> => ({
  ativosNoTenant: ['core', 'catalogo', 'vendedor'] as ModuloId[],
  doPerfil: ['core', 'catalogo', 'vendedor'] as ModuloId[],
  removidosDoUsuario: [],
  parametros: {},
});

describe.skipIf(semBanco())(`T-0118 — ${SIMULTANEOS} pushes de pedido ao mesmo tempo com pool de ${POOL} (D-T0107a)`, () => {
  let banco: BancoDeTeste;
  let pool: pg.Pool;
  let admin: pg.Pool;
  let app: ReturnType<typeof createApp>;
  let produto = '';
  const ids = Array.from({ length: SIMULTANEOS }, () => randomUUID());

  // corpo de cada push montado UMA vez (no beforeAll, depois de achar o produto): o reenvio do aparelho manda o MESMO
  // conteúdo; um created_offline_at novo no reenvio vira outro conteúdo e o Vendedor responde conflito (RN-VEN-33)
  const envios = new Map<string, object>();
  const push = (id: string) =>
    app.inject({ method: 'POST', url: '/v1/sync/push', headers: { 'x-teste-usuario': 'vendedor1' }, payload: envios.get(id)! });
  const rajada = async () => {
    const respostas = await Promise.all(ids.map((id) => push(id)));
    return respostas.map((r) => ({ status: r.statusCode, item: r.statusCode === 200 ? (r.json() as { resultados: { id: string; status: string; codigo?: string }[] }).resultados[0] : r.body }));
  };

  beforeAll(async () => {
    banco = await criarBancoDeTeste({ preparar: (c) => carregarDoisTenants(c).then(() => undefined) });
    // pool pequeno e prazo de conexão: sem a correção, as 2 conexões ficam presas em transação e a rajada volta 5xx em 5 s
    pool = new pg.Pool({ connectionString: banco.urlApp, max: POOL, connectionTimeoutMillis: 5_000 });
    admin = new pg.Pool({ connectionString: banco.urlAdmin, max: 1 });
    // teardown (drop database with force) derruba conexões ociosas: não é erro do caso
    pool.on('error', () => undefined);
    admin.on('error', () => undefined);
    produto = (await admin.query<{ id: string }>("select id from core.produto where tenant_id = $1 and sku = 'ALFA-001'", [A.tenantId])).rows[0]!.id;
    const criadoEm = new Date().toISOString();
    for (const id of ids) {
      envios.set(id, {
        itens: [
          {
            entidade: 'pedido',
            id,
            operacao: 'upsert',
            payload: { id, customer_id: A.clientes.c1, discount_pct: 0, created_offline_at: criadoEm, items: [{ product_id: produto, quantity: 1 }] },
          },
        ],
      });
    }
    // a guarda NÃO entra na prova da rajada: o que se prova é que o pool não trava (a guarda tem caso próprio abaixo)
    app = createApp({ banco: criarBancoApp(pool, { guardaConexao: { modo: 'desligado' } }), modulos: MODULOS_API, autenticar, licencas, logger: false });
    await app.ready();
  }, 180_000);

  afterAll(async () => {
    await app?.close().catch(() => undefined);
    await pool?.end().catch(() => undefined);
    await admin?.end().catch(() => undefined);
    await banco?.apagar().catch(() => undefined);
  });

  it(`${SIMULTANEOS} pushes simultâneos (> pool ${POOL}): todos 200 e aceitos, sem timeout`, async () => {
    const t0 = Date.now();
    const r = await rajada();
    expect(r, JSON.stringify(r)).toEqual(ids.map((id) => ({ status: 200, item: expect.objectContaining({ id, status: 'aceito' }) })));
    // folga larga (máquina dividida no CI); com o defeito, cada push espera o connectionTimeoutMillis e volta 5xx
    expect(Date.now() - t0).toBeLessThan(20_000);
  }, 60_000);

  it('os mesmos pedidos reenviados ao mesmo tempo: aceitos pela idempotência, nenhum duplicado', async () => {
    const r = await rajada();
    expect(r, JSON.stringify(r)).toEqual(ids.map((id) => ({ status: 200, item: expect.objectContaining({ id, status: 'aceito' }) })));
    const linhas = await admin.query<{ id: string; n: string }>('select id, count(*)::text as n from vendedor.pedido where id = any($1::uuid[]) group by id', [ids]);
    expect(linhas.rows.map((l) => [l.id, l.n]).sort()).toEqual(ids.map((id) => [id, '1']).sort());
    const itens = await admin.query<{ n: string }>('select count(*)::text as n from vendedor.pedido_item where pedido_id = any($1::uuid[])', [ids]);
    expect(itens.rows[0]!.n).toBe(String(SIMULTANEOS));
  }, 60_000);

  it('guarda em modo erro: conexão do mesmo pool pedida dentro de transação é recusada e a transação de fora desfeita', async () => {
    const guardado = criarBancoApp(pool, { guardaConexao: { modo: 'erro' } });
    await expect(
      guardado.comTenant(A.tenantId, async (db) => {
        await db.query('select 1');
        return guardado.comTenant(A.tenantId, async () => 'nunca');
      }),
    ).rejects.toBeInstanceOf(ErroConexaoNaTransacao);
    await expect(guardado.comTenant(A.tenantId, async () => guardado.semTenant(async () => 'nunca'))).rejects.toBeInstanceOf(ErroConexaoNaTransacao);
    // fora de transação, segue normal (e o pool não ficou com conexão presa)
    expect(await guardado.comTenant(A.tenantId, async (db) => (await db.query<{ ok: number }>('select 1 as ok')).rows[0]!.ok)).toBe(1);
    expect(pool.totalCount - pool.idleCount).toBe(0);
  }, 60_000);

  /** Corpo de push de 1 pedido (mesmo formato da rajada), montado uma vez por id. */
  const corpoDoPedido = (id: string, criadoEm: string) => ({
    itens: [
      {
        entidade: 'pedido',
        id,
        operacao: 'upsert',
        payload: { id, customer_id: A.clientes.c1, discount_pct: 0, created_offline_at: criadoEm, items: [{ product_id: produto, quantity: 1 }] },
      },
    ],
  });

  it(`${SIMULTANEOS} pushes NOVOS ao mesmo tempo com a guarda em modo erro: nenhum ponto do push pede 2ª conexão`, async () => {
    const guardado = createApp({ banco: criarBancoApp(pool, { guardaConexao: { modo: 'erro' } }), modulos: MODULOS_API, autenticar, licencas, logger: false });
    await guardado.ready();
    try {
      const criadoEm = new Date().toISOString();
      const novos = Array.from({ length: SIMULTANEOS }, () => randomUUID());
      const r = await Promise.all(
        novos.map((id) => guardado.inject({ method: 'POST', url: '/v1/sync/push', headers: { 'x-teste-usuario': 'vendedor1' }, payload: corpoDoPedido(id, criadoEm) })),
      );
      const itens = r.map((x) => ({ status: x.statusCode, item: x.statusCode === 200 ? (x.json() as { resultados: { id: string; status: string }[] }).resultados[0] : x.body }));
      expect(itens, JSON.stringify(itens)).toEqual(novos.map((id) => ({ status: 200, item: expect.objectContaining({ id, status: 'aceito' }) })));
    } finally {
      await guardado.close();
    }
  }, 60_000);

  it('pool cheio de verdade (1 conexão presa, espera 300 ms): 503 BANCO_OCUPADO com Retry-After, nada gravado; o reenvio depois é aceito', async () => {
    const cheio = new pg.Pool({ connectionString: banco.urlApp, max: 1, connectionTimeoutMillis: 300 });
    cheio.on('error', () => undefined);
    const app1 = createApp({ banco: criarBancoApp(cheio), modulos: MODULOS_API, autenticar, licencas, logger: false });
    await app1.ready();
    const id = randomUUID();
    const corpo = corpoDoPedido(id, new Date().toISOString());
    const enviar = () => app1.inject({ method: 'POST', url: '/v1/sync/push', headers: { 'x-teste-usuario': 'vendedor1' }, payload: corpo });
    try {
      const presa = await cheio.connect();
      let r: Awaited<ReturnType<typeof enviar>>;
      try {
        const t0 = Date.now();
        r = await enviar();
        expect(Date.now() - t0).toBeLessThan(10_000);
      } finally {
        presa.release();
      }
      expect(r.statusCode, r.body).toBe(503);
      expect(r.json()).toMatchObject({ codigo: 'BANCO_OCUPADO' });
      expect(r.headers['retry-after']).toBe(String(RETRY_AFTER_BANCO_OCUPADO_S));
      expect((await admin.query('select 1 from vendedor.pedido where id = $1', [id])).rowCount).toBe(0);
      const deNovo = await enviar();
      expect(deNovo.statusCode, deNovo.body).toBe(200);
      expect((deNovo.json() as { resultados: { id: string; status: string }[] }).resultados[0]).toMatchObject({ id, status: 'aceito' });
    } finally {
      await app1.close().catch(() => undefined);
      await cheio.end().catch(() => undefined);
    }
  }, 60_000);
});
