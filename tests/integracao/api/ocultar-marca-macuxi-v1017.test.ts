/**
 * v1.0.17 (Campo) — itens 15 e 19 do teste de campo do Campo v1.0.16 (desenho docs/desenho/v1017-campo-versao-e-marca.md §1 e §2;
 * RN-CORE-33). Matriz: docs/testes/v1017-campo-marca-versao.md.
 * API real (`createApp` + Core + 8 módulos), banco efêmero do arquivo (dois-tenants + 0091), pool do `macuxi_app` e do
 * `macuxi_portal`. Nada das `sa_*` é simulado.
 *  - OM-01  padrão: a marca de A e de B nasce com `ocultar_marca_macuxi = false` (banco, portal e parâmetro do Core no aparelho);
 *  - OM-02  RN-CORE-33: só o super-admin grava; o admin do cliente recebe 403 `PERFIL_SEM_ACESSO` (na própria empresa e em
 *           outra), sem sessão 401, token do app 401; nada muda;
 *  - OM-03  super-admin grava `true`: volta na resposta e no GET da marca, chega ao aparelho de A pelo parâmetro do Core
 *           `empresa_ocultar_marca_macuxi` (valor × regra: o parâmetro é a coluna do banco) e muda o `versao_licencas`;
 *  - OM-04  multi-tenant: gravar em A não muda B (banco, portal e aparelho de B);
 *  - OM-05  idempotência (o mesmo valor = uma auditoria só), volta a `false` e tenant inexistente 404;
 *  - AV-01  GET /v1/app/versao, pública: sem configuração = 404 `SEM_VERSAO` (400 e contrato: apps/api/test/app-versao.test.ts).
 * Roda só com banco e o papel do portal (CI, `stack-isolado.yml`); sem eles, pula.
 */
import { estadoBanco, semBanco } from '@macuxi/db/teste/estado';
import type { MeusModulosResposta } from '@macuxi/core/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, B, comToken, subirApi, type ApiDeTeste } from '../apoio/api';
import { auditoriaDoPortal, criarSuperAdmin, criarUsuarioNoTenant, sessaoDoPortal } from '../apoio/portal';

const SEGREDO_PLATAFORMA = 'segredo-de-plataforma-do-agente-testes-v1017-com-folga';
const ESTADO = estadoBanco();
const SEM_PORTAL = ESTADO.disponivel && !ESTADO.urlPortal ? 'sem MACUXI_PG_PORTAL_SENHA neste ambiente' : null;

// contas fictícias (senhas na RN-CORE-32)
const SUPER = { email: 'chefe.v1017@exemplo.com.br', nome: 'Chefe Macuxi Fictício', senha: 'Chefe#Marca-2026' };
const ADMIN_A = { email: 'admin.marca.v1017@exemplo.com.br', nome: 'Admin Fictício V1017', senha: 'Admin#Marca-2026' };

/** Chave reservada do Core escrita aqui (desenho §1), e não importada do SDK: o teste prova que o código diz o que o desenho manda. */
const PARAM_OCULTAR = 'empresa_ocultar_marca_macuxi';
const AUDITORIA = 'sa.empresa.ocultar_marca';
const VARIAVEIS_VERSAO = ['APP_CAMPO_VERSAO', 'APP_CAMPO_APK_URL', 'APP_CAMPO_PUBLICADA_EM', 'APP_GESTAO_VERSAO', 'APP_GESTAO_APK_URL', 'APP_GESTAO_PUBLICADA_EM'];
const core = (r: MeusModulosResposta) => r.modulos.find((m) => m.id === 'core')?.parametros ?? {};

describe.skipIf(semBanco() || !!SEM_PORTAL)('v1.0.17 ocultar a logomarca do Macuxi (item 15) e versão publicada do app (item 19)', () => {
  let api: ApiDeTeste;
  let tokenSuper = '';
  let tokenAdminA = '';
  let vendedorA = '';
  let vendedorB = '';
  const guardadas: Record<string, string | undefined> = {};

  const rota = (tenant: string) => `/v1/plataforma/empresas/${tenant}/marca/ocultar-macuxi`;
  const gravar = (token: string, tenant: string, corpo: unknown) =>
    api.app.inject({ method: 'PUT', url: rota(tenant), headers: comToken(token), payload: corpo as object });
  const marca = (token: string, tenant: string) => api.app.inject({ method: 'GET', url: `/v1/plataforma/empresas/${tenant}/marca`, headers: comToken(token) });
  const noBanco = async (id: string) =>
    (await api.admin.query<{ o: boolean }>('select ocultar_marca_macuxi as o from plataforma.tenant where id = $1', [id])).rows[0]!.o;
  const auditorias = async () => (await auditoriaDoPortal(api.admin)).filter((l) => l.acao === AUDITORIA);
  const codigo = (r: LightMyRequestResponse) => (r.json() as { codigo?: string }).codigo;

  beforeAll(async () => {
    // AV-01 "sem configuração": a API lê APP_<VARIANTE>_* na subida; nenhuma pode vir do ambiente da sessão
    for (const v of VARIAVEIS_VERSAO) {
      guardadas[v] = process.env[v];
      delete process.env[v];
    }
    api = await subirApi({ plataforma: { segredo: () => SEGREDO_PLATAFORMA } });
    await criarSuperAdmin(api.admin, SUPER);
    await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, ...ADMIN_A });
    tokenSuper = (await sessaoDoPortal(api, SUPER.email, SUPER.senha)).token;
    tokenAdminA = (await sessaoDoPortal(api, ADMIN_A.email, ADMIN_A.senha)).token;
    vendedorA = (await api.sessao('vendedor@exemplo.com.br', A)).access_token;
    vendedorB = (await api.sessao('vendedor@exemplo.com.br', B)).access_token;
  });

  afterAll(async () => {
    await api?.fechar();
    for (const v of VARIAVEIS_VERSAO) if (guardadas[v] !== undefined) process.env[v] = guardadas[v];
  });

  it('OM-01 padrão: as duas empresas nascem com ocultar_marca_macuxi = false (banco, portal e aparelho)', async () => {
    for (const [t, vendedor] of [[A.tenantId, () => vendedorA], [B.tenantId, () => vendedorB]] as const) {
      expect(await noBanco(t)).toBe(false);
      const m = await marca(tokenSuper, t);
      expect(m.statusCode, m.body).toBe(200);
      expect(m.json().ocultar_marca_macuxi).toBe(false);
      expect(core(await api.meusModulos(vendedor()))[PARAM_OCULTAR]).toBe(false);
    }
    expect((await marca(tokenAdminA, A.tenantId)).json().ocultar_marca_macuxi).toBe(false);
  });

  it('OM-02 RN-CORE-33: admin do cliente não grava (403), sem sessão 401, token do app 401; nada muda', async () => {
    const tentativas = [await gravar(tokenAdminA, A.tenantId, { ocultar: true }), await gravar(tokenAdminA, B.tenantId, { ocultar: true })];
    expect(tentativas.map((r) => [r.statusCode, codigo(r)])).toEqual([
      [403, 'PERFIL_SEM_ACESSO'],
      [403, 'PERFIL_SEM_ACESSO'],
    ]);
    expect((await gravar('', A.tenantId, { ocultar: true })).statusCode).toBe(401);
    expect((await gravar(vendedorA, A.tenantId, { ocultar: true })).statusCode).toBe(401);
    expect([await noBanco(A.tenantId), await noBanco(B.tenantId)]).toEqual([false, false]);
    expect(await auditorias()).toHaveLength(0);
  });

  it('OM-03/OM-04 super-admin oculta em A: volta na marca, chega ao aparelho de A (versao_licencas muda) e B não muda', async () => {
    const vA = (await api.meusModulos(vendedorA)).versao_licencas;
    const vB = (await api.meusModulos(vendedorB)).versao_licencas;
    const r = await gravar(tokenSuper, A.tenantId, { ocultar: true });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(r.json()).toMatchObject({ tenant_id: A.tenantId, ocultar_marca_macuxi: true });
    expect(JSON.stringify(r.json())).not.toContain('chave');
    expect(await noBanco(A.tenantId)).toBe(true);
    expect((await marca(tokenSuper, A.tenantId)).json().ocultar_marca_macuxi).toBe(true);
    // o admin do cliente vê o valor gravado (leitura continua dele)
    expect((await marca(tokenAdminA, A.tenantId)).json().ocultar_marca_macuxi).toBe(true);
    // valor × regra: o parâmetro do Core é a coluna do banco
    const mA = await api.meusModulos(vendedorA);
    expect(core(mA)[PARAM_OCULTAR]).toBe(await noBanco(A.tenantId));
    expect(core(mA)[PARAM_OCULTAR]).toBe(true);
    expect(mA.versao_licencas).not.toBe(vA);
    // B: nada muda
    expect(await noBanco(B.tenantId)).toBe(false);
    expect((await marca(tokenSuper, B.tenantId)).json().ocultar_marca_macuxi).toBe(false);
    const mB = await api.meusModulos(vendedorB);
    expect(core(mB)[PARAM_OCULTAR]).toBe(false);
    expect(mB.versao_licencas).toBe(vB);
  });

  it('OM-05 idempotência e volta: o mesmo valor não audita de novo; false volta a mostrar; tenant inexistente 404', async () => {
    expect(await auditorias()).toHaveLength(1);
    const igual = await gravar(tokenSuper, A.tenantId, { ocultar: true });
    expect(igual.statusCode).toBe(200);
    expect(igual.json().ocultar_marca_macuxi).toBe(true);
    expect(await auditorias()).toHaveLength(1);

    const inexistente = await gravar(tokenSuper, '00000000-0000-4000-8000-0000000000ff', { ocultar: true });
    expect([inexistente.statusCode, codigo(inexistente)]).toEqual([404, 'TENANT_NAO_ENCONTRADO']);

    const volta = await gravar(tokenSuper, A.tenantId, { ocultar: false });
    expect(volta.statusCode, volta.body).toBe(200);
    expect(volta.json().ocultar_marca_macuxi).toBe(false);
    expect(await noBanco(A.tenantId)).toBe(false);
    expect(core(await api.meusModulos(vendedorA))[PARAM_OCULTAR]).toBe(false);
    const linhas = await auditorias();
    expect(linhas).toHaveLength(2);
    for (const l of linhas) {
      expect(l.ator_tipo).toBe('super_admin');
      expect(l.bruto).not.toContain('@');
    }
  });

  it('AV-01 GET /v1/app/versao sem sessão: sem configuração = 404 SEM_VERSAO', async () => {
    const r = await api.app.inject({ method: 'GET', url: '/v1/app/versao?variante=campo' });
    expect([r.statusCode, codigo(r)], r.body).toEqual([404, 'SEM_VERSAO']);
  });
});
