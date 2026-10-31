/**
 * T-0002 C2.2 pela API (cenários S0-029 e S0-030 do plano), agora que a T-0003/T-0004 entregaram rotas reais:
 * - S0-029: token do tenant A pedindo recurso do tenant B → 404 sem revelar existência; `tenant_id` em cabeçalho,
 *   query ou corpo é ignorado (só vale o do token).
 * - S0-030: evento da outbox e auditoria gerados em A ficam invisíveis no contexto de B (e vice-versa pelo admin de B).
 * createApp real + Core + Postgres como macuxi_app (banco efêmero próprio, apoio/api.ts).
 */
import { semBanco } from '@macuxi/db/teste/estado';
import { comTenant } from '@macuxi/db/teste';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, B, erroDe, licenca, subirApi, type ApiDeTeste } from '../apoio/api';

const NAO_EXISTE = '0e000000-0000-4000-8000-00000000dead';

describe.skipIf(semBanco())('S0-029/S0-030 — isolamento entre tenants pela API real (Postgres)', () => {
  let api: ApiDeTeste;
  let adminA: string;
  let adminB: string;

  beforeAll(async () => {
    api = await subirApi();
    adminA = (await api.sessao('admin@exemplo.com.br', A)).access_token;
    adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
    await new Promise((r) => setTimeout(r, 2_500)); // horizonte do pull (desenho T-0004 §5)
  });
  afterAll(async () => {
    await api?.fechar();
  });

  const retratoB = async () => {
    const c = await api.admin.connect();
    try {
      const r = await c.query(
        `select (select jsonb_agg(to_jsonb(t) order by id) from plataforma.usuario_modulo t where tenant_id = $1) um,
                (select jsonb_agg(to_jsonb(t) order by id) from plataforma.tenant_modulo t where tenant_id = $1) tm,
                (select jsonb_agg(to_jsonb(t) order by id) from plataforma.perfil_modulo t where tenant_id = $1) pm`,
        [B.tenantId],
      );
      return r.rows[0];
    } finally {
      c.release();
    }
  };

  it('S0-029: admin de A alterando licença de um usuário de B → 404 igual ao de um id inexistente; B intacto', async () => {
    const antes = await retratoB();
    const deB = await licenca(api, adminA, 'usuario', 'vendedor', false, B.usuarios.vendedor);
    const inexistente = await licenca(api, adminA, 'usuario', 'vendedor', false, NAO_EXISTE);
    expect(deB.statusCode).toBe(404);
    expect({ s: deB.statusCode, c: deB.json() }).toEqual({ s: inexistente.statusCode, c: inexistente.json() });
    expect(erroDe(deB).codigo).toBe('USUARIO_NAO_ENCONTRADO');
    expect(await retratoB()).toEqual(antes);
  });

  it('S0-029: tenant_id em cabeçalho, query ou corpo é ignorado — só vale o do token', async () => {
    const antes = await retratoB();
    const tentativas = [
      { headers: { 'x-tenant-id': B.tenantId, 'x-tenant': B.tenantId }, url: '/v1/core/licencas/tenant/vendedor', payload: { ativo: false } },
      { url: `/v1/core/licencas/tenant/vendedor?tenant_id=${B.tenantId}`, payload: { ativo: false } },
      { url: '/v1/core/licencas/tenant/vendedor', payload: { ativo: false, tenant_id: B.tenantId } },
    ];
    for (const t of tentativas) {
      const r = await api.chamar(adminA, { method: 'PUT', ...t });
      // ou recusa a entrada (400) ou aplica no PRÓPRIO tenant (200); nunca em B
      expect([200, 400], r.body).toContain(r.statusCode);
      await licenca(api, adminA, 'tenant', 'vendedor', true);
    }
    expect(await retratoB()).toEqual(antes);
    // leitura com cabeçalho e query de B devolve só A
    const r = await api.chamar(adminA, { method: 'GET', url: `/v1/core/licencas?tenant_id=${B.tenantId}`, headers: { 'x-tenant-id': B.tenantId } });
    expect(r.statusCode, r.body).toBe(200);
    const usuarios = (r.json() as { usuarios: { id: string }[] }).usuarios.map((u) => u.id);
    expect(usuarios.length).toBeGreaterThan(0);
    expect(usuarios.every((id) => id.startsWith('aaaaaaaa'))).toBe(true);
    expect(r.body).not.toContain('admin.b@exemplo.com.br');
    // pull com cabeçalho de B: só clientes de A
    const p = await api.chamar(adminA, { method: 'GET', url: `/v1/sync/pull?entidade=cliente&tenant_id=${B.tenantId}`, headers: { 'x-tenant-id': B.tenantId } });
    expect(p.statusCode, p.body).toBe(200);
    const clientes = (p.json() as { itens: { id: string }[] }).itens.map((i) => i.id);
    expect(clientes.sort()).toEqual([A.clientes.c1, A.clientes.c2, A.clientes.c3].sort());
  });

  it('S0-029: estado de licenças do admin de B não mostra nada de A (e vice-versa)', async () => {
    const rb = await api.chamar(adminB, { method: 'GET', url: '/v1/core/licencas' });
    expect(rb.statusCode, rb.body).toBe(200);
    expect(rb.body).not.toMatch(/aaaaaaaa-|@exemplo\.com\.br.*Alfa|Distribuidora Alfa/);
    const ub = (rb.json() as { usuarios: { id: string }[] }).usuarios.map((u) => u.id).sort();
    expect(ub).toEqual([B.usuarios.admin, B.usuarios.vendedor].sort());
  });

  it('S0-030: evento core.usuario.modulos_alterados@1 e auditoria gerados em A não aparecem no contexto de B (macuxi_app)', async () => {
    const r = await licenca(api, adminA, 'usuario', 'vendedor', false, A.usuarios.vendedor1);
    expect(r.statusCode).toBe(200);
    await licenca(api, adminA, 'usuario', 'vendedor', true, A.usuarios.vendedor1);
    const ver = (tenant: string) =>
      comTenant(api.pool, tenant, async (c) => {
        const ev = await c.query<{ id: string; tenant_id: string; agregado_id: string | null }>(
          "select id, tenant_id, agregado_id from plataforma.evento where nome = 'core.usuario.modulos_alterados@1'",
        );
        const au = await c.query<{ id: string; tenant_id: string; entidade_id: string | null }>("select id, tenant_id, entidade_id from plataforma.auditoria where acao = 'licenca.alterar'");
        return { ev: ev.rows, au: au.rows };
      });
    const emA = await ver(A.tenantId);
    const emB = await ver(B.tenantId);
    expect(emA.ev.some((e) => e.agregado_id === A.usuarios.vendedor1)).toBe(true);
    expect(emA.au.some((e) => e.entidade_id === A.usuarios.vendedor1)).toBe(true);
    expect(emB.ev.every((e) => e.tenant_id === B.tenantId)).toBe(true);
    expect(emB.au.every((e) => e.tenant_id === B.tenantId)).toBe(true);
    const idsA = new Set([...emA.ev.map((e) => e.id), ...emA.au.map((e) => e.id)]);
    expect([...emB.ev, ...emB.au].filter((e) => idsA.has(e.id))).toEqual([]);
  });
});
