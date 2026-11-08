/**
 * T-0087 fatia P — critérios 3 e 4 sem a tela (ADR 0029; desenho docs/desenho/T-0087.md §2 a §6; RN-CORE-31), no fluxo da
 * T-0093 (ADR 0031: portal só com e-mail e senha; sem convite, TOTP, desafio nem códigos de recuperação; o super-admin nasce
 * pelo deploy com `plataforma.criar_super_admin`).
 * API real (`createApp` + Core + 8 módulos + Postgres como macuxi_app e o portal no 2º pool, do macuxi_portal; banco efêmero do
 * arquivo com a 0035, a 0038 e a 0039), logger real (`opcoesLogger('trace')`). Prova, pela rota e pelo banco:
 *  - SA-01..05  só o super-admin com a senha certa chega a `/v1/plataforma/*`: senha errada, e-mail inexistente, token forjado
 *               (segredo do tenant, sessão inexistente, outro `sub`, sem `typ` — o token da ADR 0029 —, `typ` de cliente, sem
 *               `aud`, vencido) e sessão encerrada = 401; as rotas do convite/TOTP/desafio não existem mais (404);
 *  - SA-06      token de tenant recusado nas rotas do portal (401) e nas de sessão do portal;
 *  - SA-07      token do portal recusado nas rotas de tenant que não declararam `superAdmin` (401);
 *  - SA-08      passo Empresa com o admin inicial (RN-CORE-34, senha na RN-CORE-32) e rota `superAdmin: 'aceita'` (Hub):
 *               exige `x-macuxi-tenant`, tenant ativo e a licença DO TENANT; T-0094 (0040, P5): o admin inicial nasce com
 *               "trocar senha" sem validade — 403 SENHA_A_TROCAR no portal até criar a senha no BKO;
 *  - SA-09      deploy: `criar_super_admin` idempotente; `redefinir` revoga as sessões (o token cai na hora) e a senha antiga
 *               deixa de valer; `desativar` derruba a sessão;
 *  - SA-10      toda requisição do super-admin auditada (inclusive as recusadas), `ator_tipo` = super_admin, rota = modelo, IP
 *               só no prefixo; os fatos de login, sessão, provisionamento e saída na auditoria;
 *  - SA-11      nem log nem auditoria têm e-mail, nome, senha ou token.
 * Roda só com banco (CI, `stack-isolado.yml`); sem banco, o describe é pulado.
 */
import crypto from 'node:crypto';
import { hashSenha } from '@macuxi/db';
import { semBanco } from '@macuxi/db/teste/estado';
import { CABECALHO_TENANT_PLATAFORMA, CriarEmpresaRespostaSchema, ListaEmpresasSchema, SessaoPortalSchema } from '@macuxi/platform-sdk';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { opcoesLogger } from '../../../apps/api/src/config';
import { A, B, comToken, erroDe, SEGREDO_JWT, subirApi, type ApiDeTeste } from '../apoio/api';
import { auditoriaDoPortal, claimsDe, criarSuperAdmin, entrarNoPortal, esperarAuditoria, postPortal, sessaoDoPortal, tokenForjado } from '../apoio/portal';

// ---------- segredos só de teste (os reais ficam no .env da VM); senhas na RN-CORE-32 ----------
const SEGREDO_PLATAFORMA = 'segredo-de-plataforma-do-agente-testes-t0087-com-folga';
const SA = { email: 'operador.portal@exemplo.com.br', nome: 'Operador do Portal Fictício', senha: 'Senha-Forte-do-Portal-2026' };
const SENHA_NOVA_SA = 'Outra#Senha-do-Portal-2027';
const SA2 = { email: 'segundo.portal@exemplo.com.br', nome: 'Segundo Operador Fictício', senha: 'Segundo#Portal-2026' };
const ADMIN_INICIAL = { email: 'admin.inicial.t0087@exemplo.com.br', nome: 'Admin Inicial Fictício', senha: 'Inicial#Portal-2026' };
/** T-0094 (P5): a senha que o admin inicial cria no BKO no 1º uso. */
const SENHA_CRIADA_ADMIN = 'Criada#Admin-T0087';
const EMPRESA = { codigo: 'portal-t0087', razao_social: 'Empresa Portal T0087 Ltda', cnpj: '11222333000181' };
const SENHA_ERRADA = 'senha-errada-do-portal-123';
const NINGUEM = 'ninguem.aqui@exemplo.com.br';

describe.skipIf(semBanco())('T-0087/T-0093 portal do super-admin só com e-mail e senha, tudo auditado, log sem dado pessoal', () => {
  let api: ApiDeTeste;
  const linhasLog: string[] = [];
  /** Tudo o que nunca pode aparecer no log nem na auditoria (cresce ao longo dos casos). */
  const segredos: string[] = [SA.email, SA.nome, SA.senha, SENHA_NOVA_SA, SA2.email, SA2.senha, ADMIN_INICIAL.email, ADMIN_INICIAL.senha, SENHA_ERRADA, NINGUEM];
  let token1 = '';
  let saId = '';
  let sid1 = '';
  let novoTenant = '';
  /** request_id de cada requisição feita com o token do portal, com o status esperado. */
  const comTokenSA: { requestId: string; status: number; rota: string; tenant: string | null }[] = [];

  /** Chamada com o token do portal, guardando o request_id para conferir a auditoria. */
  async function comoSA(token: string, op: InjectOptions & { url: string }, esperado: { status: number; rota: string; tenant?: string | null }): Promise<LightMyRequestResponse> {
    const requestId = crypto.randomUUID();
    const r = await api.app.inject({ ...op, remoteAddress: '10.87.0.42', headers: { ...comToken(token), 'x-request-id': requestId, ...((op.headers as Record<string, string>) ?? {}) } });
    expect(r.statusCode, `${op.method} ${op.url}: ${r.body}`).toBe(esperado.status);
    comTokenSA.push({ requestId, status: esperado.status, rota: esperado.rota, tenant: esperado.tenant ?? null });
    return r;
  }

  beforeAll(async () => {
    api = await subirApi({
      logger: { ...opcoesLogger('trace'), stream: { write: (s: string) => void linhasLog.push(s) } },
      plataforma: { segredo: () => SEGREDO_PLATAFORMA },
    });
  }, 120_000);
  afterAll(async () => {
    await api?.fechar();
  });

  describe('SA-01..05 entrada: e-mail, senha e sessão', () => {
    it('SA-01 sem super-admin no banco: login = 401 CREDENCIAIS_INVALIDAS; as rotas do convite, do TOTP e do desafio não existem (404)', async () => {
      const r = await entrarNoPortal(api, SA.email, SA.senha);
      expect(r.statusCode, r.body).toBe(401);
      expect(erroDe(r).codigo).toBe('CREDENCIAIS_INVALIDAS');
      for (const c of ['primeiro-acesso', 'totp/iniciar', 'totp/confirmar', 'segundo-fator', 'recuperacao/regerar']) {
        const x = await postPortal(api, c, { payload: { ...SA, convite: 'convite-qualquer-com-mais-de-32-caracteres-x', desafio: 'x', codigo: '123456' } });
        expect(x.statusCode, `${c}: ${x.body}`).toBe(404);
      }
      const n = await api.admin.query<{ n: number }>('select count(*)::int as n from plataforma.super_admin');
      expect(n.rows[0]!.n).toBe(0);
    });

    it('SA-02 criado pelo deploy (criar_super_admin): entra só com e-mail e senha; sessão de super_admin sem empresa; e-mail com maiúsculas e espaços vale', async () => {
      saId = await criarSuperAdmin(api.admin, SA);
      const errada = await entrarNoPortal(api, SA.email, SENHA_ERRADA);
      expect(errada.statusCode, errada.body).toBe(401);
      const r = await entrarNoPortal(api, `  ${SA.email.toUpperCase()} `, SA.senha);
      expect(r.statusCode, r.body).toBe(200);
      const s = SessaoPortalSchema.parse(r.json());
      expect(s).toMatchObject({ tipo: 'super_admin', empresa: null, empresas: [] });
      expect(r.json()).not.toHaveProperty('desafio');
      token1 = s.token;
      segredos.push(token1);
      const c = claimsDe(token1);
      expect(c).toMatchObject({ sub: saId, typ: 'sa', aud: 'macuxi-plataforma', amr: ['pwd'] });
      expect(c).not.toHaveProperty('tid');
      sid1 = String(c.sid);
      const viva = await api.admin.query<{ tipo: string; super_admin_id: string }>('select tipo, super_admin_id from plataforma.portal_sessao where id = $1 and revogada_em is null', [sid1]);
      expect(viva.rows).toEqual([{ tipo: 'super_admin', super_admin_id: saId }]);
    });

    it('SA-03 GET /v1/plataforma/empresas = 200 com todas as empresas (critério 4)', async () => {
      const r = await comoSA(token1, { method: 'GET', url: '/v1/plataforma/empresas' }, { status: 200, rota: '/v1/plataforma/empresas' });
      const lista = ListaEmpresasSchema.parse(r.json());
      const todas = await api.admin.query<{ id: string }>('select id from plataforma.tenant where deleted_at is null');
      expect(lista.itens.map((e) => e.id).sort()).toEqual(todas.rows.map((x) => x.id).sort());
      expect(lista.itens.map((e) => e.id)).toEqual(expect.arrayContaining([A.tenantId, B.tenantId]));
    });

    it('SA-04 token forjado: segredo do tenant, sessão inexistente, outro sub, sem typ (ADR 0029), typ de cliente, sem aud ou vencido = 401', async () => {
      const agora = Math.floor(Date.now() / 1000);
      const base = { sub: saId, sid: sid1, typ: 'sa', aud: 'macuxi-plataforma', amr: ['pwd'], iat: agora, exp: agora + 600 };
      const forjados = [
        tokenForjado(base, SEGREDO_JWT),
        tokenForjado({ ...base, sid: crypto.randomUUID() }, SEGREDO_PLATAFORMA),
        tokenForjado({ ...base, sub: crypto.randomUUID() }, SEGREDO_PLATAFORMA),
        tokenForjado({ ...base, typ: undefined, amr: ['pwd', 'otp'] }, SEGREDO_PLATAFORMA),
        tokenForjado({ ...base, typ: 'cli' }, SEGREDO_PLATAFORMA),
        tokenForjado({ ...base, typ: 'sa', tid: A.tenantId }, SEGREDO_PLATAFORMA),
        tokenForjado({ ...base, aud: undefined }, SEGREDO_PLATAFORMA),
        tokenForjado({ ...base, amr: [] }, SEGREDO_PLATAFORMA),
        tokenForjado({ ...base, exp: agora - 1 }, SEGREDO_PLATAFORMA),
      ];
      // controle: o mesmo formato com o segredo certo e a sessão viva passa (o forjamento é que reprova)
      const controle = await api.app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: comToken(tokenForjado(base, SEGREDO_PLATAFORMA)) });
      expect(controle.statusCode, controle.body).toBe(200);
      for (const [i, t] of forjados.entries()) {
        const r = await api.app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: comToken(t) });
        expect(r.statusCode, `forjado ${i}: ${r.body}`).toBe(401);
        const p = await api.app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comToken(t), payload: { ...EMPRESA, admin: ADMIN_INICIAL, modulos: [{ modulo: 'integracao' }] } });
        expect(p.statusCode, `forjado ${i} POST: ${p.body}`).toBe(401);
      }
      const semToken = await api.app.inject({ method: 'GET', url: '/v1/plataforma/empresas' });
      expect(semToken.statusCode).toBe(401);
      const n = await api.admin.query<{ n: number }>('select count(*)::int as n from plataforma.tenant where codigo = $1', [EMPRESA.codigo]);
      expect(n.rows[0]!.n).toBe(0);
    });

    it('SA-05 sessão encerrada (sair) = 401 com o mesmo token; renovar também recusa; a outra sessão segue', async () => {
      const s2 = await sessaoDoPortal(api, SA.email, SA.senha);
      segredos.push(s2.token);
      await comoSA(s2.token, { method: 'GET', url: '/v1/plataforma/empresas' }, { status: 200, rota: '/v1/plataforma/empresas' });
      const renovada = await postPortal(api, 'renovar', { token: s2.token });
      expect(renovada.statusCode, renovada.body).toBe(200);
      const s3 = SessaoPortalSchema.parse(renovada.json());
      segredos.push(s3.token);
      expect(claimsDe(s3.token).sid).toBe(claimsDe(s2.token).sid);

      const sair = await postPortal(api, 'sair', { token: s2.token });
      expect(sair.statusCode, sair.body).toBe(204);
      for (const t of [s2.token, s3.token]) {
        const depois = await api.app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: comToken(t) });
        expect(depois.statusCode).toBe(401);
        const renovar = await postPortal(api, 'renovar', { token: t });
        expect(renovar.statusCode).toBe(401);
        expect(erroDe(renovar).codigo).toBe('SESSAO_PLATAFORMA_INVALIDA');
      }
      await comoSA(token1, { method: 'GET', url: '/v1/plataforma/empresas' }, { status: 200, rota: '/v1/plataforma/empresas' });
    });

    it('SA-05b sessão vencida no banco (teto de 8 h passado) = 401 na hora, mesmo com o token ainda no prazo', async () => {
      const s = await sessaoDoPortal(api, SA.email, SA.senha);
      segredos.push(s.token);
      const sid = String(claimsDe(s.token).sid);
      await api.admin.query(
        "update plataforma.portal_sessao set criada_em = now() - interval '9 hours', ultimo_uso_em = now() - interval '9 hours', expira_em = now() - interval '1 hour' where id = $1",
        [sid],
      );
      const r = await api.app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: comToken(s.token) });
      expect(r.statusCode, r.body).toBe(401);
      expect((await postPortal(api, 'renovar', { token: s.token })).statusCode).toBe(401);
    });
  });

  describe('SA-06..08 fronteira entre token de tenant e token do portal; passo Empresa', () => {
    it('SA-06 token de tenant (admin de A) recusado em /v1/plataforma/* e nas rotas de sessão do portal', async () => {
      const s = await api.sessao('admin@exemplo.com.br', A);
      segredos.push(s.access_token, s.refresh_token);
      const get = await api.chamar(s.access_token, { method: 'GET', url: '/v1/plataforma/empresas' });
      expect(get.statusCode, get.body).toBe(401);
      const post = await api.chamar(s.access_token, { method: 'POST', url: '/v1/plataforma/empresas', payload: { ...EMPRESA, admin: ADMIN_INICIAL, modulos: [{ modulo: 'integracao' }] } });
      expect(post.statusCode, post.body).toBe(401);
      for (const c of ['renovar', 'sair']) {
        const r = await postPortal(api, c, { token: s.access_token });
        expect(r.statusCode, `${c}: ${r.body}`).toBe(401);
      }
      const esc = await postPortal(api, 'empresa', { token: s.access_token, payload: { tenant_id: A.tenantId } });
      expect(esc.statusCode, esc.body).toBe(401);
      const n = await api.admin.query<{ n: number }>('select count(*)::int as n from plataforma.tenant where codigo = $1', [EMPRESA.codigo]);
      expect(n.rows[0]!.n).toBe(0);
    });

    it('SA-06b o super-admin não escolhe empresa (POST auth/empresa = 403 EMPRESA_NAO_PERMITIDA): ele já vê todas', async () => {
      const r = await postPortal(api, 'empresa', { token: token1, payload: { tenant_id: A.tenantId } });
      expect(r.statusCode, r.body).toBe(403);
      expect(erroDe(r).codigo).toBe('EMPRESA_NAO_PERMITIDA');
    });

    it.each([
      ['GET', '/v1/me/modulos'],
      ['GET', '/v1/core/usuarios'],
      ['GET', '/v1/core/clientes'],
      ['GET', '/v1/sync/novidades'],
      ['GET', '/v1/vendedor/pedidos'],
    ] as const)('SA-07 token do portal recusado em rota de tenant sem `superAdmin`: %s %s = 401', async (metodo, url) => {
      const r = await api.app.inject({ method: metodo, url, headers: { ...comToken(token1), [CABECALHO_TENANT_PLATAFORMA]: A.tenantId } });
      expect(r.statusCode, r.body).toBe(401);
    });

    it('SA-08a passo Empresa: sem admin = 422 RN-CORE-34; senha fraca = 422 RN-CORE-32 com o que falta; simular não cria; criar = 201 com o admin; repetir = 200 sem_mudanca e admin existente', async () => {
      const corpo = { ...EMPRESA, modulos: [{ modulo: 'integracao', licencas: null }] };
      const semAdmin = await comoSA(token1, { method: 'POST', url: '/v1/plataforma/empresas', payload: corpo }, { status: 422, rota: '/v1/plataforma/empresas' });
      expect(erroDe(semAdmin).codigo).toBe('RN-CORE-34');

      const fraca = await comoSA(token1, { method: 'POST', url: '/v1/plataforma/empresas', payload: { ...corpo, admin: { ...ADMIN_INICIAL, senha: 'semespecial1' } } }, { status: 422, rota: '/v1/plataforma/empresas' });
      const e = erroDe(fraca);
      expect(e.codigo).toBe('RN-CORE-32');
      expect(e.mensagem).toBe('Falta um caractere especial.');
      expect(e.detalhes).toMatchObject({ campo: 'admin.senha', faltas: ['especial'] });
      segredos.push('semespecial1');

      const sim = await comoSA(token1, { method: 'POST', url: '/v1/plataforma/empresas', payload: { ...corpo, admin: ADMIN_INICIAL, simular: true } }, { status: 200, rota: '/v1/plataforma/empresas' });
      expect(CriarEmpresaRespostaSchema.parse(sim.json()).simulado).toBe(true);
      const n0 = await api.admin.query<{ n: number }>('select count(*)::int as n from plataforma.tenant where codigo = $1', [EMPRESA.codigo]);
      expect(n0.rows[0]!.n).toBe(0);

      const r = await api.app.inject({ method: 'POST', url: '/v1/plataforma/empresas', remoteAddress: '10.87.0.42', headers: { ...comToken(token1), 'x-request-id': crypto.randomUUID() }, payload: { ...corpo, admin: ADMIN_INICIAL } });
      expect(r.statusCode, r.body).toBe(201);
      const criada = CriarEmpresaRespostaSchema.parse(r.json());
      expect(criada).toMatchObject({ resultado: 'criado', admin: 'criado' });
      novoTenant = criada.tenant_id!;
      comTokenSA.push({ requestId: r.headers['x-request-id'] as string, status: 201, rota: '/v1/plataforma/empresas', tenant: novoTenant });
      expect(r.body).not.toContain(ADMIN_INICIAL.senha);

      const de_novo = await comoSA(token1, { method: 'POST', url: '/v1/plataforma/empresas', payload: { ...corpo, admin: { ...ADMIN_INICIAL, senha: 'Trocaria#Senha-2026' } } }, { status: 200, rota: '/v1/plataforma/empresas', tenant: novoTenant });
      expect(CriarEmpresaRespostaSchema.parse(de_novo.json())).toMatchObject({ resultado: 'sem_mudanca', admin: 'existente' });
      segredos.push('Trocaria#Senha-2026');
      // o admin inicial é o 1º usuário da empresa, perfil admin, com hash argon2id (nunca a senha); a repetição não trocou a senha
      const u = await api.admin.query<{ perfil: string; ativo: boolean; hash: string }>('select perfil, ativo, senha_hash as hash from core.usuario where tenant_id = $1', [novoTenant]);
      expect(u.rows.map((x) => [x.perfil, x.ativo])).toEqual([['admin', true]]);
      expect(u.rows[0]!.hash).toMatch(/^\$argon2id\$/);
      // T-0094 (0040, P5): o admin inicial nasce com "trocar senha" e sem validade — o portal manda criar a senha no BKO
      expect(await api.admin.query('select trocar_senha, senha_expira_em from core.usuario where tenant_id = $1', [novoTenant]).then((x) => x.rows)).toEqual([{ trocar_senha: true, senha_expira_em: null }]);
      const antesDaTroca = await entrarNoPortal(api, ADMIN_INICIAL.email, ADMIN_INICIAL.senha);
      expect(`${antesDaTroca.statusCode} ${erroDe(antesDaTroca).codigo}`, antesDaTroca.body).toBe('403 SENHA_A_TROCAR');
      const troca = await api.app.inject({
        method: 'POST',
        url: '/v1/auth/senha/trocar',
        remoteAddress: '10.87.0.43',
        payload: { codigo_empresa: EMPRESA.codigo, email: ADMIN_INICIAL.email, senha_atual: ADMIN_INICIAL.senha, senha_nova: SENHA_CRIADA_ADMIN, app: 'web' },
      });
      expect(troca.statusCode, troca.body).toBe(200);
      segredos.push(SENHA_CRIADA_ADMIN, (troca.json() as { access_token: string }).access_token);
      expect((await entrarNoPortal(api, ADMIN_INICIAL.email, ADMIN_INICIAL.senha)).statusCode).toBe(401);
      const entra = await entrarNoPortal(api, ADMIN_INICIAL.email, SENHA_CRIADA_ADMIN);
      expect(entra.statusCode, entra.body).toBe(200);
      expect(SessaoPortalSchema.parse(entra.json())).toMatchObject({ tipo: 'admin_cliente', empresa: { id: novoTenant, codigo: EMPRESA.codigo } });
      segredos.push(SessaoPortalSchema.parse(entra.json()).token);
      expect((await entrarNoPortal(api, ADMIN_INICIAL.email, 'Trocaria#Senha-2026')).statusCode).toBe(401);
    });

    it('SA-08b rota `superAdmin: aceita` (GET /v1/integracao/conectores): sem tenant = 400; tenant inexistente = 404; sem a licença do tenant = 403; tenant certo = 200', async () => {
      const rota = '/v1/integracao/conectores';
      const semCab = await comoSA(token1, { method: 'GET', url: rota }, { status: 400, rota });
      expect(erroDe(semCab).codigo).toBe('TENANT_OBRIGATORIO');
      const inexistente = crypto.randomUUID();
      const r404 = await comoSA(token1, { method: 'GET', url: rota, headers: { [CABECALHO_TENANT_PLATAFORMA]: inexistente } }, { status: 404, rota });
      expect(erroDe(r404).codigo).toBe('TENANT_NAO_ENCONTRADO');
      // A não licencia o Hub (fixture): a licença DO TENANT vale também para o super-admin
      const r403 = await comoSA(token1, { method: 'GET', url: rota, headers: { [CABECALHO_TENANT_PLATAFORMA]: A.tenantId } }, { status: 403, rota, tenant: A.tenantId });
      expect(erroDe(r403).codigo).toBe('MODULO_INATIVO');
      const ok = await comoSA(token1, { method: 'GET', url: rota, headers: { [CABECALHO_TENANT_PLATAFORMA]: novoTenant } }, { status: 200, rota, tenant: novoTenant });
      expect(ok.json()).toEqual({ itens: [] });
    });
  });

  describe('SA-09 deploy (criar_super_admin): idempotente, redefinir e desativar derrubam a sessão', () => {
    it('criar de novo = sem_mudanca (a senha não muda); e-mail inexistente e senha errada = mesma resposta', async () => {
      const r = await api.admin.query<{ r: { resultado: string } }>('select plataforma.criar_super_admin($1::jsonb) as r', [
        JSON.stringify({ acao: 'criar', email: SA.email, nome: SA.nome, senha_hash: hashSenha(SENHA_NOVA_SA) }),
      ]);
      expect(r.rows[0]!.r.resultado).toBe('sem_mudanca');
      expect((await entrarNoPortal(api, SA.email, SENHA_NOVA_SA)).statusCode).toBe(401);
      const a = await entrarNoPortal(api, NINGUEM, SENHA_ERRADA);
      const b = await entrarNoPortal(api, SA.email, SENHA_ERRADA);
      expect([a.statusCode, b.statusCode]).toEqual([401, 401]);
      expect(erroDe(a)).toEqual(erroDe(b));
      expect(erroDe(a).codigo).toBe('CREDENCIAIS_INVALIDAS');
    });

    it('redefinir revoga as sessões (o token cai na hora) e só a senha nova entra; desativar derruba a sessão do outro super-admin', async () => {
      await criarSuperAdmin(api.admin, SA2);
      const s2 = await sessaoDoPortal(api, SA2.email, SA2.senha);
      segredos.push(s2.token);

      const red = await api.admin.query<{ r: { resultado: string; sessoes_revogadas: number } }>('select plataforma.criar_super_admin($1::jsonb) as r', [
        JSON.stringify({ acao: 'redefinir', email: SA.email, senha_hash: hashSenha(SENHA_NOVA_SA) }),
      ]);
      expect(red.rows[0]!.r.resultado).toBe('redefinido');
      expect(red.rows[0]!.r.sessoes_revogadas).toBeGreaterThanOrEqual(1);
      const caiu = await api.app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: comToken(token1) });
      expect(caiu.statusCode, caiu.body).toBe(401);
      expect((await entrarNoPortal(api, SA.email, SA.senha)).statusCode).toBe(401);
      const nova = await sessaoDoPortal(api, SA.email, SENHA_NOVA_SA);
      token1 = nova.token;
      segredos.push(token1);
      await comoSA(token1, { method: 'GET', url: '/v1/plataforma/empresas' }, { status: 200, rota: '/v1/plataforma/empresas' });

      const des = await api.admin.query<{ r: { resultado: string } }>('select plataforma.criar_super_admin($1::jsonb) as r', [JSON.stringify({ acao: 'desativar', email: SA2.email })]);
      expect(des.rows[0]!.r.resultado).toBe('desativado');
      expect((await api.app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: comToken(s2.token) })).statusCode).toBe(401);
      expect((await entrarNoPortal(api, SA2.email, SA2.senha)).statusCode).toBe(401);
    });
  });

  describe('SA-10..11 auditoria e LGPD (critério 6)', () => {
    it('SA-10 toda requisição com o token do portal tem 1 linha sa.requisicao (inclusive 400/403/404/422), ator_tipo super_admin, rota-modelo e IP só no prefixo', async () => {
      const linhas = await esperarAuditoria(api.admin, comTokenSA.map((x) => x.requestId));
      const req = linhas.filter((l) => l.acao === 'sa.requisicao');
      const faltas: string[] = [];
      for (const e of comTokenSA) {
        const doReq = req.filter((l) => l.request_id === e.requestId);
        if (doReq.length !== 1) {
          faltas.push(`${e.rota} ${e.status}: ${doReq.length} linha(s)`);
          continue;
        }
        const l = doReq[0]!;
        if (l.status !== e.status) faltas.push(`${e.rota}: status ${l.status} ≠ ${e.status}`);
        if (l.rota !== e.rota) faltas.push(`rota ${l.rota} ≠ ${e.rota}`);
        if (l.ator_tipo !== 'super_admin') faltas.push(`${e.rota}: ator_tipo ${l.ator_tipo}`);
        if (l.super_admin_id !== saId) faltas.push(`${e.rota}: super_admin_id ${l.super_admin_id}`);
        if (l.usuario_id !== null) faltas.push(`${e.rota}: usuario_id ${l.usuario_id} num acesso de super-admin`);
        if (!l.sessao_id) faltas.push(`${e.rota}: sem sessao_id`);
        if (e.tenant && l.tenant_alvo_id !== e.tenant) faltas.push(`${e.rota} ${e.status}: tenant_alvo_id ${l.tenant_alvo_id} ≠ ${e.tenant}`);
        if (l.ip_prefixo !== '10.87.0.0/24') faltas.push(`${e.rota}: ip_prefixo ${l.ip_prefixo}`);
      }
      expect(faltas).toEqual([]);
      for (const l of linhas) {
        if (l.ip_prefixo !== null) expect(l.ip_prefixo).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.0\/24$|::\/48$/);
        if (l.rota !== null) expect(l.rota).not.toContain('?');
      }
    });

    it('SA-10b os fatos de login, sessão, provisionamento, saída e deploy ficam na auditoria; as falhas também', async () => {
      const acoes = new Set((await auditoriaDoPortal(api.admin)).map((l) => l.acao));
      for (const a of [
        'sa.login.consulta',
        'sa.login.ok',
        'sa.login.falha',
        'sa.sessao.aberta',
        'sa.sair',
        'sa.tenant.provisionar',
        'sa.requisicao',
        'sa.super_admin.criar',
        'sa.super_admin.redefinir',
        'sa.super_admin.desativar',
      ])
        expect(acoes, a).toContain(a);
      for (const velha of ['sa.primeiro_acesso', 'sa.totp.cadastrar', 'sa.totp.confirmado', 'sa.recuperacao.usar']) expect(acoes, velha).not.toContain(velha);
    });

    it('SA-10d (T-0091) com dois pools, cada sessão aberta tem a sua linha sa.sessao.aberta, e o macuxi_portal não lê nem altera a auditoria', async () => {
      expect(api.poolPortal, 'o apoio subiu sem o pool do portal').not.toBeNull();
      const sessoes = await api.admin.query<{ id: string }>('select id::text as id from plataforma.portal_sessao order by 1');
      const abertas = await api.admin.query<{ id: string }>("select sessao_id::text as id from plataforma.auditoria_plataforma where acao = 'sa.sessao.aberta' order by 1");
      expect(sessoes.rows.length).toBeGreaterThanOrEqual(5);
      expect(abertas.rows.map((x) => x.id)).toEqual(sessoes.rows.map((x) => x.id));
      const c = await api.poolPortal!.connect();
      try {
        for (const sql of ['select 1 from plataforma.auditoria_plataforma limit 1', "update plataforma.auditoria_plataforma set acao = 'sa.apagada'", 'delete from plataforma.auditoria_plataforma'])
          await expect(c.query(sql), sql).rejects.toMatchObject({ code: '42501' });
      } finally {
        c.release();
      }
    });

    it('SA-10c a auditoria é append-only: o app não lê nem escreve na tabela, e nem o admin altera ou apaga', async () => {
      const app = await api.pool.connect();
      try {
        await expect(app.query('select 1 from plataforma.auditoria_plataforma limit 1')).rejects.toMatchObject({ code: '42501' });
        await expect(app.query("insert into plataforma.auditoria_plataforma (acao) values ('sa.forjada')")).rejects.toMatchObject({ code: '42501' });
      } finally {
        app.release();
      }
      await expect(api.admin.query("update plataforma.auditoria_plataforma set acao = 'sa.apagada'")).rejects.toMatchObject({ code: '42501' });
      await expect(api.admin.query('delete from plataforma.auditoria_plataforma')).rejects.toMatchObject({ code: '42501' });
    });

    it('SA-11 nem a auditoria nem o log (trace) têm e-mail, nome, senha ou token', async () => {
      const auditoriaTexto = (await auditoriaDoPortal(api.admin)).map((l) => l.bruto).join('\n');
      const logTexto = linhasLog.join('');
      expect(linhasLog.length).toBeGreaterThan(10);
      const vazados = (texto: string) => segredos.filter((x) => x && texto.includes(x)).map((x) => `${x.slice(0, 8)}…`);
      expect(vazados(auditoriaTexto), 'na auditoria').toEqual([]);
      expect(vazados(logTexto), 'no log').toEqual([]);
      expect(auditoriaTexto.toLowerCase()).not.toContain(SA.email.split('@')[0]!);
      expect(logTexto.toLowerCase()).not.toContain(SA.email.split('@')[0]!);
      expect(logTexto).not.toMatch(/authorization|bearer|"body"|"payload"|"headers"|argon2id/i);
    });
  });
});
