/**
 * T-0087 fatia P — critérios 3 e 4 sem a tela (ADR 0029; desenho docs/desenho/T-0087.md §2 a §6; RN-CORE-31).
 * API real (`createApp` + Core + 8 módulos + Postgres como macuxi_app e, desde a T-0091, o super-admin no 2º pool, do
 * macuxi_portal; banco efêmero do arquivo com a 0035 e a 0038), logger real
 * (`opcoesLogger('trace')`). Prova, pela rota e pelo banco:
 *  - SA-01..05  só o super-admin com 2º fator chega a `/v1/plataforma/*`: convite errado, senha sem código, desafio usado
 *               como token, token forjado (segredo do tenant, sessão inexistente) e sessão encerrada = 401;
 *  - SA-06      token de tenant recusado nas rotas do portal (401) e nas de autenticação do portal;
 *  - SA-07      token de plataforma recusado nas rotas de tenant que não declararam `superAdmin` (401);
 *  - SA-08      rota `superAdmin: 'aceita'` (Hub): exige `x-macuxi-tenant`, tenant ativo e a licença DO TENANT;
 *  - SA-09      TOTP sem reuso do passo; código de recuperação de uso único; e-mail inexistente = senha errada;
 *  - SA-10      toda requisição do super-admin auditada (inclusive as recusadas), rota = modelo, IP só prefixo;
 *  - SA-11      nem log nem auditoria têm e-mail, nome, senha, convite, segredo TOTP, códigos, desafio ou token.
 * O gerador de TOTP aqui é próprio (RFC 6238, SHA-1, 30 s, 6 dígitos), independente do do Core.
 * Roda só com banco (CI, `stack-isolado.yml`); sem banco, o describe é pulado.
 */
import crypto from 'node:crypto';
import { semBanco } from '@macuxi/db/teste/estado';
import {
  CABECALHO_TENANT_PLATAFORMA,
  CriarEmpresaRespostaSchema,
  EtapaLoginSchema,
  ListaEmpresasSchema,
  SessaoPlataformaSchema,
  TotpConfirmadoSchema,
  TotpInicioSchema,
} from '@macuxi/platform-sdk';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { opcoesLogger } from '../../../apps/api/src/config';
import { A, B, comToken, erroDe, novoIp, SEGREDO_JWT, subirApi, type ApiDeTeste } from '../apoio/api';

// ---------- segredos só de teste (os reais ficam no .env da VM) ----------
const SEGREDO_PLATAFORMA = 'segredo-de-plataforma-do-agente-testes-t0087-com-folga';
const CHAVE_TOTP = Buffer.alloc(32, 7).toString('base64');
const CONVITE = 'convite-do-portal-do-agente-testes-t0087-0123456789';
const SA = { email: 'operador.portal@exemplo.com.br', nome: 'Operador do Portal Fictício', senha: 'Senha-Forte-do-Portal-2026' };
const EMPRESA = { codigo: 'portal-t0087', razao_social: 'Empresa Portal T0087 Ltda', cnpj: '11222333000181' };

// ---------- TOTP (RFC 6238) independente ----------
function base32Decodificar(s: string): Buffer {
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let valor = 0;
  const saida: number[] = [];
  for (const c of s.replace(/=+$/, '')) {
    const i = alfabeto.indexOf(c);
    if (i < 0) throw new Error(`base32 inválido: ${c}`);
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      saida.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(saida);
}
const passoAgora = (): number => Math.floor(Date.now() / 1000 / 30);
function totp(segredo: Buffer, passo: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(passo));
  const h = crypto.createHmac('sha1', segredo).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  const n = ((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
}
/** Código que não casa com nenhum passo da janela (±1). */
function codigoErrado(segredo: Buffer): string {
  const p = passoAgora();
  const validos = new Set([-2, -1, 0, 1, 2].map((d) => totp(segredo, p + d)));
  for (let i = 0; ; i++) {
    const c = String(i).padStart(6, '0');
    if (!validos.has(c)) return c;
  }
}

/** JWT HS256 forjado no formato do token de plataforma (para provar que assinatura e sessão são conferidas). */
function jwtForjado(claims: Record<string, unknown>, segredo: string): string {
  const b = (x: unknown) => Buffer.from(JSON.stringify(x)).toString('base64url');
  const cab = b({ alg: 'HS256', typ: 'JWT' });
  const corpo = b(claims);
  return `${cab}.${corpo}.${crypto.createHmac('sha256', segredo).update(`${cab}.${corpo}`).digest('base64url')}`;
}

interface LinhaAuditoria {
  acao: string;
  super_admin_id: string | null;
  sessao_id: string | null;
  tenant_alvo_id: string | null;
  metodo: string | null;
  rota: string | null;
  status: number | null;
  request_id: string | null;
  ip_prefixo: string | null;
  detalhes: Record<string, unknown>;
  bruto: string;
}

describe.skipIf(semBanco())('T-0087 critérios 3 e 4: portal só para o super-admin com 2º fator, tudo auditado, log sem dado pessoal', () => {
  let api: ApiDeTeste;
  const linhasLog: string[] = [];
  /** Tudo o que nunca pode aparecer no log nem na auditoria (cresce ao longo dos casos). */
  const segredos: string[] = [SA.email, SA.nome, SA.senha, CONVITE, 'senha-errada-do-portal-123', 'ninguem.aqui@exemplo.com.br'];
  let segredoTotp: Buffer;
  let token1 = '';
  let saId = '';
  let sid1 = '';
  let recuperacao: string[] = [];
  let novoTenant = '';
  /** request_id de cada requisição feita com o token de plataforma, com o status esperado. */
  const comTokenSA: { requestId: string; status: number; rota: string; tenant: string | null }[] = [];

  const publico = (caminho: string, payload?: unknown, headers?: Record<string, string>): Promise<LightMyRequestResponse> =>
    api.app.inject({ method: 'POST', url: `/v1/plataforma/auth/${caminho}`, remoteAddress: novoIp(), ...(payload !== undefined ? { payload: payload as object } : {}), ...(headers ? { headers } : {}) });

  /** Chamada com o token de plataforma, guardando o request_id para conferir a auditoria. */
  async function comoSA(token: string, op: InjectOptions & { url: string }, esperado: { status: number; rota: string; tenant?: string | null }): Promise<LightMyRequestResponse> {
    const requestId = crypto.randomUUID();
    const r = await api.app.inject({ ...op, remoteAddress: '10.87.0.42', headers: { ...comToken(token), 'x-request-id': requestId, ...((op.headers as Record<string, string>) ?? {}) } });
    expect(r.statusCode, `${op.method} ${op.url}: ${r.body}`).toBe(esperado.status);
    comTokenSA.push({ requestId, status: esperado.status, rota: esperado.rota, tenant: esperado.tenant ?? null });
    return r;
  }

  async function auditoria(): Promise<LinhaAuditoria[]> {
    const r = await api.admin.query<LinhaAuditoria>(
      `select acao, super_admin_id, sessao_id, tenant_alvo_id, metodo, rota, status, request_id, ip_prefixo, detalhes, row_to_json(a)::text as bruto
         from plataforma.auditoria_plataforma a order by ocorrido_em, id`,
    );
    return r.rows;
  }

  /** O `onResponse` grava a auditoria depois de a resposta sair: espera as linhas chegarem (teto 5 s). */
  async function esperarAuditoria(requestIds: string[]): Promise<LinhaAuditoria[]> {
    const limite = Date.now() + 5_000;
    for (;;) {
      const linhas = await auditoria();
      const tem = new Set(linhas.map((l) => l.request_id));
      if (requestIds.every((x) => tem.has(x)) || Date.now() > limite) return linhas;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  beforeAll(async () => {
    api = await subirApi({
      logger: { ...opcoesLogger('trace'), stream: { write: (s: string) => void linhasLog.push(s) } },
      plataforma: { segredo: () => SEGREDO_PLATAFORMA, chaveTotp: () => CHAVE_TOTP, convite: () => CONVITE },
    });
  }, 120_000);
  afterAll(async () => {
    await api?.fechar();
  });

  describe('SA-01..05 entrada: convite, senha, 2º fator e sessão', () => {
    it('SA-01 primeiro acesso com convite errado = 401 CONVITE_INVALIDO e nenhum super-admin criado', async () => {
      const r = await publico('primeiro-acesso', { ...SA, convite: 'convite-errado-com-mais-de-32-caracteres-xx' });
      expect(r.statusCode, r.body).toBe(401);
      expect(erroDe(r).codigo).toBe('CONVITE_INVALIDO');
      const n = await api.admin.query<{ n: number }>('select count(*)::int as n from plataforma.super_admin');
      expect(n.rows[0]!.n).toBe(0);
    });

    it('SA-02 primeiro acesso certo abre só o desafio de cadastrar o TOTP (sem token); o desafio não vale como token; a 2ª vez = 410', async () => {
      const r = await publico('primeiro-acesso', { ...SA, convite: CONVITE });
      expect(r.statusCode, r.body).toBe(200);
      const etapa = EtapaLoginSchema.parse(r.json());
      expect(etapa.etapa).toBe('cadastrar_totp');
      expect(r.json()).not.toHaveProperty('token');
      segredos.push(etapa.desafio);

      const comDesafio = await api.app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: comToken(etapa.desafio) });
      expect(comDesafio.statusCode).toBe(401);

      const outra = await publico('primeiro-acesso', { ...SA, convite: CONVITE });
      expect(outra.statusCode, outra.body).toBe(410);
      expect(erroDe(outra).codigo).toBe('PRIMEIRO_ACESSO_ENCERRADO');

      // login só com a senha, antes do TOTP: de novo só desafio de cadastro, nunca token
      const login = await publico('login', { email: SA.email, senha: SA.senha });
      expect(login.statusCode, login.body).toBe(200);
      const e2 = EtapaLoginSchema.parse(login.json());
      expect(e2.etapa).toBe('cadastrar_totp');
      expect(login.json()).not.toHaveProperty('token');
      segredos.push(e2.desafio);

      // cadastro do TOTP com código errado = 401; com o certo = sessão + 10 códigos de recuperação
      const ini = await publico('totp/iniciar', { desafio: e2.desafio });
      expect(ini.statusCode, ini.body).toBe(200);
      const inicio = TotpInicioSchema.parse(ini.json());
      segredos.push(inicio.segredo_base32, inicio.otpauth_uri);
      segredoTotp = base32Decodificar(inicio.segredo_base32);

      const errado = await publico('totp/confirmar', { desafio: e2.desafio, codigo: codigoErrado(segredoTotp) });
      expect(errado.statusCode, errado.body).toBe(401);
      expect(erroDe(errado).codigo).toBe('CODIGO_INVALIDO');

      const conf = await publico('totp/confirmar', { desafio: e2.desafio, codigo: totp(segredoTotp, passoAgora()) });
      expect(conf.statusCode, conf.body).toBe(200);
      const confirmado = TotpConfirmadoSchema.parse(conf.json());
      token1 = confirmado.sessao.token;
      recuperacao = confirmado.codigos_recuperacao;
      segredos.push(token1, ...recuperacao, ...recuperacao.map((c) => c.replace('-', '')));
      const sa = await api.admin.query<{ id: string }>('select id from plataforma.super_admin');
      saId = sa.rows[0]!.id;
      const s = await api.admin.query<{ id: string }>('select id from plataforma.super_admin_sessao where super_admin_id = $1 and revogada_em is null', [saId]);
      expect(s.rows).toHaveLength(1);
      sid1 = s.rows[0]!.id;
    });

    it('SA-03 com o 2º fator: GET /v1/plataforma/empresas = 200 com os tenants', async () => {
      const r = await comoSA(token1, { method: 'GET', url: '/v1/plataforma/empresas' }, { status: 200, rota: '/v1/plataforma/empresas' });
      const lista = ListaEmpresasSchema.parse(r.json());
      expect(lista.itens.map((e) => e.id)).toEqual(expect.arrayContaining([A.tenantId, B.tenantId]));
    });

    it('SA-04 token forjado: assinado com o segredo do tenant, ou com sessão inexistente, ou sem "otp" no amr = 401', async () => {
      const agora = Math.floor(Date.now() / 1000);
      const base = { sub: saId, sid: sid1, aud: 'macuxi-plataforma', amr: ['pwd', 'otp'], iat: agora, exp: agora + 600 };
      const forjados = [
        jwtForjado(base, SEGREDO_JWT),
        jwtForjado({ ...base, sid: crypto.randomUUID() }, SEGREDO_PLATAFORMA),
        jwtForjado({ ...base, sub: crypto.randomUUID() }, SEGREDO_PLATAFORMA),
        jwtForjado({ ...base, amr: ['pwd'] }, SEGREDO_PLATAFORMA),
        jwtForjado({ ...base, aud: undefined }, SEGREDO_PLATAFORMA),
        jwtForjado({ ...base, exp: agora - 1 }, SEGREDO_PLATAFORMA),
      ];
      // controle: o mesmo formato com o segredo certo e a sessão viva passa (o forjamento é que reprova)
      const controle = await api.app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: comToken(jwtForjado(base, SEGREDO_PLATAFORMA)) });
      expect(controle.statusCode, controle.body).toBe(200);
      for (const [i, t] of forjados.entries()) {
        const r = await api.app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: comToken(t) });
        expect(r.statusCode, `forjado ${i}: ${r.body}`).toBe(401);
        const p = await api.app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comToken(t), payload: { ...EMPRESA, modulos: [{ modulo: 'integracao' }] } });
        expect(p.statusCode, `forjado ${i} POST: ${p.body}`).toBe(401);
      }
      const semToken = await api.app.inject({ method: 'GET', url: '/v1/plataforma/empresas' });
      expect(semToken.statusCode).toBe(401);
    });

    it('SA-05 sessão encerrada (sair) = 401 com o mesmo token; renovar também recusa', async () => {
      // segunda sessão pelo login completo com código de recuperação, para encerrar sem perder a primeira
      const login = await publico('login', { email: SA.email, senha: SA.senha });
      const etapa = EtapaLoginSchema.parse(login.json());
      expect(etapa.etapa).toBe('segundo_fator');
      segredos.push(etapa.desafio);
      const r = await publico('segundo-fator', { desafio: etapa.desafio, codigo_recuperacao: recuperacao[0] });
      expect(r.statusCode, r.body).toBe(200);
      const s2 = SessaoPlataformaSchema.parse(r.json());
      expect(s2.recuperacao_restantes).toBe(9);
      segredos.push(s2.token);
      await comoSA(s2.token, { method: 'GET', url: '/v1/plataforma/empresas' }, { status: 200, rota: '/v1/plataforma/empresas' });

      const sair = await publico('sair', undefined, comToken(s2.token));
      expect(sair.statusCode, sair.body).toBe(204);
      const depois = await api.app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: comToken(s2.token) });
      expect(depois.statusCode).toBe(401);
      const renovar = await publico('renovar', undefined, comToken(s2.token));
      expect(renovar.statusCode).toBe(401);
      expect(erroDe(renovar).codigo).toBe('SESSAO_PLATAFORMA_INVALIDA');
      // a outra sessão segue viva
      await comoSA(token1, { method: 'GET', url: '/v1/plataforma/empresas' }, { status: 200, rota: '/v1/plataforma/empresas' });
    });
  });

  describe('SA-06..08 fronteira entre token de tenant e token de plataforma', () => {
    it('SA-06 token de tenant (admin de A) recusado em /v1/plataforma/* e nas rotas de sessão do portal', async () => {
      const s = await api.sessao('admin@exemplo.com.br', A);
      segredos.push(s.access_token, s.refresh_token);
      const get = await api.chamar(s.access_token, { method: 'GET', url: '/v1/plataforma/empresas' });
      expect(get.statusCode, get.body).toBe(401);
      const post = await api.chamar(s.access_token, { method: 'POST', url: '/v1/plataforma/empresas', payload: { ...EMPRESA, modulos: [{ modulo: 'integracao' }] } });
      expect(post.statusCode, post.body).toBe(401);
      for (const c of ['renovar', 'sair']) {
        const r = await publico(c, undefined, comToken(s.access_token));
        expect(r.statusCode, `${c}: ${r.body}`).toBe(401);
      }
      const regerar = await publico('recuperacao/regerar', { codigo: '123456' }, comToken(s.access_token));
      expect(regerar.statusCode, regerar.body).toBe(401);
      // nenhuma empresa nova por esse caminho
      const n = await api.admin.query<{ n: number }>('select count(*)::int as n from plataforma.tenant where codigo = $1', [EMPRESA.codigo]);
      expect(n.rows[0]!.n).toBe(0);
    });

    it.each([
      ['GET', '/v1/me/modulos'],
      ['GET', '/v1/core/usuarios'],
      ['GET', '/v1/core/clientes'],
      ['GET', '/v1/sync/novidades'],
      ['GET', '/v1/vendedor/pedidos'],
    ] as const)('SA-07 token de plataforma recusado em rota de tenant sem `superAdmin`: %s %s = 401', async (metodo, url) => {
      const r = await api.app.inject({ method: metodo, url, headers: { ...comToken(token1), [CABECALHO_TENANT_PLATAFORMA]: A.tenantId } });
      expect(r.statusCode, r.body).toBe(401);
    });

    it('SA-08a POST /v1/plataforma/empresas: simular não cria; criar = 201; repetir = 200 sem_mudanca (idempotente)', async () => {
      const corpo = { ...EMPRESA, modulos: [{ modulo: 'integracao', licencas: null }] };
      const sim = await comoSA(token1, { method: 'POST', url: '/v1/plataforma/empresas', payload: { ...corpo, simular: true } }, { status: 200, rota: '/v1/plataforma/empresas' });
      expect(CriarEmpresaRespostaSchema.parse(sim.json()).simulado).toBe(true);
      const n0 = await api.admin.query<{ n: number }>('select count(*)::int as n from plataforma.tenant where codigo = $1', [EMPRESA.codigo]);
      expect(n0.rows[0]!.n).toBe(0);

      const r = await api.app.inject({ method: 'POST', url: '/v1/plataforma/empresas', remoteAddress: '10.87.0.42', headers: { ...comToken(token1), 'x-request-id': crypto.randomUUID() }, payload: corpo });
      expect(r.statusCode, r.body).toBe(201);
      const criada = CriarEmpresaRespostaSchema.parse(r.json());
      expect(criada.resultado).toBe('criado');
      novoTenant = criada.tenant_id!;
      comTokenSA.push({ requestId: r.headers['x-request-id'] as string, status: 201, rota: '/v1/plataforma/empresas', tenant: novoTenant });

      const de_novo = await comoSA(token1, { method: 'POST', url: '/v1/plataforma/empresas', payload: corpo }, { status: 200, rota: '/v1/plataforma/empresas', tenant: novoTenant });
      expect(CriarEmpresaRespostaSchema.parse(de_novo.json()).resultado).toBe('sem_mudanca');
      // o portal nunca cria admin no tenant (o admin do cliente vem pela Equipe, com convite)
      const u = await api.admin.query<{ n: number }>('select count(*)::int as n from core.usuario where tenant_id = $1', [novoTenant]);
      expect(u.rows[0]!.n).toBe(0);
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

  describe('SA-09 2º fator: sem reuso e sem dica do que está errado', () => {
    it('e-mail inexistente e senha errada: mesma resposta (401 CREDENCIAIS_INVALIDAS, mesma mensagem)', async () => {
      const a = await publico('login', { email: 'ninguem.aqui@exemplo.com.br', senha: 'senha-errada-do-portal-123' });
      const b = await publico('login', { email: SA.email, senha: 'senha-errada-do-portal-123' });
      expect([a.statusCode, b.statusCode]).toEqual([401, 401]);
      expect(erroDe(a)).toEqual(erroDe(b));
      expect(erroDe(a).codigo).toBe('CREDENCIAIS_INVALIDAS');
    });

    it('TOTP: o próximo passo vale uma vez; o mesmo código em outro login = 401; código de recuperação já usado = 401', async () => {
      const codigo = totp(segredoTotp, passoAgora() + 1);
      const l1 = EtapaLoginSchema.parse((await publico('login', { email: SA.email, senha: SA.senha })).json());
      segredos.push(l1.desafio);
      const ok = await publico('segundo-fator', { desafio: l1.desafio, codigo });
      expect(ok.statusCode, ok.body).toBe(200);
      const s = SessaoPlataformaSchema.parse(ok.json());
      segredos.push(s.token);

      const l2 = EtapaLoginSchema.parse((await publico('login', { email: SA.email, senha: SA.senha })).json());
      segredos.push(l2.desafio);
      const reuso = await publico('segundo-fator', { desafio: l2.desafio, codigo });
      expect(reuso.statusCode, reuso.body).toBe(401);
      expect(erroDe(reuso).codigo).toBe('CODIGO_INVALIDO');

      const l3 = EtapaLoginSchema.parse((await publico('login', { email: SA.email, senha: SA.senha })).json());
      segredos.push(l3.desafio);
      const usado = await publico('segundo-fator', { desafio: l3.desafio, codigo_recuperacao: recuperacao[0] });
      expect(usado.statusCode, usado.body).toBe(401);

      // o desafio já consumido pela sessão aberta não abre outra
      const consumido = await publico('segundo-fator', { desafio: l1.desafio, codigo_recuperacao: recuperacao[1] });
      expect(consumido.statusCode, consumido.body).toBe(401);
      expect(erroDe(consumido).codigo).toBe('DESAFIO_INVALIDO');
    });
  });

  describe('SA-10..11 auditoria e LGPD (critério 4)', () => {
    it('SA-10 toda requisição com o token de plataforma tem 1 linha sa.requisicao (inclusive 400/403/404), com rota-modelo e IP só no prefixo', async () => {
      const linhas = await esperarAuditoria(comTokenSA.map((x) => x.requestId));
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
        if (l.super_admin_id !== saId) faltas.push(`${e.rota}: super_admin_id ${l.super_admin_id}`);
        if (!l.sessao_id) faltas.push(`${e.rota}: sem sessao_id`);
        if (e.tenant && l.tenant_alvo_id !== e.tenant) faltas.push(`${e.rota} ${e.status}: tenant_alvo_id ${l.tenant_alvo_id} ≠ ${e.tenant}`);
        if (l.ip_prefixo !== '10.87.0.0/24') faltas.push(`${e.rota}: ip_prefixo ${l.ip_prefixo}`);
      }
      expect(faltas).toEqual([]);
      // nenhuma linha guarda IP inteiro nem rota com query
      for (const l of linhas) {
        if (l.ip_prefixo !== null) expect(l.ip_prefixo).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.0\/24$|::\/48$/);
        if (l.rota !== null) expect(l.rota).not.toContain('?');
      }
    });

    it('SA-10b os fatos de login, 2º fator, sessão e provisionamento ficam na auditoria; as falhas também', async () => {
      const acoes = new Set((await auditoria()).map((l) => l.acao));
      for (const a of [
        'sa.primeiro_acesso',
        'sa.totp.cadastrar',
        'sa.totp.confirmado',
        'sa.login.ok',
        'sa.login.falha',
        'sa.sessao.aberta',
        'sa.sessao.revogada',
        'sa.sair',
        'sa.recuperacao.usar',
        'sa.recuperacao.usada',
        'sa.tenant.provisionar',
        'sa.requisicao',
      ])
        expect(acoes, a).toContain(a);
    });

    it('SA-10d (T-0091) com dois pools, cada sessão aberta tem a sua linha sa.sessao.aberta, e o macuxi_portal não lê nem altera a auditoria', async () => {
      expect(api.poolPortal, 'o apoio subiu sem o pool do portal').not.toBeNull();
      const sessoes = await api.admin.query<{ id: string }>('select id::text as id from plataforma.super_admin_sessao order by 1');
      const abertas = await api.admin.query<{ id: string }>("select sessao_id::text as id from plataforma.auditoria_plataforma where acao = 'sa.sessao.aberta' order by 1");
      expect(sessoes.rows.length).toBeGreaterThanOrEqual(3);
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

    it('SA-11 nem a auditoria nem o log (trace) têm e-mail, nome, senha, convite, segredo TOTP, código de recuperação, desafio ou token', async () => {
      const auditoriaTexto = (await auditoria()).map((l) => l.bruto).join('\n');
      const logTexto = linhasLog.join('');
      expect(linhasLog.length).toBeGreaterThan(10);
      const vazados = (texto: string) => segredos.filter((x) => x && texto.includes(x)).map((x) => `${x.slice(0, 8)}…`);
      expect(vazados(auditoriaTexto), 'na auditoria').toEqual([]);
      expect(vazados(logTexto), 'no log').toEqual([]);
      expect(auditoriaTexto.toLowerCase()).not.toContain(SA.email.split('@')[0]!);
      expect(logTexto).not.toMatch(/authorization|bearer|"body"|"payload"|"headers"/i);
    });
  });
});
