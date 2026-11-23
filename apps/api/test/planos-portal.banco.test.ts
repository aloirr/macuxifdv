/**
 * POST /v1/plataforma/empresas/:tenant_id/assinatura × Postgres real (ADR 0047): o primeiro plano da empresa sem
 * assinatura. 201 com a ficha e os módulos do plano ligados; o mesmo pedido = 200 sem regravar; outro pedido ou empresa
 * que já tem plano = 409 ASSINATURA_EXISTENTE. Cada execução cria a própria empresa e a apaga no fim (excluir_tenant).
 * Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { FichaAssinaturaSchema, type AcessoPortalAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { criarBancoApp, criarBancoPortal } from '../src/banco';

const HASH = '$argon2id$v=19$m=1,t=1,p=1$b3V0cm8$b3V0cm9oYXNo';

describe.skipIf(semBanco())('API × Postgres: primeiro plano da empresa sem assinatura', () => {
  let app: pg.Pool;
  let admin: pg.Pool;
  let portal: pg.Pool;
  const codigo = `sem-plano-${randomUUID().slice(0, 8)}`;
  let tenant = '';
  let quem: AcessoPortalAutenticado;

  beforeAll(async () => {
    app = new pg.Pool({ connectionString: banco().urlApp, max: 2 });
    admin = new pg.Pool({ connectionString: banco().urlAdmin, max: 1 });
    portal = new pg.Pool({ connectionString: banco().urlPortal!, max: 2 });
    tenant = (await admin.query<{ id: string }>('insert into plataforma.tenant (codigo, nome) values ($1, $2) returning id', [codigo, 'Empresa sem plano'])).rows[0]!.id;
    const sa = (
      await admin.query<{ r: { super_admin_id: string } }>('select plataforma.criar_super_admin($1::jsonb) as r', [
        JSON.stringify({ acao: 'criar', email: `operador.${codigo}@macuxi.exemplo`, nome: 'Operador planos', senha_hash: HASH }),
      ])
    ).rows[0]!.r;
    const abriu = await portal.query<{ sessao_id: string }>('select * from plataforma.sa_abrir_sessao_portal($1::jsonb)', [
      JSON.stringify({ tipo: 'super_admin', super_admin_id: sa.super_admin_id }),
    ]);
    quem = { tipo: 'super_admin', id: sa.super_admin_id, sessao_id: abriu.rows[0]!.sessao_id };
  });

  afterAll(async () => {
    if (tenant) {
      await admin.query("update plataforma.tenant set status = 'encerrado' where id = $1", [tenant]);
      await admin.query('select * from plataforma.excluir_tenant($1, $2)', [tenant, codigo]);
    }
    await Promise.all([app?.end(), admin?.end(), portal?.end()]);
  });

  const sa = { 'x-quem': 'sa' };

  it('201 com a ficha e os módulos do plano; mesmo pedido = 200; outro pedido ou empresa com plano = 409', async () => {
    const api = createApp({
      banco: criarBancoApp(app),
      bancoPortal: criarBancoPortal(portal),
      autenticarPortal: async (h) => (h['x-quem'] === 'sa' ? quem : null),
      planosPortal: true,
      relogio: () => new Date('2026-11-14T15:00:00Z'),
    });
    try {
      const url = `/v1/plataforma/empresas/${tenant}/assinatura`;
      const sem = await api.inject({ method: 'GET', url, headers: sa });
      expect([sem.statusCode, sem.json().codigo]).toEqual([404, 'SEM_ASSINATURA']);

      const corpo = { plano: 'pme', ciclo: 'mensal', adicionais: [{ adicional: 'pesquisa', quantidade: 2 }], pedido_id: randomUUID() };
      const r = await api.inject({ method: 'POST', url, headers: sa, payload: corpo });
      expect(r.statusCode, r.body).toBe(201);
      expect(FichaAssinaturaSchema.parse(r.json())).toMatchObject({ tenant_id: tenant, plano: { codigo: 'pme' }, ciclo: 'mensal', teste_ate: '2026-11-27', paga: false });
      const ligados = await admin.query<{ modulo: string }>('select modulo from plataforma.tenant_modulo where tenant_id = $1 and ativo and deleted_at is null order by modulo', [tenant]);
      expect(ligados.rows.map((x) => x.modulo)).toEqual(['catalogo', 'core', 'gestor', 'integracao', 'pesquisa', 'vendedor']);

      const retrato = async () =>
        (await admin.query('select plano_id, ciclo, adicionais, teste_ate::text, paga, updated_at from plataforma.assinatura where tenant_id = $1 and deleted_at is null', [tenant])).rows;
      const antes = await retrato();
      expect(antes).toHaveLength(1);
      const deNovo = await api.inject({ method: 'POST', url, headers: sa, payload: corpo });
      expect(deNovo.statusCode, deNovo.body).toBe(200);
      expect(await retrato()).toEqual(antes);

      const outro = await api.inject({ method: 'POST', url, headers: sa, payload: { ...corpo, plano: 'light', adicionais: [], pedido_id: randomUUID() } });
      expect([outro.statusCode, outro.json().codigo]).toEqual([409, 'ASSINATURA_EXISTENTE']);
      expect(await retrato()).toEqual(antes);
      expect((await admin.query('select 1 from plataforma.assinatura_historico where tenant_id = $1', [tenant])).rowCount).toBe(1);

      const comPlano = (await admin.query<{ id: string }>('select tenant_id as id from plataforma.assinatura where deleted_at is null and tenant_id <> $1 limit 1', [tenant])).rows[0]!.id;
      const ja = await api.inject({ method: 'POST', url: `/v1/plataforma/empresas/${comPlano}/assinatura`, headers: sa, payload: { ...corpo, pedido_id: randomUUID() } });
      expect([ja.statusCode, ja.json().codigo]).toEqual([409, 'ASSINATURA_EXISTENTE']);
    } finally {
      await api.close();
    }
  });
});
