/**
 * v1.0.34 (ADR 0075; migração 0102; RN-CORE-31/32/34, RN-CORE-01): `usuario` {nome, perfil, cargo} na sessão do portal e
 * `POST /v1/plataforma/auth/senha` (204), com API real (`createApp` + Core + módulos), banco efêmero do arquivo, pool do
 * `macuxi_app` e do `macuxi_portal` e logger real em `trace` capturado. Prova, pela rota e pelo banco:
 *  - TS-01  super-admin ponta a ponta: login → troca (204) → as DUAS sessões dele caem (401) → login com a antiga 401 e com a nova 200;
 *  - TS-02  super-admin: senha atual errada conta falha no mesmo bloqueio do login; 4 erros = 401, o 5º = 423 BLOQUEADO; durante o
 *           bloqueio a senha atual CERTA = 423 e o login também = 423; a senha não muda;
 *  - TS-03  super-admin: nova fraca (RN-CORE-32) e igual à atual (RN-CORE-34) = 422, sem gravar; a função recusa admin do cliente (42501);
 *  - TS-04  admin do cliente com empresa: 403 TROCA_SO_SUPER_ADMIN (ele troca pela rota pública `POST /v1/auth/senha/trocar`);
 *           hash e `sessao_versao` iguais, nenhuma sessão do portal revogada, a sessão segue viva e a senha antiga segue entrando;
 *  - TS-05  admin do cliente: senha atual errada também = 403 (a rota não confere a senha dele) e `tentativas_falhas` não muda;
 *  - TS-06  admin sem empresa escolhida (2 empresas) também = 403 TROCA_SO_SUPER_ADMIN (a rota olha o tipo, não a empresa);
 *  - TS-07  isolamento: o mesmo e-mail em A e B; na sessão de A com `x-macuxi-tenant` de B = 403 e nem A nem B mudam;
 *  - TS-08  `usuario` na sessão: login, escolha de empresa e renovar (super-admin: nome, perfil e cargo nulos; admin: nome do
 *           core.usuario + nome e cargo do 1º perfil vivo, conferidos contra o banco pela regra da 0102);
 *  - TS-09  nem log nem auditoria têm e-mail, nome, senha ou hash.
 * Sem banco ou sem o papel do portal, pula.
 */
import { estadoBanco, semBanco } from '@macuxi/db/teste/estado';
import { SessaoPortalSchema } from '@macuxi/platform-sdk';
import { CODIGOS_PORTAL } from '@macuxi/core/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { opcoesLogger } from '../../../apps/api/src/config';
import { A, B, erroDe, subirApi, type ApiDeTeste } from '../apoio/api';
import {
  auditoriaDoPortal,
  criarSuperAdmin,
  criarUsuarioNoTenant,
  entrarNoPortal,
  escolherEmpresa,
  postPortal,
  sessaoDoPortal,
} from '../apoio/portal';

const SEGREDO_PLATAFORMA = 'segredo-de-plataforma-do-agente-testes-v1034-com-folga';
const ESTADO = estadoBanco();
const SEM_PORTAL =
  ESTADO.disponivel && !ESTADO.urlPortal ? 'sem MACUXI_PG_PORTAL_SENHA neste ambiente' : null;

// ---------- contas de teste (senhas na RN-CORE-32) ----------
const SA = {
  email: 'chefe.v1034@exemplo.com.br',
  nome: 'Chefe Troca Fictício',
  senha: 'Chefe#Troca-2026',
  nova: 'Chefe#Nova-2027',
};
const SA_BLOQ = {
  email: 'bloq.v1034@exemplo.com.br',
  nome: 'Bloqueio Troca Fictício',
  senha: 'Bloq#Troca-2026',
  nova: 'Bloq#Nova-2027',
};
const ADM = {
  email: 'adm.v1034@exemplo.com.br',
  nome: 'Administradora Alfa Fictícia',
  senha: 'Adm#Alfa-2026',
  nova: 'Adm#AlfaNova-2027',
};
const ADM_SID = {
  email: 'sid.v1034@exemplo.com.br',
  nome: 'Admin Da Funcao Fictício',
  senha: 'Sid#Alfa-2026',
};
const MULTI = {
  email: 'multi.v1034@exemplo.com.br',
  nome: 'Admin Duas Empresas Fictício',
  senha: 'Multi#Duas-2026',
  nova: 'Multi#Nova-2027',
};
const SENHA_ERRADA = 'Errada#Senha-0000';
const PERFIL = { codigo: 'adm_geral_v1034', nome: 'Administração Geral', cargo: 'administrativo' };

describe.skipIf(semBanco() || !!SEM_PORTAL)('v1.0.34 troca de senha pelo portal e usuario na sessão', () => {
  let api: ApiDeTeste;
  const linhasLog: string[] = [];
  const segredos: string[] = [
    SA.email,
    SA.nome,
    SA.senha,
    SA.nova,
    SA_BLOQ.email,
    SA_BLOQ.nome,
    SA_BLOQ.senha,
    SA_BLOQ.nova,
    ADM.email,
    ADM.nome,
    ADM.senha,
    ADM.nova,
    ADM_SID.email,
    ADM_SID.nome,
    ADM_SID.senha,
    MULTI.email,
    MULTI.nome,
    MULTI.senha,
    MULTI.nova,
    SENHA_ERRADA,
  ];
  let admId = '';
  let multiA = '';
  let multiB = '';

  const trocar = (
    token: string,
    senha_atual: string,
    senha_nova: string,
    headers: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> =>
    api.app.inject({
      method: 'POST',
      url: '/v1/plataforma/auth/senha',
      remoteAddress: `10.34.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
      payload: { senha_atual, senha_nova },
      headers: { authorization: `Bearer ${token}`, ...headers },
    });
  const empresas = (token: string) =>
    api.app.inject({
      method: 'GET',
      url: '/v1/plataforma/empresas',
      headers: { authorization: `Bearer ${token}` },
    });
  const hashSa = async (email: string) =>
    (
      await api.admin.query<{ h: string }>(
        'select senha_hash as h from plataforma.super_admin where lower(email) = lower($1)',
        [email],
      )
    ).rows[0]!.h;
  const usuario = async (id: string) =>
    (
      await api.admin.query<{ h: string; v: number; f: number }>(
        'select senha_hash as h, sessao_versao::int as v, tentativas_falhas::int as f from core.usuario where id = $1',
        [id],
      )
    ).rows[0]!;
  const revogadasDoUsuario = async (id: string) =>
    (
      await api.admin.query<{ n: number }>(
        'select count(*)::int as n from plataforma.portal_sessao where usuario_atual_id = $1 and revogada_em is not null',
        [id],
      )
    ).rows[0]!.n;
  /** Admin do cliente na rota do portal (ADR 0075, v1.0.34): 403 TROCA_SO_SUPER_ADMIN. */
  const esperarSoSuperAdmin = (r: LightMyRequestResponse) => {
    expect(r.statusCode, r.body).toBe(403);
    expect(erroDe(r).codigo).toBe(CODIGOS_PORTAL.trocaSoSuperAdmin);
    expect(erroDe(r).mensagem).toBe('Troque a sua senha no backoffice, com o código da empresa.');
  };
  /** Regra da 0102 (sa_quem_sou), calculada pelo teste: nome do core.usuario + nome e cargo do 1º perfil vivo (created_at, id). */
  const esperadoDoAdmin = async (tenantId: string, id: string) => {
    const r = await api.admin.query<{ nome: string; perfil: string | null; cargo: string | null }>(
      `select u.nome, p.nome as perfil, p.cargo from core.usuario u
         left join lateral (select pf.nome, pf.cargo from plataforma.usuario_perfil up
                              join plataforma.perfil pf on pf.tenant_id = up.tenant_id and pf.id = up.perfil_id and pf.deleted_at is null
                             where up.tenant_id = u.tenant_id and up.usuario_id = u.id and up.deleted_at is null
                             order by up.created_at, up.id limit 1) p on true
        where u.tenant_id = $1 and u.id = $2`,
      [tenantId, id],
    );
    return r.rows[0]!;
  };

  beforeAll(async () => {
    api = await subirApi({
      logger: { ...opcoesLogger('trace'), stream: { write: (s: string) => void linhasLog.push(s) } },
      plataforma: { segredo: () => SEGREDO_PLATAFORMA },
    });
    await criarSuperAdmin(api.admin, SA);
    await criarSuperAdmin(api.admin, SA_BLOQ);
    admId = await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, ...ADM });
    // perfil configurável com cargo, único vínculo vivo do ADM (valor × regra do `usuario.perfil`/`usuario.cargo`)
    const p = await api.admin.query<{ id: string }>(
      'insert into plataforma.perfil (tenant_id, codigo, nome, base, cargo) values ($1, $2, $3, $4, $5) returning id',
      [A.tenantId, PERFIL.codigo, PERFIL.nome, 'admin', PERFIL.cargo],
    );
    // 1 vínculo vivo por usuário (usuario_perfil_um_vivo): o automático passa a apontar o perfil com cargo
    await api.admin.query(
      'update plataforma.usuario_perfil set perfil_id = $3 where tenant_id = $1 and usuario_id = $2 and deleted_at is null',
      [A.tenantId, admId, p.rows[0]!.id],
    );
    await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, ...ADM_SID });
    multiA = await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, ...MULTI });
    multiB = await criarUsuarioNoTenant(api.admin, { tenantId: B.tenantId, ...MULTI });
  }, 180_000);
  afterAll(async () => {
    if (process.env.MACUXI_LOG_TESTE)
      (await import('node:fs')).writeFileSync(process.env.MACUXI_LOG_TESTE, linhasLog.join(''));
    await api?.fechar();
  });

  describe('TS-08 usuario na sessão do portal (login, escolha de empresa, renovar)', () => {
    it('super-admin: usuario = { nome do super_admin, perfil null, cargo null } no login e no renovar', async () => {
      const s = await sessaoDoPortal(api, SA.email, SA.senha);
      expect(s.usuario).toEqual({ nome: SA.nome, perfil: null, cargo: null });
      const ren = await postPortal(api, 'renovar', { token: s.token });
      expect(ren.statusCode, ren.body).toBe(200);
      expect(SessaoPortalSchema.parse(ren.json()).usuario).toEqual({
        nome: SA.nome,
        perfil: null,
        cargo: null,
      });
    });

    it('admin com 1 empresa: usuario = nome do core.usuario + nome e cargo do perfil (igual à regra calculada no banco) no login e no renovar', async () => {
      const s = await sessaoDoPortal(api, ADM.email, ADM.senha);
      expect(s.tipo).toBe('admin_cliente');
      const esperado = await esperadoDoAdmin(A.tenantId, admId);
      expect(esperado).toEqual({ nome: ADM.nome, perfil: PERFIL.nome, cargo: PERFIL.cargo });
      expect(s.usuario).toEqual(esperado);
      const ren = await postPortal(api, 'renovar', { token: s.token });
      expect(ren.statusCode, ren.body).toBe(200);
      expect(SessaoPortalSchema.parse(ren.json()).usuario).toEqual(esperado);
    });

    it('admin com 2 empresas: sem empresa = usuario null; depois da escolha = os dados DAQUELA empresa', async () => {
      const s = await sessaoDoPortal(api, MULTI.email, MULTI.senha);
      expect(s.empresa).toBeNull();
      expect(s.usuario ?? null).toBeNull();
      const esc = await escolherEmpresa(api, s.token, B.tenantId);
      expect(esc.statusCode, esc.body).toBe(200);
      expect(SessaoPortalSchema.parse(esc.json()).usuario).toEqual(await esperadoDoAdmin(B.tenantId, multiB));
    });
  });

  describe('TS-06/07 admin: sem empresa e isolamento', () => {
    it('TS-06 admin sem empresa escolhida = 403 TROCA_SO_SUPER_ADMIN e nada muda em A nem em B', async () => {
      const antesA = await usuario(multiA);
      const antesB = await usuario(multiB);
      const s = await sessaoDoPortal(api, MULTI.email, MULTI.senha);
      expect(s.empresa).toBeNull();
      esperarSoSuperAdmin(await trocar(s.token, MULTI.senha, MULTI.nova));
      expect(await usuario(multiA)).toEqual(antesA);
      expect(await usuario(multiB)).toEqual(antesB);
    });

    it('TS-07 admin na sessão de A (com x-macuxi-tenant de B) = 403 TROCA_SO_SUPER_ADMIN; nem A nem B mudam', async () => {
      const antesA = await usuario(multiA);
      const antesB = await usuario(multiB);
      const s = await sessaoDoPortal(api, MULTI.email, MULTI.senha);
      const esc = await escolherEmpresa(api, s.token, A.tenantId);
      expect(esc.statusCode, esc.body).toBe(200);
      const tokenA = SessaoPortalSchema.parse(esc.json()).token;
      esperarSoSuperAdmin(await trocar(tokenA, MULTI.senha, MULTI.nova, { 'x-macuxi-tenant': B.tenantId }));
      expect(await usuario(multiA)).toEqual(antesA);
      expect(await usuario(multiB)).toEqual(antesB);
      expect((await api.entrar(MULTI.email, { senha: MULTI.senha, tenant: A })).statusCode).toBe(200);
      expect((await api.entrar(MULTI.email, { senha: MULTI.senha, tenant: B })).statusCode).toBe(200);
    });
  });

  describe('TS-04/05 admin do cliente com empresa: a rota do portal não troca a senha dele', () => {
    it('TS-04 403 TROCA_SO_SUPER_ADMIN: hash e sessao_versao iguais, nada revogado, a sessão segue viva, a antiga entra no portal e no BKO', async () => {
      const antes = await usuario(admId);
      const s = await sessaoDoPortal(api, ADM.email, ADM.senha);
      expect((await empresas(s.token)).statusCode).toBe(200);
      const revogadasAntes = await revogadasDoUsuario(admId);
      esperarSoSuperAdmin(await trocar(s.token, ADM.senha, ADM.nova));
      expect(await usuario(admId)).toEqual(antes);
      expect(await revogadasDoUsuario(admId)).toBe(revogadasAntes);
      expect((await empresas(s.token)).statusCode).toBe(200);
      expect((await entrarNoPortal(api, ADM.email, ADM.nova)).statusCode).toBe(401);
      expect((await sessaoDoPortal(api, ADM.email, ADM.senha)).empresa?.id).toBe(A.tenantId);
      expect((await api.entrar(ADM.email, { senha: ADM.senha, tenant: A })).statusCode).toBe(200);
    });

    it('TS-05 senha atual errada também = 403 (a rota não confere a senha do admin) e tentativas_falhas não muda', async () => {
      const antes = await usuario(admId);
      const s = await sessaoDoPortal(api, ADM.email, ADM.senha);
      esperarSoSuperAdmin(await trocar(s.token, SENHA_ERRADA, ADM.nova));
      expect(await usuario(admId)).toEqual(antes);
      expect((await empresas(s.token)).statusCode).toBe(200);
    });
  });

  describe('TS-01..03 super-admin', () => {
    it('TS-01 ponta a ponta: login → troca (204) → todas as sessões dele 401 → antiga 401, nova 200', async () => {
      const hAntes = await hashSa(SA.email);
      const vivasDoSa = async () =>
        (
          await api.admin.query<{ n: number }>(
            'select count(*)::int as n from plataforma.portal_sessao x join plataforma.super_admin s on s.id = x.super_admin_id where lower(s.email) = lower($1) and x.revogada_em is null',
            [SA.email],
          )
        ).rows[0]!.n;
      const s1 = await sessaoDoPortal(api, SA.email, SA.senha);
      const s2 = await sessaoDoPortal(api, SA.email, SA.senha);
      const vivasAntes = await vivasDoSa();
      expect(vivasAntes).toBeGreaterThanOrEqual(2);
      const r = await trocar(s1.token, SA.senha, SA.nova);
      expect(r.statusCode, r.body).toBe(204);
      expect(r.body).toBe('');
      const hDepois = await hashSa(SA.email);
      segredos.push(hAntes, hDepois);
      expect(hDepois).not.toBe(hAntes);
      expect(hDepois).toMatch(/^\$argon2id\$/);
      expect((await empresas(s1.token)).statusCode).toBe(401);
      expect((await empresas(s2.token)).statusCode).toBe(401);
      expect(await vivasDoSa()).toBe(0);
      expect((await entrarNoPortal(api, SA.email, SA.senha)).statusCode).toBe(401);
      const nova = await sessaoDoPortal(api, SA.email, SA.nova);
      expect(nova.tipo).toBe('super_admin');
      expect((await empresas(nova.token)).statusCode).toBe(200);
      const aud = (await auditoriaDoPortal(api.admin)).filter((l) => l.acao === 'sa.senha.trocada');
      expect(aud).toHaveLength(1);
      expect(aud[0]!.detalhes).toMatchObject({ sessoes_revogadas: vivasAntes });
    });

    it('TS-03 nova fraca (RN-CORE-32) e igual à atual (RN-CORE-34) = 422 sem gravar; a função recusa sessão de admin (42501)', async () => {
      const s = await sessaoDoPortal(api, SA.email, SA.nova);
      const h = await hashSa(SA.email);
      const fraca = await trocar(s.token, SA.nova, 'semnumero');
      expect(fraca.statusCode, fraca.body).toBe(422);
      expect(erroDe(fraca).codigo).toBe('RN-CORE-32');
      expect(fraca.json()).toHaveProperty('detalhes.faltas');
      const igual = await trocar(s.token, SA.nova, SA.nova);
      expect(igual.statusCode, igual.body).toBe(422);
      expect(erroDe(igual).codigo).toBe('RN-CORE-34');
      expect(await hashSa(SA.email)).toBe(h);
      // hash atual que não confere com o gravado (como se tivesse mudado no meio) = false, nada muda (base do 409 SENHA_MUDOU)
      const sid = String(JSON.parse(Buffer.from(s.token.split('.')[1]!, 'base64url').toString()).sid);
      const portal = api.poolPortal!;
      const f = await portal.query<{ r: boolean }>(
        'select plataforma.sa_gravar_senha_super_admin($1, $2, $3) as r',
        [sid, `${h}x`, h],
      );
      expect(f.rows[0]!.r).toBe(false);
      expect(await hashSa(SA.email)).toBe(h);
      const adm = await sessaoDoPortal(api, ADM_SID.email, ADM_SID.senha);
      const sidAdm = String(JSON.parse(Buffer.from(adm.token.split('.')[1]!, 'base64url').toString()).sid);
      await expect(
        portal.query('select plataforma.sa_gravar_senha_super_admin($1, $2, $3)', [sidAdm, h, h]),
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('TS-02 senha atual errada conta no bloqueio do login: 4 × 401, 5º = 423 BLOQUEADO; depois, certa = 423 e login = 423; senha não muda', async () => {
      const s = await sessaoDoPortal(api, SA_BLOQ.email, SA_BLOQ.senha);
      const h = await hashSa(SA_BLOQ.email);
      for (let i = 1; i <= 4; i += 1) {
        const r = await trocar(s.token, SENHA_ERRADA, SA_BLOQ.nova);
        expect(r.statusCode, `erro ${i}: ${r.body}`).toBe(401);
        expect(erroDe(r).codigo).toBe('CREDENCIAIS_INVALIDAS');
      }
      const quinto = await trocar(s.token, SENHA_ERRADA, SA_BLOQ.nova);
      expect(quinto.statusCode, quinto.body).toBe(423);
      expect(erroDe(quinto).codigo).toBe('BLOQUEADO');
      const certa = await trocar(s.token, SA_BLOQ.senha, SA_BLOQ.nova);
      expect(certa.statusCode, certa.body).toBe(423);
      expect(erroDe(certa).codigo).toBe('BLOQUEADO');
      expect((await entrarNoPortal(api, SA_BLOQ.email, SA_BLOQ.senha)).statusCode).toBe(423);
      expect(await hashSa(SA_BLOQ.email)).toBe(h);
      const falhas = (await auditoriaDoPortal(api.admin)).filter(
        (l) => l.acao === 'sa.senha.falha' && l.status === 423,
      );
      expect(falhas.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('TS-09 nem log nem auditoria têm e-mail, nome, senha ou hash', async () => {
    const hashes = (
      await api.admin.query<{ h: string }>(
        'select senha_hash as h from plataforma.super_admin union all select senha_hash from core.usuario where senha_hash is not null',
      )
    ).rows.map((x) => x.h);
    const aud = (await auditoriaDoPortal(api.admin)).map((l) => l.bruto);
    const textos = [...linhasLog, ...aud];
    expect(linhasLog.length).toBeGreaterThan(0);
    for (const seg of [...segredos, ...hashes]) {
      const achado = textos.find((t) => t.toLowerCase().includes(seg.toLowerCase()));
      expect(achado, `vazou "${seg.slice(0, 12)}…"`).toBeUndefined();
    }
    // nenhuma rota respondeu 500 neste arquivo
    expect(linhasLog.filter((l) => /"status":5\d\d/.test(l)).length).toBe(0);
  });
});
