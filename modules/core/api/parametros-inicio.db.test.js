/**
 * Parâmetros do Início × Postgres real (fixture dois-tenants, RLS): RN-CORE-26, RN-AUD-01 (T-0073 passo 7).
 * Dois tenants isolados; PUT repetido sem auditoria nova e sem mudar o updated_at (o pull só leva o que mudou); linha removida
 * cai no padrão; 422 com a chave do campo e nada gravado; o pull do aparelho leva as duas chaves. O PUT só grava os dias (RD-0334). Pula sem Postgres.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ParametroSyncSchema } from '../contracts';
import { PARAMETROS_INICIO_PADRAO, parametrosInicioDasLinhas } from '../domain';
import { rotasDeParametrosInicio } from './parametros-inicio';
import { provedoresSyncCore } from './sync';
const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const valido = { dias_uteis_semana: [1, 2, 3, 4, 5] };
const CHAVES = ['metas.dias_uteis_semana', 'inicio.parado_min'];
describe.skipIf(semBanco())('Core T-0073 × Postgres: parâmetros do Início', () => {
    let pool;
    const usuario = (id, perfil, tenant) => ({ id, tenant_id: tenant, perfil });
    const adminA = usuario(A.usuarios.admin, 'admin', A.tenantId);
    const adminB = usuario(B.usuarios.admin, 'admin', B.tenantId);
    const vendedorA = usuario(A.usuarios.vendedor1, 'vendedor', A.tenantId);
    const ctx = (u, requestId) => ({
        usuario: u,
        requestId,
        agora: () => new Date(),
        fuso: () => 'America/Manaus',
        comTenant: (fn) => comTenant(pool, u.tenant_id, (c) => fn(c)),
    });
    const chamar = (metodo, u, requestId, corpo) => {
        const r = rotasDeParametrosInicio.find((x) => x.metodo === metodo && x.caminho === 'parametros/inicio');
        return r.executar({ ...ctx(u, requestId), corpo: r.corpo ? r.corpo.parse(corpo ?? {}) : {}, query: {}, params: {} });
    };
    const linhas = (tenant) => comTenant(pool, tenant, async (c) => (await c.query("select chave, valor, updated_at from plataforma.parametro where modulo = 'core' and chave = any($1::text[]) and deleted_at is null order by chave", [CHAVES])).rows);
    const auditorias = (tenant, requestId) => comTenant(pool, tenant, async (c) => (await c.query("select usuario_id, antes, depois from plataforma.auditoria where acao = 'parametro.inicio' and request_id = $1", [requestId])).rows);
    /** O `inicio.parado_min` é gravado só por `PUT parametros/parado-min`; aqui o teste o planta direto para provar que o PUT do Início não o toca. */
    const plantarParado = (tenant, valor) => comTenant(pool, tenant, (c) => c.query("insert into plataforma.parametro (tenant_id, modulo, chave, valor) values (plataforma.tenant_atual(), 'core', 'inicio.parado_min', $1::jsonb) on conflict (tenant_id, modulo, chave) where deleted_at is null do update set valor = excluded.valor", [JSON.stringify(valor)]));
    const pedido = () => ({ desde: null, ate: new Date(Date.now() + 60_000).toISOString(), limite: 1001 });
    const limpar = async () => {
        for (const t of [A.tenantId, B.tenantId])
            await comTenant(pool, t, (c) => c.query("delete from plataforma.parametro where modulo = 'core' and chave = any($1::text[])", [CHAVES]));
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
    it('RN-CORE-26 / RN-AUD-01: o tenant A grava os dias (auditado antes/depois) e o B segue no padrão; admin do B não altera o A', async () => {
        const efetivo = { ...valido, parado_min: PARAMETROS_INICIO_PADRAO.parado_min };
        expect(await chamar('PUT', adminA, 'r-grava-a', { dias_uteis_semana: [5, 1, 2, 3, 4] })).toEqual(efetivo);
        expect(await chamar('GET', adminA, 'r-get-a')).toEqual(efetivo);
        expect(await chamar('GET', adminB, 'r-get-b')).toEqual(PARAMETROS_INICIO_PADRAO);
        expect(await linhas(B.tenantId)).toEqual([]);
        const aud = await auditorias(A.tenantId, 'r-grava-a');
        expect(aud).toHaveLength(1);
        expect(aud[0]).toMatchObject({ usuario_id: A.usuarios.admin, antes: { dias_uteis_semana: PARAMETROS_INICIO_PADRAO.dias_uteis_semana }, depois: valido });
        await chamar('PUT', adminB, 'r-grava-b', { dias_uteis_semana: [1, 2, 3] });
        expect(await chamar('GET', adminA, 'r-get-a2')).toEqual(efetivo);
        expect(await auditorias(A.tenantId, 'r-grava-b')).toEqual([]);
    });
    it('RN-CORE-26 (RD-0334): o PUT do Início só grava os dias e não toca no parado já salvo', async () => {
        await plantarParado(A.tenantId, 45);
        await plantarParado(B.tenantId, 90);
        const antes = await linhas(A.tenantId);
        expect(await chamar('PUT', adminA, 'r-parado-intacto', { dias_uteis_semana: [1, 2, 3, 4, 5, 6] })).toEqual({ dias_uteis_semana: [1, 2, 3, 4, 5, 6], parado_min: 45 });
        const depois = await linhas(A.tenantId);
        expect(depois.find((l) => l.chave === 'inicio.parado_min')).toEqual(antes.find((l) => l.chave === 'inicio.parado_min'));
        await chamar('PUT', adminA, 'r-volta-dias', valido);
    });
    it('RN-AUD-01: PUT repetido não audita de novo e não muda o updated_at das linhas (o pull só leva o que mudou)', async () => {
        const antes = await linhas(A.tenantId);
        expect(antes).toHaveLength(2);
        expect(await chamar('PUT', adminA, 'r-repete-a', valido)).toEqual({ ...valido, parado_min: 45 });
        const depois = await linhas(A.tenantId);
        expect(depois.map((l) => l.updated_at.getTime())).toEqual(antes.map((l) => l.updated_at.getTime()));
        expect(await auditorias(A.tenantId, 'r-repete-a')).toEqual([]);
    });
    it('RN-CORE-26: linha removida (soft delete) cai no padrão; o PUT seguinte dos dias recria a linha viva', async () => {
        await comTenant(pool, A.tenantId, (c) => c.query("update plataforma.parametro set deleted_at = now() where modulo = 'core' and chave = 'metas.dias_uteis_semana' and deleted_at is null"));
        expect(await chamar('GET', adminA, 'r-removida')).toEqual({ dias_uteis_semana: PARAMETROS_INICIO_PADRAO.dias_uteis_semana, parado_min: 45 });
        expect(await chamar('PUT', adminA, 'r-recria', valido)).toEqual({ ...valido, parado_min: 45 });
        expect(await chamar('GET', adminA, 'r-get-recria')).toEqual({ ...valido, parado_min: 45 });
    });
    it('RN-CORE-26: dia fora da faixa vira 422 (RN-CORE-26) com a chave do campo e nada é gravado nem auditado', async () => {
        const antes = await linhas(A.tenantId);
        const e = await chamar('PUT', adminA, 'r-invalido', { dias_uteis_semana: [] }).catch((x) => x);
        expect(e).toMatchObject({ status: 422, codigo: 'RN-CORE-26' });
        expect(e.detalhes.erros.map((x) => x.campo)).toEqual(['dias_uteis_semana']);
        expect(await linhas(A.tenantId)).toEqual(antes);
        expect(await auditorias(A.tenantId, 'r-invalido')).toEqual([]);
    });
    it('RN-CORE-26: o pull de parâmetros leva as duas chaves ao aparelho (só do próprio tenant) e o app lê o mesmo valor efetivo', async () => {
        const pull = provedoresSyncCore.find((p) => p.entidade.nome === 'parametro').puxar;
        const lA = (await pull(ctx(vendedorA, 'req-pull-a'), pedido()));
        for (const l of lA)
            ParametroSyncSchema.parse(l);
        const dasLinhas = lA;
        expect(CHAVES.every((k) => dasLinhas.some((l) => l.chave === k))).toBe(true);
        expect(parametrosInicioDasLinhas(dasLinhas)).toEqual({ ...valido, parado_min: 45 });
        const lB = (await pull(ctx(usuario(B.usuarios.vendedor, 'vendedor', B.tenantId), 'req-pull-b'), pedido()));
        expect(parametrosInicioDasLinhas(lB).parado_min).toBe(90);
    });
});
