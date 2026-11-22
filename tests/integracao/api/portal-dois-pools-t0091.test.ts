/**
 * T-0091 — a API em dois pools (critérios 2 e 3; condição da ADR 0029; desenho docs/desenho/T-0091.md §3 e §6; RN-CORE-31).
 * T-0093 (ADR 0031; 0039): mesmo que antes, com o portal só com e-mail e senha (sem convite, TOTP nem desafio): o super-admin
 * nasce pelo deploy (`plataforma.criar_super_admin`, conexão de ADMINISTRAÇÃO) e entra por `POST /v1/plataforma/auth/login`;
 * o admin do cliente também entra (escolha de empresa) e também só pelo pool do portal.
 * API real (`createApp` + Core + 8 módulos), banco efêmero do arquivo com a 0038/0039, pool do `macuxi_app` e pool do
 * `macuxi_portal` (`criarBancoPortal`), com o SQL de cada pool registrado (`espiarSql`, só o texto, nunca os parâmetros):
 *  - DP-01  `verificar()` do banco do portal recusa conexão que não seja `macuxi_portal` (app e admin) e aceita a dele;
 *  - DP-02  login, sessão, empresas e provisionamento do super-admin: toda `plataforma.sa_*` sai do pool do portal, NENHUMA
 *           do pool do app; o portal nunca abre tenant (`app.tenant_id`) nem lê tabela;
 *  - DP-02b login do admin do cliente com 2 empresas e a escolha da empresa: idem (sa_contas_para_login, sa_abrir_sessao_portal,
 *           sa_escolher_empresa só no portal);
 *  - DP-03  rota de módulo com `superAdmin: 'aceita'` (Hub): sessão e tenant ativo no portal; o dado do tenant no app (RLS);
 *  - DP-04  rotas de tenant (login, /v1/me/modulos, Core) não tocam no pool do portal;
 *  - DP-05  auditoria: cada sessão aberta (plataforma.portal_sessao) tem a sua linha `sa.sessao.aberta` (e o login, o
 *           provisionamento e as requisições as delas); como `macuxi_portal`, ler, inserir, alterar ou apagar a auditoria = 42501;
 *  - DP-06  sem o pool do portal (servidor sem MACUXI_PG_PORTAL_SENHA): o portal responde 503 PORTAL_INDISPONIVEL (falha
 *           fechada) e as rotas de tenant seguem (login, módulos, 401 sem token, 403 de licença na rota do Hub).
 * Roda só com banco (CI, `stack-isolado.yml`); sem banco, pula.
 */
import crypto from 'node:crypto';
import { estadoBanco, semBanco } from '@macuxi/db/teste/estado';
import { CABECALHO_TENANT_PLATAFORMA, CriarEmpresaRespostaSchema, ListaEmpresasSchema, SessaoPortalSchema } from '@macuxi/platform-sdk';
import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoPortal } from '../../../apps/api/src/banco';
import { A, B, comToken, erroDe, novoIp, poolComEncerramento, subirApi, type ApiDeTeste } from '../apoio/api';
import { criarSuperAdmin, criarUsuarioNoTenant, entrarNoPortal, escolherEmpresa, funcoesSa, tokenForjado } from '../apoio/portal';
import { CORPO_ROTA_ACEITA, ROTA_ACEITA_CORE } from '../apoio/rota-aceita';

const SEGREDO_PLATAFORMA = 'segredo-de-plataforma-do-agente-testes-t0091-com-folga';
/** Senhas de fixture na RN-CORE-32 (8+ com letra, número e caractere especial). */
const SA = { email: 'operador.t0091@exemplo.com.br', nome: 'Operador Fictício T0091', senha: 'Senha-Forte-do-Portal-T0091' };
const CLIENTE = { email: 'cliente.t0091@exemplo.com.br', senha: 'Cliente#Portal-T0091' };
const EMPRESA = {
  codigo: 'portal-t0091',
  razao_social: 'Empresa Portal T0091 Ltda',
  cnpj: '11444777000161',
  admin: { email: 'admin.inicial.t0091@exemplo.com.br', nome: 'Admin Inicial T0091', senha: 'Inicial#T0091' },
};
const PLATAFORMA = { segredo: () => SEGREDO_PLATAFORMA };

const ESTADO = estadoBanco();
const SEM_PORTAL = ESTADO.disponivel && !ESTADO.urlPortal ? 'sem MACUXI_PG_PORTAL_SENHA neste ambiente' : null;

describe.skipIf(semBanco() || !!SEM_PORTAL)('T-0091/T-0093 API em dois pools: o portal só pelo macuxi_portal, o tenant só pelo macuxi_app', () => {
  let api: ApiDeTeste;
  let token = '';
  let novoTenant = '';

  /** Executa `fn` e devolve o SQL que cada pool rodou durante ela. */
  async function durante(fn: () => Promise<unknown>): Promise<{ app: string[]; portal: string[] }> {
    const ia = api.sqlApp.length;
    const ip = api.sqlPortal.length;
    await fn();
    // o onResponse grava a auditoria depois da resposta: folga curta para as gravações tardias entrarem na janela
    await new Promise((r) => setTimeout(r, 500));
    return { app: api.sqlApp.slice(ia), portal: api.sqlPortal.slice(ip) };
  }
  /** O portal nunca põe tenant no contexto nem toca tabela de módulo direto. */
  const portalTocouTenant = (sql: readonly string[]) =>
    sql.filter((t) => /app\.tenant_id|\b(from|into|update)\s+(core|vendedor|catalogo|integracao|promotor|gestor|pesquisa|treinamento|plataforma)\.(?!sa_)/i.test(t));

  beforeAll(async () => {
    api = await subirApi({ plataforma: PLATAFORMA, espiarSql: true });
    expect(api.poolPortal, 'o apoio subiu sem o pool do portal').not.toBeNull();
    // super-admin como o deploy cria (P3): pela conexão de administração, nunca pelo portal nem pelo app
    await criarSuperAdmin(api.admin, SA);
    // admin do cliente com o mesmo e-mail em A e B (a fixture só repete o e-mail do vendedor)
    await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, email: CLIENTE.email, nome: 'Cliente Alfa T0091', senha: CLIENTE.senha });
    await criarUsuarioNoTenant(api.admin, { tenantId: B.tenantId, email: CLIENTE.email, nome: 'Cliente Beta T0091', senha: CLIENTE.senha });
  }, 120_000);
  afterAll(async () => {
    await api?.fechar();
  });

  it('DP-01 verificar(): o banco do portal recusa o macuxi_app e o admin e aceita o macuxi_portal', async () => {
    await expect(criarBancoPortal(api.poolPortal!).verificar()).resolves.toBeUndefined();
    for (const url of [api.banco.urlApp, api.banco.urlAdmin]) {
      const p = poolComEncerramento(new pg.Pool({ connectionString: url, max: 1 }));
      try {
        await expect(criarBancoPortal(p.pool).verificar()).rejects.toThrow(/macuxi_portal/);
      } finally {
        await p.encerrar();
      }
    }
    // o portal nunca abre tenant (erro de programação, antes do banco)
    await expect(criarBancoPortal(api.poolPortal!).comTenant(A.tenantId, async () => 1)).rejects.toThrow(/nunca abre tenant/);
  });

  it('DP-02 login do super-admin, empresas e provisionamento: toda sa_* no pool do portal, nenhuma no do app', async () => {
    const sql = await durante(async () => {
      const r = await entrarNoPortal(api, SA.email, SA.senha);
      expect(r.statusCode, r.body).toBe(200);
      const s = SessaoPortalSchema.parse(r.json());
      expect(s.tipo).toBe('super_admin');
      token = s.token;

      const lista = await api.app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: comToken(token) });
      expect(lista.statusCode, lista.body).toBe(200);
      expect(ListaEmpresasSchema.parse(lista.json()).itens.map((e) => e.id)).toEqual(expect.arrayContaining([A.tenantId, B.tenantId]));

      const criar = await api.app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comToken(token), payload: { ...EMPRESA, modulos: [{ modulo: 'integracao', licencas: null }] } });
      expect(criar.statusCode, criar.body).toBe(201);
      const criada = CriarEmpresaRespostaSchema.parse(criar.json());
      expect(criada.admin).toBe('criado');
      novoTenant = criada.tenant_id!;
    });
    expect(funcoesSa(sql.app), 'sa_* no pool do macuxi_app').toEqual([]);
    expect(funcoesSa(sql.portal)).toEqual(
      expect.arrayContaining(['sa_tentativa_estado', 'sa_contas_para_login', 'sa_tentativa_sucesso', 'sa_abrir_sessao_portal', 'sa_sessao_valida', 'sa_auditar', 'sa_listar_tenants', 'sa_provisionar_tenant']),
    );
    // nenhuma das funções que a 0039 apagou é chamada
    const removidas = ['existe', 'criar_primeiro', 'para_login', 'por_id', 'registrar_falha', 'registrar_sucesso', 'gravar_totp_pendente', 'confirmar_totp', 'marcar_passo', 'usar_recuperacao', 'regerar_recuperacao', 'abrir_desafio', 'ver_desafio', 'abrir_sessao'].map((n) => `sa_${n}`);
    expect(funcoesSa(sql.portal).filter((f) => removidas.includes(f))).toEqual([]);
    expect(portalTocouTenant(sql.portal)).toEqual([]);
  });

  it('DP-02b admin do cliente (mesmo e-mail em A e B): login, escolha da empresa e lista só pelo pool do portal', async () => {
    const sql = await durante(async () => {
      const r = await entrarNoPortal(api, CLIENTE.email, CLIENTE.senha);
      expect(r.statusCode, r.body).toBe(200);
      const s = SessaoPortalSchema.parse(r.json());
      expect(s.tipo).toBe('admin_cliente');
      expect(s.empresa).toBeNull();
      expect(s.empresas.map((e) => e.id).sort()).toEqual([A.tenantId, B.tenantId].sort());
      const esc = await escolherEmpresa(api, s.token, B.tenantId);
      expect(esc.statusCode, esc.body).toBe(200);
      const tk = SessaoPortalSchema.parse(esc.json()).token;
      const lista = await api.app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: comToken(tk) });
      expect(lista.statusCode, lista.body).toBe(200);
      expect(ListaEmpresasSchema.parse(lista.json()).itens.map((e) => e.id).sort()).toEqual([A.tenantId, B.tenantId].sort());
    });
    expect(funcoesSa(sql.app), 'sa_* no pool do macuxi_app').toEqual([]);
    expect(funcoesSa(sql.portal)).toEqual(expect.arrayContaining(['sa_contas_para_login', 'sa_abrir_sessao_portal', 'sa_escolher_empresa', 'sa_sessao_valida', 'sa_listar_tenants']));
    expect(portalTocouTenant(sql.portal)).toEqual([]);
  });

  it('DP-03 rota de módulo com superAdmin (GET /v1/integracao/conectores): sessão e tenant ativo no portal, dado do tenant no app', async () => {
    expect(novoTenant, 'DP-02 precisa criar a empresa').not.toBe('');
    let r: LightMyRequestResponse | undefined;
    const sql = await durante(async () => {
      r = await api.app.inject({ method: 'GET', url: '/v1/integracao/conectores', headers: { ...comToken(token), [CABECALHO_TENANT_PLATAFORMA]: novoTenant } });
    });
    expect(r!.statusCode, r!.body).toBe(200);
    expect(funcoesSa(sql.portal)).toEqual(expect.arrayContaining(['sa_sessao_valida', 'sa_tenant_ativo', 'sa_auditar']));
    expect(funcoesSa(sql.app)).toEqual([]);
    expect(sql.app.some((t) => /app\.tenant_id/.test(t)), 'o dado do tenant não passou pelo macuxi_app com o tenant no contexto').toBe(true);
  });

  it('DP-04 rotas de tenant (login, /v1/me/modulos, /v1/core/usuarios) não tocam no pool do portal', async () => {
    const sql = await durante(async () => {
      const s = await api.sessao('admin@exemplo.com.br', A);
      await api.meusModulos(s.access_token);
      const u = await api.chamar(s.access_token, { method: 'GET', url: '/v1/core/usuarios' });
      expect(u.statusCode, u.body).toBe(200);
      const semToken = await api.app.inject({ method: 'GET', url: '/v1/core/usuarios' });
      expect(semToken.statusCode).toBe(401);
    });
    expect(sql.portal).toEqual([]);
    expect(sql.app.length).toBeGreaterThan(0);
  });

  it('DP-05 auditoria: cada sessão aberta tem a sua sa.sessao.aberta; login, provisionamento e requisições auditados; o portal não mexe na tabela (42501)', async () => {
    const sessoes = await api.admin.query<{ id: string }>('select id::text as id from plataforma.portal_sessao order by 1');
    const abertas = await api.admin.query<{ id: string }>("select sessao_id::text as id from plataforma.auditoria_plataforma where acao = 'sa.sessao.aberta' order by 1");
    expect(sessoes.rows.length).toBeGreaterThanOrEqual(2);
    expect(abertas.rows.map((x) => x.id)).toEqual(sessoes.rows.map((x) => x.id));
    // nenhuma sessão nova na tabela antiga (0035): ela fica só de histórico
    const antigas = await api.admin.query<{ n: number }>('select count(*)::int as n from plataforma.super_admin_sessao');
    expect(antigas.rows[0]!.n).toBe(0);
    const acoes = await api.admin.query<{ acao: string; n: number }>('select acao, count(*)::int as n from plataforma.auditoria_plataforma group by acao');
    const porAcao = new Map(acoes.rows.map((x) => [x.acao, x.n]));
    for (const a of ['sa.login.consulta', 'sa.login.ok', 'sa.empresa.escolher', 'sa.tenant.provisionar', 'sa.requisicao']) expect(porAcao.get(a) ?? 0, a).toBeGreaterThan(0);

    const c = await api.poolPortal!.connect();
    try {
      for (const sql of [
        'select 1 from plataforma.auditoria_plataforma limit 1',
        "insert into plataforma.auditoria_plataforma (acao) values ('sa.forjada')",
        "update plataforma.auditoria_plataforma set acao = 'sa.apagada'",
        'delete from plataforma.auditoria_plataforma',
        'select 1 from plataforma.portal_sessao limit 1',
        'delete from plataforma.portal_tentativa',
      ]) {
        await expect(c.query(sql), sql).rejects.toMatchObject({ code: '42501' });
      }
    } finally {
      c.release();
    }
  });
});

describe.skipIf(semBanco())('T-0091/T-0093 sem o pool do portal (sem MACUXI_PG_PORTAL_SENHA): portal 503, tenants seguem', () => {
  let api: ApiDeTeste;

  beforeAll(async () => {
    api = await subirApi({ plataforma: PLATAFORMA, semPortal: true });
    expect(api.poolPortal).toBeNull();
  }, 120_000);
  afterAll(async () => {
    await api?.fechar();
  });

  it.each(['login', 'empresa', 'renovar', 'sair'])('DP-06a POST /v1/plataforma/auth/%s = 503 PORTAL_INDISPONIVEL', async (caminho) => {
    const corpo = caminho === 'login' ? { email: SA.email, senha: SA.senha } : caminho === 'empresa' ? { tenant_id: A.tenantId } : undefined;
    const r = await api.app.inject({ method: 'POST', url: `/v1/plataforma/auth/${caminho}`, remoteAddress: novoIp(), ...(corpo ? { payload: corpo } : {}) });
    expect(r.statusCode, r.body).toBe(503);
    expect(erroDe(r).codigo).toBe('PORTAL_INDISPONIVEL');
  });

  it('DP-06b /v1/plataforma/empresas (GET e POST, com ou sem token) e o token do portal em rota de módulo = 503 PORTAL_INDISPONIVEL', async () => {
    const agora = Math.floor(Date.now() / 1000);
    const base = { sid: crypto.randomUUID(), aud: 'macuxi-plataforma', amr: ['pwd'], iat: agora, exp: agora + 600 };
    const sa = tokenForjado({ ...base, sub: crypto.randomUUID(), typ: 'sa' }, SEGREDO_PLATAFORMA);
    const cli = tokenForjado({ ...base, sub: crypto.randomUUID(), typ: 'cli', tid: A.tenantId }, SEGREDO_PLATAFORMA);
    const casos: LightMyRequestResponse[] = [
      await api.app.inject({ method: 'GET', url: '/v1/plataforma/empresas' }),
      await api.app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: comToken(sa) }),
      await api.app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: comToken(cli) }),
      await api.app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comToken(sa), payload: { ...EMPRESA, modulos: [{ modulo: 'integracao' }] } }),
      await api.app.inject({ method: 'GET', url: '/v1/integracao/conectores', headers: { ...comToken(sa), [CABECALHO_TENANT_PLATAFORMA]: A.tenantId } }),
      await api.app.inject({ method: 'POST', url: ROTA_ACEITA_CORE, payload: CORPO_ROTA_ACEITA, headers: { ...comToken(cli), [CABECALHO_TENANT_PLATAFORMA]: A.tenantId } }),
    ];
    expect(casos.map((r) => `${r.statusCode} ${erroDe(r).codigo}`)).toEqual(Array(casos.length).fill('503 PORTAL_INDISPONIVEL'));
    const n = await api.admin.query<{ n: number }>('select count(*)::int as n from plataforma.tenant where codigo = $1', [EMPRESA.codigo]);
    expect(n.rows[0]!.n).toBe(0);
  });

  it('DP-06c os tenants seguem: login, /v1/me/modulos, Core = 200; sem token = 401; rota do Hub (superAdmin aceita) com token de tenant = 403 de licença, não 503', async () => {
    const s = await api.sessao('admin@exemplo.com.br', A);
    const mods = await api.meusModulos(s.access_token);
    expect(mods.modulos.length).toBeGreaterThan(0);
    const u = await api.chamar(s.access_token, { method: 'GET', url: '/v1/core/usuarios' });
    expect(u.statusCode, u.body).toBe(200);
    const semToken = await api.app.inject({ method: 'GET', url: '/v1/core/usuarios' });
    expect(semToken.statusCode, semToken.body).toBe(401);
    const lixo = await api.app.inject({ method: 'GET', url: '/v1/core/usuarios', headers: comToken('nao.e.um.jwt') });
    expect(lixo.statusCode, lixo.body).toBe(401);
    // A não licencia o Hub (fixture): a recusa é a da licença do tenant, não a do portal
    const hub = await api.chamar(s.access_token, { method: 'GET', url: '/v1/integracao/conectores' });
    expect(`${hub.statusCode} ${erroDe(hub).codigo}`).toBe('403 MODULO_INATIVO');
  });
});
