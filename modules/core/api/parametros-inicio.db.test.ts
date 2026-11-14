/**
 * Parâmetros do Início × Postgres real (fixture dois-tenants, RLS): RN-CORE-26, RN-AUD-01 (T-0073 passo 7).
 * Dois tenants isolados; PUT repetido sem auditoria nova e sem mudar o updated_at (o pull só leva o que mudou); linha removida
 * cai no padrão; 422 com a chave do campo e nada gravado; o pull do aparelho leva as duas chaves. Pula sem Postgres.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ContextoBase, LinhaSync, PedidoPull, RotaModulo, UsuarioAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ParametroSyncSchema, type ParametrosInicio } from '../contracts';
import { PARAMETROS_INICIO_PADRAO, parametrosInicioDasLinhas } from '../domain';
import { rotasDeParametrosInicio } from './parametros-inicio';
import { provedoresSyncCore } from './sync';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const valido: ParametrosInicio = { dias_uteis_semana: [1, 2, 3, 4, 5], parado_min: 45 };
const CHAVES = ['metas.dias_uteis_semana', 'inicio.parado_min'];
type LinhaParam = { modulo: string; chave: string; valor: unknown };

describe.skipIf(semBanco())('Core T-0073 × Postgres: parâmetros do Início', () => {
  let pool: pg.Pool;
  const usuario = (id: string, perfil: UsuarioAutenticado['perfil'], tenant: string): UsuarioAutenticado => ({ id, tenant_id: tenant, perfil });
  const adminA = usuario(A.usuarios.admin, 'admin', A.tenantId);
  const adminB = usuario(B.usuarios.admin, 'admin', B.tenantId);
  const vendedorA = usuario(A.usuarios.vendedor1, 'vendedor', A.tenantId);

  const ctx = (u: UsuarioAutenticado, requestId: string): ContextoBase =>
    ({
      usuario: u,
      requestId,
      agora: () => new Date(),
      fuso: () => 'America/Manaus',
      comTenant: (fn: (db: pg.ClientBase) => Promise<unknown>) => comTenant(pool, u.tenant_id, (c) => fn(c)),
    }) as unknown as ContextoBase;
  const chamar = (metodo: 'GET' | 'PUT', u: UsuarioAutenticado, requestId: string, corpo?: unknown) => {
    const r: RotaModulo = rotasDeParametrosInicio.find((x) => x.metodo === metodo && x.caminho === 'parametros/inicio')!;
    return r.executar({ ...ctx(u, requestId), corpo: r.corpo ? r.corpo.parse(corpo ?? {}) : {}, query: {}, params: {} } as never) as Promise<ParametrosInicio>;
  };
  const linhas = (tenant: string) =>
    comTenant(
      pool,
      tenant,
      async (c) => (await c.query("select chave, valor, updated_at from plataforma.parametro where modulo = 'core' and chave = any($1::text[]) and deleted_at is null order by chave", [CHAVES])).rows as Array<{ chave: string; valor: unknown; updated_at: Date }>,
    );
  const auditorias = (tenant: string, requestId: string) =>
    comTenant(pool, tenant, async (c) => (await c.query("select usuario_id, antes, depois from plataforma.auditoria where acao = 'parametro.inicio' and request_id = $1", [requestId])).rows);
  const pedido = (): PedidoPull => ({ desde: null, ate: new Date(Date.now() + 60_000).toISOString(), limite: 1001 });
  const limpar = async () => {
    for (const t of [A.tenantId, B.tenantId]) await comTenant(pool, t, (c) => c.query("delete from plataforma.parametro where modulo = 'core' and chave = any($1::text[])", [CHAVES]));
  };

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

  it('RN-CORE-26: sem linha o GET devolve o padrão, nos dois tenants', async () => {
    expect(await chamar('GET', adminA, 'r-padrao-a')).toEqual(PARAMETROS_INICIO_PADRAO);
    expect(await chamar('GET', adminB, 'r-padrao-b')).toEqual(PARAMETROS_INICIO_PADRAO);
  });

  it('RN-CORE-26 / RN-AUD-01: o tenant A grava (auditado antes/depois) e o B segue no padrão; admin do B não altera o A', async () => {
    expect(await chamar('PUT', adminA, 'r-grava-a', { ...valido, dias_uteis_semana: [5, 1, 2, 3, 4] })).toEqual(valido);
    expect(await chamar('GET', adminA, 'r-get-a')).toEqual(valido);
    expect(await chamar('GET', adminB, 'r-get-b')).toEqual(PARAMETROS_INICIO_PADRAO);
    expect(await linhas(B.tenantId)).toEqual([]);
    const aud = await auditorias(A.tenantId, 'r-grava-a');
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({ usuario_id: A.usuarios.admin, antes: PARAMETROS_INICIO_PADRAO, depois: valido });
    await chamar('PUT', adminB, 'r-grava-b', { ...valido, parado_min: 90 });
    expect(await chamar('GET', adminA, 'r-get-a2')).toEqual(valido);
    expect(await auditorias(A.tenantId, 'r-grava-b')).toEqual([]);
  });

  it('RN-AUD-01: PUT repetido não audita de novo e não muda o updated_at das linhas (o pull só leva o que mudou)', async () => {
    const antes = await linhas(A.tenantId);
    expect(antes).toHaveLength(2);
    expect(await chamar('PUT', adminA, 'r-repete-a', valido)).toEqual(valido);
    const depois = await linhas(A.tenantId);
    expect(depois.map((l) => l.updated_at.getTime())).toEqual(antes.map((l) => l.updated_at.getTime()));
    expect(await auditorias(A.tenantId, 'r-repete-a')).toEqual([]);
    // mudar um valor atualiza só a linha dele e audita
    await chamar('PUT', adminA, 'r-muda-a', { ...valido, parado_min: 50 });
    const mudou = await linhas(A.tenantId);
    const de = (l: typeof mudou, chave: string) => l.find((x) => x.chave === chave)!;
    expect(de(mudou, 'inicio.parado_min').valor).toBe(50);
    expect(de(mudou, 'inicio.parado_min').updated_at.getTime()).toBeGreaterThanOrEqual(de(antes, 'inicio.parado_min').updated_at.getTime());
    expect(de(mudou, 'metas.dias_uteis_semana').updated_at.getTime()).toBe(de(antes, 'metas.dias_uteis_semana').updated_at.getTime());
    expect(await auditorias(A.tenantId, 'r-muda-a')).toHaveLength(1);
  });

  it('RN-CORE-26: linha removida (soft delete) cai no padrão, chave a chave; o PUT seguinte recria a linha viva', async () => {
    await comTenant(pool, A.tenantId, (c) => c.query("update plataforma.parametro set deleted_at = now() where modulo = 'core' and chave = 'inicio.parado_min' and deleted_at is null"));
    expect(await chamar('GET', adminA, 'r-removida')).toEqual({ ...valido, parado_min: PARAMETROS_INICIO_PADRAO.parado_min });
    expect(await chamar('PUT', adminA, 'r-recria', { ...valido, parado_min: 50 })).toEqual({ ...valido, parado_min: 50 });
    expect(await chamar('GET', adminA, 'r-get-recria')).toEqual({ ...valido, parado_min: 50 });
  });

  it('RN-CORE-26: valor fora da faixa vira 422 (RN-CORE-26) com a chave do campo e nada é gravado nem auditado', async () => {
    const antes = await linhas(A.tenantId);
    const e = await chamar('PUT', adminA, 'r-invalido', { ...valido, parado_min: 5, dias_uteis_semana: [] }).catch((x: unknown) => x);
    expect(e).toMatchObject({ status: 422, codigo: 'RN-CORE-26' });
    expect((e as { detalhes: { erros: Array<{ campo: string }> } }).detalhes.erros.map((x) => x.campo)).toEqual(['dias_uteis_semana', 'parado_min']);
    expect(await linhas(A.tenantId)).toEqual(antes);
    expect(await auditorias(A.tenantId, 'r-invalido')).toEqual([]);
  });

  it('RN-CORE-26: o pull de parâmetros leva as duas chaves ao aparelho (só do próprio tenant) e o app lê o mesmo valor efetivo', async () => {
    const pull = provedoresSyncCore.find((p) => p.entidade.nome === 'parametro')!.puxar!;
    const lA = (await pull(ctx(vendedorA, 'req-pull-a'), pedido())) as LinhaSync[];
    for (const l of lA) ParametroSyncSchema.parse(l);
    const dasLinhas = lA as unknown as LinhaParam[];
    expect(CHAVES.every((k) => dasLinhas.some((l) => l.chave === k))).toBe(true);
    expect(parametrosInicioDasLinhas(dasLinhas)).toEqual({ ...valido, parado_min: 50 });
    const lB = (await pull(ctx(usuario(B.usuarios.vendedor, 'vendedor', B.tenantId), 'req-pull-b'), pedido())) as unknown as LinhaParam[];
    expect(parametrosInicioDasLinhas(lB).parado_min).toBe(90);
  });
});
