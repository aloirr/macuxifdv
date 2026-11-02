/**
 * Pipeline das rotas de Conector × Postgres real (ADR 0013; desenho T-0032 §9): fixture dois-tenants, papel macuxi_app, RLS.
 * Um módulo de FIXTURE (manifesto real da Integração) resolve a chave pela função `integracao.autenticar_chave` (única leitura
 * sem tenant, SECURITY DEFINER) com o hash HMAC-SHA256(pepper, chave) — o mesmo caminho que o módulo real vai usar. Prova:
 * tenant só da chave (RLS: cada Conector só vê o próprio tenant), fuso do tenant da chave, 401 genérico (chave desconhecida,
 * chave de outro Conector), licença lida do banco (tenant sem a Integração → 403 `modulo_inativo`) e `tx.auditar` com
 * `usuario_id` nulo. Os handlers reais (`modules/integracao/api`) têm o próprio teste em `integracao-hub.banco.test.ts`.
 * Pula sem Docker/Postgres (aviso no fim); com MACUXI_PG_EXIGIR=1 (CI) falha.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { manifest as integracao } from '@macuxi/integracao/manifest';
import { DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { definirApiConector, definirModuloApi, type ModuloId } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { criarBancoApp } from '../src/banco';
import { licencasDoTenantNoBanco, type FonteLicencasTenant } from '../src/licencas';
import { modulosDeTeste } from './apoio';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
/**
 * Mesmo valor de `PEPPER_HUB_FIXTURE` (db/seeds/fixtures/dois-tenants.ts), que o `@macuxi/db/teste` ainda não exporta (pedido ao
 * banco-dados). O `beforeAll` confere contra o hash gravado: se a fixture mudar, o teste diz onde.
 */
const PEPPER = 'fixture-pepper-hub-somente-teste-0032';
const hmac = (chave: string) => createHmac('sha256', PEPPER).update(chave).digest('hex');

const MSG_401 = 'Credencial inválida. Confira o identificador do Conector e a chave de API.';

interface LinhaChave {
  tenant_id: string;
  conector_id: string;
  conector_identificador: string;
  conector_ativo: boolean;
  revogada_em: Date | null;
  entidades: string[];
}

const apiFixture = definirModuloApi({
  manifesto: integracao,
  conector: definirApiConector({
    async autenticar(e) {
      const auth = e.cabecalhos.authorization ?? '';
      if (!/^Bearer \S{16,512}$/.test(auth)) return { ok: false, status: 400, codigo: 'requisicao_invalida', mensagem: 'Authorization deve ser "Bearer <chave de API>".' };
      const r = await e.semTenant((db) => db.query<LinhaChave>('select * from integracao.autenticar_chave($1)', [hmac(auth.slice(7))]));
      const l = r.rows[0];
      if (!l || l.conector_identificador !== e.cabecalhos['x-macuxi-conector-id'] || l.revogada_em !== null || !l.conector_ativo)
        return { ok: false, status: 401, codigo: 'credencial_invalida', mensagem: MSG_401, motivo: l ? 'conector_divergente' : 'chave_desconhecida' };
      return { ok: true, tenantId: l.tenant_id, conector: { id: l.conector_id, identificador: l.conector_identificador, entidades: l.entidades } };
    },
    rotas: [
      {
        id: 'quem',
        metodo: 'GET',
        caminho: '/quem',
        executar: async (ctx) =>
          ctx.comTenant(async (db) => {
            const c = await db.query<{ identificador: string }>('select identificador from integracao.conector where deleted_at is null order by identificador');
            const t = await db.query<{ tenant_id: string }>('select distinct tenant_id from integracao.credencial');
            return { tenant: ctx.tenantId, fuso: ctx.fuso(), conectores: c.rows.map((x) => x.identificador), tenants_credencial: t.rows.map((x) => x.tenant_id), entidades: ctx.conector.entidades };
          }),
      },
      {
        id: 'auditar',
        metodo: 'POST',
        caminho: '/auditar',
        executar: async (ctx) => {
          const corpo = ctx.corpo as { entidade: string };
          await ctx.comTenant((_db, tx) => tx.auditar({ acao: 'teste.conector', entidade: corpo.entidade, entidade_id: null, depois: { ok: true } }));
          return { ok: true };
        },
      },
    ],
  }),
});

/** Licença real do banco, com a Integração acrescentada (a fixture não a tem em tenant_modulo; ver o teste do 403). */
const comIntegracao: FonteLicencasTenant = async (t, b) => {
  const l = await licencasDoTenantNoBanco(t, b);
  return { ...l, ativosNoTenant: [...l.ativosNoTenant, 'integracao' as ModuloId] };
};

const cabDe = (X: typeof A | typeof B, identificador: string = X.integracao.identificador) => ({
  authorization: `Bearer ${X.integracao.chave.chave}`,
  'x-macuxi-conector-id': identificador,
});

describe.skipIf(semBanco())('rotas de Conector × Postgres (ADR 0013, T-0032)', () => {
  let pool: pg.Pool;
  let admin: pg.Client;
  let app: ReturnType<typeof createApp>;
  let appLicencaReal: ReturnType<typeof createApp>;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
    const h = await admin.query<{ hash_chave: string }>('select hash_chave from integracao.credencial where id = $1', [A.integracao.credencial]);
    expect(h.rows[0]?.hash_chave, 'PEPPER deste teste diferente do PEPPER_HUB_FIXTURE da fixture dois-tenants').toBe(hmac(A.integracao.chave.chave));
    const modulos = modulosDeTeste({ integracao: apiFixture });
    app = createApp({ banco: criarBancoApp(pool), modulos, licencasTenant: comIntegracao });
    appLicencaReal = createApp({ banco: criarBancoApp(pool), modulos });
  });
  afterAll(async () => {
    await app?.close();
    await appLicencaReal?.close();
    await admin?.end();
    await pool?.end();
  });

  it('tenant só da chave: cada Conector vê só o próprio tenant (RLS), com o fuso do tenant da chave', async () => {
    const ra = await app.inject({ method: 'GET', url: `/integracao/v1/quem?tenant_id=${B.tenantId}`, headers: { ...cabDe(A), 'x-tenant-id': B.tenantId } });
    expect(ra.statusCode, ra.body).toBe(200);
    expect(ra.json()).toMatchObject({ tenant: A.tenantId, fuso: 'America/Manaus', tenants_credencial: [A.tenantId] });
    expect(ra.json().conectores).toContain('erp-alfa');
    expect(ra.json().conectores).not.toContain('erp-beta');
    const rb = await app.inject({ method: 'GET', url: '/integracao/v1/quem', headers: cabDe(B) });
    expect(rb.statusCode, rb.body).toBe(200);
    expect(rb.json()).toMatchObject({ tenant: B.tenantId, fuso: 'America/Sao_Paulo', conectores: ['erp-beta'], tenants_credencial: [B.tenantId], entidades: ['cliente', 'produto'] });
  });

  it('RN-INT-10: 401 genérico para chave desconhecida e para a chave de A com o identificador de B (mesmo corpo)', async () => {
    const desconhecida = await app.inject({ method: 'GET', url: '/integracao/v1/quem', headers: { authorization: `Bearer ${randomUUID()}`, 'x-macuxi-conector-id': 'erp-alfa' } });
    const cruzada = await app.inject({ method: 'GET', url: '/integracao/v1/quem', headers: cabDe(A, B.integracao.identificador) });
    for (const r of [desconhecida, cruzada]) {
      expect(r.statusCode).toBe(401);
      expect(r.json()).toEqual({ codigo: 'credencial_invalida', mensagem: MSG_401, requisicao_id: r.headers['x-request-id'] });
    }
  });

  it('licença lida do banco: tenant da chave sem a Integração em tenant_modulo → 403 modulo_inativo', async () => {
    const r = await appLicencaReal.inject({ method: 'GET', url: '/integracao/v1/quem', headers: cabDe(A) });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ codigo: 'modulo_inativo' });
  });

  it('tx.auditar na rota de Conector: tenant da chave, módulo integracao, usuario_id nulo e request_id da requisição', async () => {
    const entidade = `teste_conector_${randomUUID().slice(0, 8)}`;
    const r = await app.inject({ method: 'POST', url: '/integracao/v1/auditar', headers: cabDe(A), payload: { entidade } });
    expect(r.statusCode, r.body).toBe(200);
    const linhas = await admin.query<{ tenant_id: string; usuario_id: string | null; modulo: string; request_id: string }>(
      'select tenant_id, usuario_id, modulo, request_id from plataforma.auditoria where entidade = $1',
      [entidade],
    );
    expect(linhas.rows).toEqual([{ tenant_id: A.tenantId, usuario_id: null, modulo: 'integracao', request_id: r.headers['x-request-id'] }]);
  });
});
