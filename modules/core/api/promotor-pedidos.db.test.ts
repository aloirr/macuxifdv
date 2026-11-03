/**
 * Opção `promotor_ve_pedidos` × Postgres real (fixture dois-tenants, RLS): RN-CORE-01, RN-PRO-01, RN-AUD-01 (T-0061).
 * Padrão ligado; admin do tenant desliga só o próprio; auditoria com antes/depois; a consulta `core.promotor_ve_pedidos@1`
 * reflete a mudança na requisição seguinte; o pull do aparelho leva o parâmetro. Pula sem Postgres.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { criarPermissoes, verificarAcao, type ClienteBanco, type ContextoBase, type ContextoConsulta, type LinhaSync, type PedidoPull, type RotaModulo, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONSULTA_PROMOTOR_VE_PEDIDOS, ParametroSyncSchema, promotorVePedidosDasLinhas } from '../contracts';
import { manifest } from '../manifest';
import { consultaPromotorVePedidos } from './consultas';
import { rotasDePromotorPedidos } from './promotor-pedidos';
import { provedoresSyncCore } from './sync';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;

describe.skipIf(semBanco())('Core T-0061 × Postgres: promotor_ve_pedidos', () => {
  let pool: pg.Pool;
  const usuario = (id: string, perfil: UsuarioAutenticado['perfil'], tenant: string): UsuarioAutenticado => ({ id, tenant_id: tenant, perfil });
  const adminA = usuario(A.usuarios.admin, 'admin', A.tenantId);
  const adminB = usuario(B.usuarios.admin, 'admin', B.tenantId);
  const promotorA = usuario(A.usuarios.promotor, 'promotor', A.tenantId);

  const ctx = (u: UsuarioAutenticado, requestId: string): ContextoBase =>
    ({
      usuario: u,
      requestId,
      agora: () => new Date(),
      fuso: () => 'America/Manaus',
      comTenant: (fn: (db: pg.ClientBase) => Promise<unknown>) => comTenant(pool, u.tenant_id, (c) => fn(c)),
    }) as unknown as ContextoBase;
  const chamar = (metodo: 'GET' | 'PUT', u: UsuarioAutenticado, requestId: string, corpo?: unknown) => {
    const r: RotaModulo = rotasDePromotorPedidos.find((x) => x.metodo === metodo && x.caminho === 'parametros/promotor-ve-pedidos')!;
    return r.executar({ ...ctx(u, requestId), corpo: r.corpo ? r.corpo.parse(corpo ?? {}) : {}, query: {}, params: {} } as never) as Promise<{ ligado: boolean }>;
  };
  /** A consulta roda na transação de quem pergunta (RLS do tenant dele). */
  const consultar = (tenant: string) =>
    comTenant(pool, tenant, (c) => consultaPromotorVePedidos.executar(CONSULTA_PROMOTOR_VE_PEDIDOS.entrada.parse({}), { db: c as unknown as ClienteBanco } as unknown as ContextoConsulta)) as Promise<{ ligado: boolean }>;
  const pedido = (): PedidoPull => ({ desde: null, ate: new Date(Date.now() + 60_000).toISOString(), limite: 1001 });
  const puxarParametros = (u: UsuarioAutenticado): Promise<LinhaSync[]> => provedoresSyncCore.find((p) => p.entidade.nome === 'parametro')!.puxar!(ctx(u, 'req-pull'), pedido());
  const linhasDaChave = async (tenant: string) =>
    comTenant(pool, tenant, async (c) => (await c.query("select valor from plataforma.parametro where modulo = 'core' and chave = 'promotor_ve_pedidos' and deleted_at is null")).rows as Array<{ valor: unknown }>);
  const auditorias = (tenant: string, requestId: string) =>
    comTenant(pool, tenant, async (c) => (await c.query("select usuario_id, antes, depois, created_at from plataforma.auditoria where acao = 'parametro.promotor_ve_pedidos' and request_id = $1", [requestId])).rows);

  async function limpar() {
    for (const t of [A.tenantId, B.tenantId]) await comTenant(pool, t, (c) => c.query("delete from plataforma.parametro where modulo = 'core' and chave = 'promotor_ve_pedidos'"));
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    await limpar();
  });
  afterAll(async () => {
    if (pool) {
      await limpar();
      await pool.end();
    }
  });

  it('RN-CORE-01: sem registro o padrão é LIGADO (rota e consulta), nos dois tenants', async () => {
    expect(await chamar('GET', adminA, 'r-padrao-a')).toEqual({ ligado: true });
    expect(await consultar(A.tenantId)).toEqual({ ligado: true });
    expect(await consultar(B.tenantId)).toEqual({ ligado: true });
  });

  it('RN-CORE-05 / RN-AUD-01: tenant A desliga (auditado antes/depois), B continua ligado; admin do B não altera o A', async () => {
    expect(await chamar('PUT', adminA, 'r-desliga-a', { ligado: false })).toEqual({ ligado: false });
    expect(await consultar(A.tenantId)).toEqual({ ligado: false });
    expect(await consultar(B.tenantId)).toEqual({ ligado: true });
    expect(await chamar('GET', adminB, 'r-get-b')).toEqual({ ligado: true });
    const aud = await auditorias(A.tenantId, 'r-desliga-a');
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({ usuario_id: A.usuarios.admin, antes: { promotor_ve_pedidos: true }, depois: { promotor_ve_pedidos: false } });
    expect(aud[0]!.created_at).toBeInstanceOf(Date);
    // o admin do B grava no B: o A segue desligado
    await chamar('PUT', adminB, 'r-b-liga', { ligado: true });
    expect(await consultar(A.tenantId)).toEqual({ ligado: false });
    expect(await auditorias(A.tenantId, 'r-b-liga')).toEqual([]);
  });

  it('RN-CORE-01: a consulta reflete a mudança na requisição seguinte (sem cache) e a escrita é idempotente', async () => {
    await chamar('PUT', adminA, 'r-religa-a', { ligado: true });
    expect(await consultar(A.tenantId)).toEqual({ ligado: true });
    await chamar('PUT', adminA, 'r-desliga-2', { ligado: false });
    expect(await consultar(A.tenantId)).toEqual({ ligado: false });
    // repetir o mesmo valor: nada muda, uma única linha, sem nova auditoria
    expect(await chamar('PUT', adminA, 'r-desliga-3', { ligado: false })).toEqual({ ligado: false });
    expect(await linhasDaChave(A.tenantId)).toEqual([{ valor: false }]);
    expect(await auditorias(A.tenantId, 'r-desliga-2')).toHaveLength(1);
    expect(await auditorias(A.tenantId, 'r-desliga-3')).toEqual([]);
  });

  it('RN-PRO-01: o pull de parâmetros leva a opção ao aparelho (só do próprio tenant) e o app a lê offline', async () => {
    const linhasA = await puxarParametros(promotorA);
    for (const l of linhasA) ParametroSyncSchema.parse(l);
    expect(linhasA.map((l) => (l as unknown as { chave: string }).chave)).toContain('promotor_ve_pedidos');
    expect(promotorVePedidosDasLinhas(linhasA as unknown as Array<{ modulo: string; chave: string; valor: unknown }>)).toBe(false);
    const linhasB = await puxarParametros(usuario(B.usuarios.vendedor, 'vendedor', B.tenantId));
    expect(promotorVePedidosDasLinhas(linhasB as unknown as Array<{ modulo: string; chave: string; valor: unknown }>)).toBe(true);
  });

  it('RN-CORE-01: só o admin lê e escreve a opção; os demais perfis recebem 403 (a API revalida pela ação do manifesto)', () => {
    const permissoes = criarPermissoes([manifest]);
    for (const perfil of ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente'] as const) {
      const r = verificarAcao({ id: 'x', tenant_id: 'y', perfil, modulos: ['core'] }, permissoes, 'parametro.promotor_ve_pedidos');
      expect(r, perfil).toMatchObject({ ok: false, status: 403, codigo: 'PERFIL_SEM_ACESSO' });
    }
    expect(verificarAcao({ id: 'x', tenant_id: 'y', perfil: 'admin', modulos: ['core'] }, permissoes, 'parametro.promotor_ve_pedidos').ok).toBe(true);
    for (const r of rotasDePromotorPedidos) expect(r.acao).toBe('parametro.promotor_ve_pedidos');
  });

  it('o corpo do PUT precisa ser { ligado: boolean }', () => {
    const put = rotasDePromotorPedidos.find((x) => x.metodo === 'PUT')!;
    expect(() => put.corpo!.parse({ ligado: 'sim' })).toThrow();
    expect(() => put.corpo!.parse({})).toThrow();
  });
});
