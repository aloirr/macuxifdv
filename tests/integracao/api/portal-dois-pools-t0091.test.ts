/**
 * T-0091 — a API em dois pools (critérios 2 e 3; condição da ADR 0029; desenho docs/desenho/T-0091.md §3 e §6; RN-CORE-31).
 * API real (`createApp` + Core + 8 módulos), banco efêmero do arquivo com a 0038, pool do `macuxi_app` e pool do
 * `macuxi_portal` (`criarBancoPortal`), com o SQL de cada pool registrado (`espiarSql`, só o texto, nunca os parâmetros):
 *  - DP-01  `verificar()` do banco do portal recusa conexão que não seja `macuxi_portal` (app e admin) e aceita a dele;
 *  - DP-02  primeiro acesso, TOTP, sessão, empresas e provisionamento: toda `plataforma.sa_*` sai do pool do portal, NENHUMA
 *           do pool do app; o portal nunca abre tenant (`app.tenant_id`) nem lê tabela;
 *  - DP-03  rota de módulo com `superAdmin: 'aceita'` (Hub): sessão e tenant ativo no portal; o dado do tenant no app (RLS);
 *  - DP-04  rotas de tenant (login, /v1/me/modulos, Core) não tocam no pool do portal;
 *  - DP-05  auditoria: cada sessão aberta tem a sua linha `sa.sessao.aberta` (e o provisionamento e as requisições as delas);
 *           como `macuxi_portal`, ler, inserir, alterar ou apagar a auditoria direto = 42501;
 *  - DP-06  sem o pool do portal (servidor sem MACUXI_PG_PORTAL_SENHA): o portal responde 503 PORTAL_INDISPONIVEL e as
 *           rotas de tenant seguem (login, módulos, 401 sem token, 403 de licença na rota do Hub).
 * Roda só com banco (CI, `stack-isolado.yml`); sem banco, pula.
 */
import crypto from 'node:crypto';
import { estadoBanco, semBanco } from '@macuxi/db/teste/estado';
import { CABECALHO_TENANT_PLATAFORMA, CriarEmpresaRespostaSchema, EtapaLoginSchema, ListaEmpresasSchema, TotpConfirmadoSchema, TotpInicioSchema } from '@macuxi/platform-sdk';
import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoPortal } from '../../../apps/api/src/banco';
import { A, comToken, erroDe, novoIp, poolComEncerramento, subirApi, type ApiDeTeste } from '../apoio/api';

const SEGREDO_PLATAFORMA = 'segredo-de-plataforma-do-agente-testes-t0091-com-folga';
const CHAVE_TOTP = Buffer.alloc(32, 9).toString('base64');
const CONVITE = 'convite-do-portal-do-agente-testes-t0091-0123456789';
const SA = { email: 'operador.t0091@exemplo.com.br', nome: 'Operador Fictício T0091', senha: 'Senha-Forte-do-Portal-T0091' };
const EMPRESA = { codigo: 'portal-t0091', razao_social: 'Empresa Portal T0091 Ltda', cnpj: '11444777000161' };
const PLATAFORMA = { segredo: () => SEGREDO_PLATAFORMA, chaveTotp: () => CHAVE_TOTP, convite: () => CONVITE };

const ESTADO = estadoBanco();
const SEM_PORTAL = ESTADO.disponivel && !ESTADO.urlPortal ? 'sem MACUXI_PG_PORTAL_SENHA neste ambiente' : null;

// ---------- TOTP (RFC 6238) independente do Core ----------
function base32(s: string): Buffer {
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let valor = 0;
  const saida: number[] = [];
  for (const c of s.replace(/=+$/, '')) {
    valor = (valor << 5) | alfabeto.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      saida.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(saida);
}
function totp(segredo: Buffer, passo = Math.floor(Date.now() / 1000 / 30)): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(passo));
  const h = crypto.createHmac('sha1', segredo).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  const n = ((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
}
function jwtPlataforma(claims: Record<string, unknown>): string {
  const b = (x: unknown) => Buffer.from(JSON.stringify(x)).toString('base64url');
  const cab = b({ alg: 'HS256', typ: 'JWT' });
  const corpo = b(claims);
  return `${cab}.${corpo}.${crypto.createHmac('sha256', SEGREDO_PLATAFORMA).update(`${cab}.${corpo}`).digest('base64url')}`;
}

/** Nomes das `plataforma.sa_*` citadas num trecho de SQL registrado. */
const SA_FN = /plataforma\.(sa_[a-z_]+)\s*\(/g;
const funcoesSa = (sql: readonly string[]): string[] => [...new Set(sql.flatMap((t) => [...t.matchAll(SA_FN)].map((m) => m[1]!)))].sort();

describe.skipIf(semBanco() || !!SEM_PORTAL)('T-0091 API em dois pools: o super-admin só pelo macuxi_portal, o tenant só pelo macuxi_app', () => {
  let api: ApiDeTeste;
  let token = '';
  let novoTenant = '';

  const publico = (caminho: string, payload?: unknown, headers?: Record<string, string>): Promise<LightMyRequestResponse> =>
    api.app.inject({ method: 'POST', url: `/v1/plataforma/auth/${caminho}`, remoteAddress: novoIp(), ...(payload !== undefined ? { payload: payload as object } : {}), ...(headers ? { headers } : {}) });

  /** Executa `fn` e devolve o SQL que cada pool rodou durante ela. */
  async function durante(fn: () => Promise<unknown>): Promise<{ app: string[]; portal: string[] }> {
    const ia = api.sqlApp.length;
    const ip = api.sqlPortal.length;
    await fn();
    // o onResponse grava a auditoria depois da resposta: folga curta para as gravações tardias entrarem na janela
    await new Promise((r) => setTimeout(r, 500));
    return { app: api.sqlApp.slice(ia), portal: api.sqlPortal.slice(ip) };
  }

  beforeAll(async () => {
    api = await subirApi({ plataforma: PLATAFORMA, espiarSql: true });
    expect(api.poolPortal, 'o apoio subiu sem o pool do portal').not.toBeNull();
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

  it('DP-02 primeiro acesso, TOTP, sessão, empresas e provisionamento: toda sa_* no pool do portal, nenhuma no do app', async () => {
    const sql = await durante(async () => {
      const r = await publico('primeiro-acesso', { ...SA, convite: CONVITE });
      expect(r.statusCode, r.body).toBe(200);
      const etapa = EtapaLoginSchema.parse(r.json());
      const ini = await publico('totp/iniciar', { desafio: etapa.desafio });
      expect(ini.statusCode, ini.body).toBe(200);
      const segredo = base32(TotpInicioSchema.parse(ini.json()).segredo_base32);
      const conf = await publico('totp/confirmar', { desafio: etapa.desafio, codigo: totp(segredo) });
      expect(conf.statusCode, conf.body).toBe(200);
      token = TotpConfirmadoSchema.parse(conf.json()).sessao.token;

      const lista = await api.app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: comToken(token) });
      expect(lista.statusCode, lista.body).toBe(200);
      expect(ListaEmpresasSchema.parse(lista.json()).itens.map((e) => e.id)).toContain(A.tenantId);

      const criar = await api.app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comToken(token), payload: { ...EMPRESA, modulos: [{ modulo: 'integracao', licencas: null }] } });
      expect(criar.statusCode, criar.body).toBe(201);
      novoTenant = CriarEmpresaRespostaSchema.parse(criar.json()).tenant_id!;
    });
    expect(funcoesSa(sql.app), 'sa_* no pool do macuxi_app').toEqual([]);
    expect(funcoesSa(sql.portal)).toEqual(
      expect.arrayContaining(['sa_abrir_desafio', 'sa_abrir_sessao', 'sa_auditar', 'sa_confirmar_totp', 'sa_criar_primeiro', 'sa_listar_tenants', 'sa_provisionar_tenant', 'sa_sessao_valida']),
    );
    // o portal nunca põe tenant no contexto nem toca tabela de módulo direto
    expect(sql.portal.filter((t) => /app\.tenant_id|\b(from|into|update)\s+(core|vendedor|catalogo|integracao|promotor|gestor|pesquisa|treinamento)\./i.test(t))).toEqual([]);
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

  it('DP-05 auditoria: cada sessão aberta tem a sua sa.sessao.aberta; provisionamento e requisições auditados; o portal não mexe na tabela (42501)', async () => {
    const sessoes = await api.admin.query<{ id: string }>('select id::text as id from plataforma.super_admin_sessao order by 1');
    const abertas = await api.admin.query<{ id: string }>("select sessao_id::text as id from plataforma.auditoria_plataforma where acao = 'sa.sessao.aberta' order by 1");
    expect(sessoes.rows.length).toBeGreaterThan(0);
    expect(abertas.rows.map((x) => x.id)).toEqual(sessoes.rows.map((x) => x.id));
    const acoes = await api.admin.query<{ acao: string; n: number }>('select acao, count(*)::int as n from plataforma.auditoria_plataforma group by acao');
    const porAcao = new Map(acoes.rows.map((x) => [x.acao, x.n]));
    for (const a of ['sa.primeiro_acesso', 'sa.totp.confirmado', 'sa.tenant.provisionar', 'sa.requisicao']) expect(porAcao.get(a) ?? 0, a).toBeGreaterThan(0);

    const c = await api.poolPortal!.connect();
    try {
      for (const sql of [
        'select 1 from plataforma.auditoria_plataforma limit 1',
        "insert into plataforma.auditoria_plataforma (acao) values ('sa.forjada')",
        "update plataforma.auditoria_plataforma set acao = 'sa.apagada'",
        'delete from plataforma.auditoria_plataforma',
      ]) {
        await expect(c.query(sql), sql).rejects.toMatchObject({ code: '42501' });
      }
    } finally {
      c.release();
    }
  });
});

describe.skipIf(semBanco())('T-0091 sem o pool do portal (sem MACUXI_PG_PORTAL_SENHA): portal 503, tenants seguem', () => {
  let api: ApiDeTeste;

  beforeAll(async () => {
    api = await subirApi({ plataforma: PLATAFORMA, semPortal: true });
    expect(api.poolPortal).toBeNull();
  }, 120_000);
  afterAll(async () => {
    await api?.fechar();
  });

  it.each(['primeiro-acesso', 'login', 'totp/iniciar', 'totp/confirmar', 'segundo-fator', 'renovar', 'sair', 'recuperacao/regerar'])(
    'DP-06a POST /v1/plataforma/auth/%s = 503 PORTAL_INDISPONIVEL',
    async (caminho) => {
      const r = await api.app.inject({ method: 'POST', url: `/v1/plataforma/auth/${caminho}`, remoteAddress: novoIp(), payload: { email: SA.email, senha: SA.senha } });
      expect(r.statusCode, r.body).toBe(503);
      expect(erroDe(r).codigo).toBe('PORTAL_INDISPONIVEL');
    },
  );

  it('DP-06b /v1/plataforma/empresas (GET e POST, com ou sem token) e o token de plataforma em rota de módulo = 503 PORTAL_INDISPONIVEL', async () => {
    const agora = Math.floor(Date.now() / 1000);
    const tk = jwtPlataforma({ sub: crypto.randomUUID(), sid: crypto.randomUUID(), aud: 'macuxi-plataforma', amr: ['pwd', 'otp'], iat: agora, exp: agora + 600 });
    const casos: LightMyRequestResponse[] = [
      await api.app.inject({ method: 'GET', url: '/v1/plataforma/empresas' }),
      await api.app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: comToken(tk) }),
      await api.app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comToken(tk), payload: { ...EMPRESA, modulos: [{ modulo: 'integracao' }] } }),
      await api.app.inject({ method: 'GET', url: '/v1/integracao/conectores', headers: { ...comToken(tk), [CABECALHO_TENANT_PLATAFORMA]: A.tenantId } }),
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
