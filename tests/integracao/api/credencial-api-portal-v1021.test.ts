/**
 * v1.0.21 (portal `config.` enxuto) — credencial de API do portal = `integracao.conector` com `tipo = 'nuvem'`, ponta a ponta na
 * API REAL (`createApp` com os 8 módulos de `MODULOS_API`, JWT do Core, portal com o pool do `macuxi_portal`, banco efêmero
 * dois-tenants pelo `macuxi_app` com RLS). Desenho: docs/desenho/config-credencial-api.md (engenheiro-software).
 *
 * Cobre o que o teste do dono (`modules/integracao/api/bko-conectores-nuvem.db.test.ts`, que chama o `executar` direto) não cobre:
 *  C1 o admin da conta do cliente, logado no PORTAL (e-mail e senha, empresa escolhida), cria, lista (`?tipo=nuvem`) e revoga
 *     (`PATCH {ativo:false}`) a credencial; depois da revogação a chave não autentica mais no Hub (`/integracao/v1/cursores/...`);
 *  C2 perfil sem `conector.gerenciar` (vendedor e gerente, com a Integração licenciada no perfil, para a licença não mascarar o
 *     perfil): 403 `PERFIL_SEM_ACESSO` no POST e no PATCH, e nada é gravado;
 *  C3 Integração desligada no tenant: 403 `MODULO_INATIVO` no GET, POST e PATCH do mesmo admin do portal;
 *  C4 tenant B não vê nem revoga a credencial de A (404 e a credencial segue ativa), nem pela listagem nem pelo cabeçalho
 *     de tenant trocado no portal;
 *  C5 a chave em claro só aparece na resposta do POST; a listagem (com e sem filtro) nunca traz a chave nem o hash;
 *  C6 `GET /integracao/v1/guia.pdf` sem login: 200, `application/pdf`, `attachment`, Cache-Control público, ETag e 304.
 * Massa: a fixture traz um Conector ativo em A (16 entidades) e em B (cliente e produto); para a credencial nova não esbarrar
 * na RN-INT-13, o Conector da fixture de A é desativado neste banco efêmero (é só deste arquivo) e B usa `preco`.
 * Enquanto os PRs v1.0.21 do engenheiro-software e do modulo-integracao não entram no `main`, os casos pulam (a rota do guia
 * e o filtro `tipo` não existem lá); o gate lê o próprio código montado, então liga sozinho depois do merge.
 */
import { randomUUID } from 'node:crypto';
import * as contratosIntegracao from '@macuxi/integracao/contracts';
import { ConectorCriado, ConectorResumo } from '@macuxi/integracao/contracts';
import { estadoBanco, semBanco } from '@macuxi/db/teste/estado';
import { PEPPER_HUB_FIXTURE } from '@macuxi/db/teste';
import { CABECALHO_TENANT_PLATAFORMA } from '@macuxi/platform-sdk';
import type { ModuloId } from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../../apps/api/src/app';
import { MODULOS_API } from '../../../apps/api/src/modulos';
import { A, B, comToken, erroDe, licenca, novoIp, subirApi, type ApiDeTeste, type Tenant } from '../apoio/api';
import { criarUsuarioNoTenant, escolherEmpresa, sessaoDoPortal } from '../apoio/portal';

const ESTADO = estadoBanco();
const SEM_PORTAL = ESTADO.disponivel && !ESTADO.urlPortal ? 'sem MACUXI_PG_PORTAL_SENHA neste ambiente' : null;
/** O código v1.0.21 está montado? (rota pública do guia + filtro `tipo` nos contratos) */
const TEM_V1021 =
  !!MODULOS_API.find((m) => m.manifesto.id === 'integracao')?.rotasPublicas?.some((r) => r.caminho === 'guia.pdf') && 'ConectoresQuery' in contratosIntegracao;

const SEGREDO_PLATAFORMA = 'segredo-de-plataforma-do-agente-testes-v1021-com-folga';
const P = `api${randomUUID().slice(0, 6)}`;
const PORTAL_A = { email: 'admin.portal.v1021.a@exemplo.com.br', senha: 'PortalA#V1021-ok', nome: 'Admin Portal Alfa Fictício' };
const PORTAL_B = { email: 'admin.portal.v1021.b@exemplo.com.br', senha: 'PortalB#V1021-ok', nome: 'Admin Portal Beta Fictício' };
const URL = '/v1/integracao/conectores';
const Lista = z.object({ itens: z.array(ConectorResumo) });

describe.skipIf(semBanco() || !!SEM_PORTAL || !TEM_V1021)('v1.0.21 — credencial de API (tipo nuvem) pelo portal, na API montada', () => {
  let api: ApiDeTeste;
  const pepperAntes = process.env.MACUXI_HUB_CHAVE_PEPPER;
  const tk = { portalA: '', portalB: '', adminA: '', adminB: '', vendedorA: '', gerenteA: '' };
  let credA: ConectorCriado;
  let credB: ConectorCriado;

  /** Chamada do portal: token do portal + cabeçalho da empresa (o mesmo da sessão, salvo quando o teste troca). */
  const portal = (token: string, tenant: Tenant, op: { method: 'GET' | 'POST' | 'PATCH'; url: string; payload?: object }) =>
    api.app.inject({ ...op, headers: { ...comToken(token), [CABECALHO_TENANT_PLATAFORMA]: tenant.tenantId }, remoteAddress: novoIp() });
  const tokenPortal = async (u: { email: string; senha: string }, t: Tenant) => {
    const s = await sessaoDoPortal(api, u.email, u.senha);
    if (s.empresa?.id === t.tenantId) return s.token;
    const esc = await escolherEmpresa(api, s.token, t.tenantId);
    expect(esc.statusCode, esc.body).toBe(200);
    return (esc.json() as { token: string }).token;
  };
  const listar = async (token: string, t: Tenant, tipo?: 'nuvem' | 'conector') => {
    const r = await portal(token, t, { method: 'GET', url: tipo ? `${URL}?tipo=${tipo}` : URL });
    expect(r.statusCode, r.body).toBe(200);
    return { corpo: r.body, itens: Lista.parse(r.json()).itens };
  };
  const nuvem = (sufixo: string, entidades: string[]) => ({ conector_id: `${P}-${sufixo}`, nome: `Credencial ${sufixo}`, tipo: 'nuvem', recebe_pedidos: false, entidades });
  const hashDe = async (conectorId: string) =>
    (await api.admin.query<{ hash_chave: string }>('select hash_chave from integracao.credencial where conector_id = $1', [conectorId])).rows.map((r) => r.hash_chave);
  const ativoNoBanco = async (id: string) => (await api.admin.query<{ ativo: boolean }>('select ativo from integracao.conector where id = $1', [id])).rows[0]?.ativo;
  /** O Hub com a chave da credencial (cursor de uma entidade dela): prova que a chave vale (ou não) de verdade. */
  const hub = (c: ConectorCriado, entidade: string) =>
    api.app.inject({
      method: 'GET',
      url: `/integracao/v1/cursores/${entidade}`,
      headers: { authorization: `Bearer ${c.chave.chave}`, 'x-macuxi-conector-id': c.chave.conector_id },
      remoteAddress: novoIp(),
    });

  beforeAll(async () => {
    process.env.MACUXI_HUB_CHAVE_PEPPER = PEPPER_HUB_FIXTURE;
    api = await subirApi({ plataforma: { segredo: () => SEGREDO_PLATAFORMA } });
    await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, ...PORTAL_A });
    await criarUsuarioNoTenant(api.admin, { tenantId: B.tenantId, ...PORTAL_B });
    tk.adminA = (await api.sessao('admin@exemplo.com.br', A)).access_token;
    tk.adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
    tk.vendedorA = (await api.sessao('vendedor@exemplo.com.br', A)).access_token;
    tk.gerenteA = (await api.sessao('gerente@exemplo.com.br', A)).access_token;
    // RN-CORE-02: a Integração no tenant e no perfil; vendedor e gerente também, para o 403 ser de PERFIL (C2), não de licença
    for (const [t, token, perfis] of [
      [A, tk.adminA, ['admin', 'vendedor', 'gerente']],
      [B, tk.adminB, ['admin']],
    ] as const) {
      const r = await licenca(api, token, 'tenant', 'integracao', true);
      expect(r.statusCode, `licença integracao em ${t.codigo}: ${r.body}`).toBe(200);
      for (const perfil of perfis) {
        const rp = await licenca(api, token, 'perfil', 'integracao', true, perfil);
        expect(rp.statusCode, `licença integracao do perfil ${perfil} em ${t.codigo}: ${rp.body}`).toBe(200);
      }
    }
    // RN-INT-13: o Conector da fixture de A recebe todas as entidades; sai do caminho só neste banco efêmero
    await api.admin.query('update integracao.conector set ativo = false where tenant_id = $1 and tipo = $2', [A.tenantId, 'conector']);
    tk.portalA = await tokenPortal(PORTAL_A, A);
    tk.portalB = await tokenPortal(PORTAL_B, B);
  }, 240_000);
  afterAll(async () => {
    await api?.fechar();
    if (pepperAntes === undefined) delete process.env.MACUXI_HUB_CHAVE_PEPPER;
    else process.env.MACUXI_HUB_CHAVE_PEPPER = pepperAntes;
  });

  it('C1/C5: o admin do portal cria a credencial nuvem (201/200) e a chave em claro vem SÓ nesta resposta', async () => {
    const r = await portal(tk.portalA, A, { method: 'POST', url: URL, payload: nuvem('a', ['cliente']) });
    expect([200, 201], r.body).toContain(r.statusCode);
    credA = ConectorCriado.parse(r.json());
    expect(credA.conector.tipo).toBe('nuvem');
    expect(credA.conector.ativo).toBe(true);
    expect(credA.chave.chave.startsWith('mxc_')).toBe(true);
    expect(credA.chave.chave.startsWith(credA.chave.prefixo)).toBe(true);
    const rb = await portal(tk.portalB, B, { method: 'POST', url: URL, payload: nuvem('b', ['preco']) });
    expect([200, 201], rb.body).toContain(rb.statusCode);
    credB = ConectorCriado.parse(rb.json());
    // a chave nova autentica no Hub de verdade (cursor de uma entidade dela)
    const h = await hub(credA, 'cliente');
    expect(h.statusCode, h.body).toBe(200);
  });

  it('C1: ?tipo=nuvem lista só a credencial de API; ?tipo=conector só o Conector instalado; sem filtro, os dois', async () => {
    const nuv = (await listar(tk.portalA, A, 'nuvem')).itens;
    expect(nuv.every((c) => c.tipo === 'nuvem')).toBe(true);
    expect(nuv.map((c) => c.id)).toContain(credA.conector.id);
    const con = (await listar(tk.portalA, A, 'conector')).itens;
    expect(con.every((c) => c.tipo === 'conector')).toBe(true);
    expect(con.map((c) => c.id)).not.toContain(credA.conector.id);
    expect(con.map((c) => c.id)).toContain(A.integracao.conector);
    const todos = (await listar(tk.portalA, A)).itens.map((c) => c.id);
    expect(todos).toEqual(expect.arrayContaining([credA.conector.id, A.integracao.conector]));
    const ruim = await portal(tk.portalA, A, { method: 'GET', url: `${URL}?tipo=qualquer` });
    expect(ruim.statusCode, ruim.body).toBe(400);
  });

  it('C5: a listagem (com e sem filtro, portal e BKO) nunca traz a chave em claro nem o hash; só o prefixo', async () => {
    const hashes = await hashDe(credA.conector.id);
    expect(hashes.length).toBeGreaterThan(0);
    const corpos = [(await listar(tk.portalA, A, 'nuvem')).corpo, (await listar(tk.portalA, A)).corpo];
    const bko = await api.chamar(tk.adminA, { method: 'GET', url: `${URL}?tipo=nuvem` });
    expect(bko.statusCode, bko.body).toBe(200);
    corpos.push(bko.body);
    for (const corpo of corpos) {
      expect(corpo).not.toContain(credA.chave.chave);
      expect(corpo).not.toContain('hash_chave');
      for (const h of hashes) expect(corpo).not.toContain(h);
      expect(corpo).toContain(credA.chave.prefixo);
    }
    const item = (await listar(tk.portalA, A, 'nuvem')).itens.find((c) => c.id === credA.conector.id);
    expect(item?.chave?.prefixo).toBe(credA.chave.prefixo);
    expect(Object.keys(item?.chave ?? {})).not.toContain('chave');
  });

  it('C2: vendedor e gerente (Integração licenciada, sem conector.gerenciar): 403 PERFIL_SEM_ACESSO no POST e no PATCH, nada gravado', async () => {
    for (const [quem, token] of [
      ['vendedor', tk.vendedorA],
      ['gerente', tk.gerenteA],
    ] as const) {
      const post = await api.chamar(token, { method: 'POST', url: URL, payload: nuvem(`neg-${quem}`, ['produto']) });
      expect(post.statusCode, `${quem} POST: ${post.body}`).toBe(403);
      expect(erroDe(post).codigo, quem).toBe('PERFIL_SEM_ACESSO');
      const patch = await api.chamar(token, { method: 'PATCH', url: `${URL}/${credA.conector.id}`, payload: { ativo: false } });
      expect(patch.statusCode, `${quem} PATCH: ${patch.body}`).toBe(403);
      expect(erroDe(patch).codigo, quem).toBe('PERFIL_SEM_ACESSO');
    }
    const { rows } = await api.admin.query('select 1 from integracao.conector where identificador like $1', [`${P}-neg-%`]);
    expect(rows).toHaveLength(0);
    expect(await ativoNoBanco(credA.conector.id)).toBe(true);
  });

  it('C4: B nunca vê a credencial de A (listagem) nem a revoga (PATCH = 404, segue ativa); vale também para A × B', async () => {
    const deB = (await listar(tk.portalB, B, 'nuvem')).itens.map((c) => c.id);
    expect(deB).toContain(credB.conector.id);
    expect(deB).not.toContain(credA.conector.id);
    const deA = (await listar(tk.portalA, A)).itens.map((c) => c.id);
    expect(deA).not.toContain(credB.conector.id);
    const r = await portal(tk.portalB, B, { method: 'PATCH', url: `${URL}/${credA.conector.id}`, payload: { ativo: false } });
    expect(r.statusCode, r.body).toBe(404);
    expect(erroDe(r).codigo).toBe('CONECTOR_NAO_ENCONTRADO');
    const bko = await api.chamar(tk.adminB, { method: 'PATCH', url: `${URL}/${credA.conector.id}`, payload: { ativo: false } });
    expect(bko.statusCode, bko.body).toBe(404);
    // o admin do portal de B pondo o cabeçalho da empresa A: a sessão é de B, a plataforma recusa (nunca 200)
    const troca = await portal(tk.portalB, A, { method: 'GET', url: `${URL}?tipo=nuvem` });
    expect(troca.statusCode, troca.body).not.toBe(200);
    expect(troca.body).not.toContain(credA.conector.id);
    expect(await ativoNoBanco(credA.conector.id)).toBe(true);
  });

  it('C1: o admin do portal revoga (PATCH {ativo:false}): inativa, sem chave, a listagem mostra desativado e o Hub recusa a chave (401)', async () => {
    const r = await portal(tk.portalA, A, { method: 'PATCH', url: `${URL}/${credA.conector.id}`, payload: { ativo: false } });
    expect(r.statusCode, r.body).toBe(200);
    const resumo = ConectorResumo.parse(r.json());
    expect(resumo).toMatchObject({ ativo: false, saude: 'desativado', chave: null });
    expect(r.body).not.toContain(credA.chave.chave);
    const item = (await listar(tk.portalA, A, 'nuvem')).itens.find((c) => c.id === credA.conector.id);
    expect(item).toMatchObject({ ativo: false, saude: 'desativado', chave: null });
    const { rows } = await api.admin.query<{ revogada_em: Date | null }>('select revogada_em from integracao.credencial where conector_id = $1', [credA.conector.id]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((x) => x.revogada_em !== null)).toBe(true);
    const h = await hub(credA, 'cliente');
    expect(h.statusCode, h.body).toBe(401);
    // a credencial de B segue valendo
    expect(await ativoNoBanco(credB.conector.id)).toBe(true);
  });

  it('C3: Integração desligada no tenant A = 403 MODULO_INATIVO no GET, POST e PATCH do admin do portal; B segue; religada, volta', async () => {
    const off = await licenca(api, tk.adminA, 'tenant', 'integracao', false);
    expect(off.statusCode, off.body).toBe(200);
    try {
      const chamadas = [
        await portal(tk.portalA, A, { method: 'GET', url: `${URL}?tipo=nuvem` }),
        await portal(tk.portalA, A, { method: 'POST', url: URL, payload: nuvem('off', ['produto']) }),
        await portal(tk.portalA, A, { method: 'PATCH', url: `${URL}/${credA.conector.id}`, payload: { ativo: true } }),
      ];
      for (const r of chamadas) {
        expect(r.statusCode, r.body).toBe(403);
        expect(erroDe(r).codigo).toBe('MODULO_INATIVO');
      }
      const { rows } = await api.admin.query('select 1 from integracao.conector where identificador = $1', [`${P}-off`]);
      expect(rows).toHaveLength(0);
      expect(await ativoNoBanco(credA.conector.id)).toBe(false);
      expect((await listar(tk.portalB, B, 'nuvem')).itens.map((c) => c.id)).toContain(credB.conector.id);
    } finally {
      const on = await licenca(api, tk.adminA, 'tenant', 'integracao', true);
      expect(on.statusCode, on.body).toBe(200);
    }
    expect((await listar(tk.portalA, A, 'nuvem')).itens.map((c) => c.id)).toContain(credA.conector.id);
  });
});

describe.skipIf(!TEM_V1021)('v1.0.21 C6 — GET /integracao/v1/guia.pdf público, na API montada (sem banco)', () => {
  const URL_GUIA = '/integracao/v1/guia.pdf';
  const subir = () =>
    createApp({
      modulos: MODULOS_API,
      banco: null,
      bancoPortal: null,
      logger: false,
      autenticar: async () => null,
      licencas: async () => ({ ativosNoTenant: ['core'] as ModuloId[], doPerfil: ['core'] as ModuloId[], removidosDoUsuario: [], parametros: {} }),
    });

  it('sem login, sem licença e sem banco: 200 application/pdf, attachment com nome, nosniff, Cache-Control público e ETag; o corpo é um PDF', async () => {
    const app = subir();
    const r = await app.inject({ method: 'GET', url: URL_GUIA, remoteAddress: novoIp() });
    expect(r.statusCode, r.body.slice(0, 200)).toBe(200);
    expect(r.headers['content-type']).toMatch(/^application\/pdf/);
    expect(String(r.headers['content-disposition'])).toMatch(/^attachment; filename="[^"]+\.pdf"$/);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(String(r.headers['cache-control'])).toMatch(/^public, max-age=\d+$/);
    expect(Number(/max-age=(\d+)/.exec(String(r.headers['cache-control']))![1])).toBeGreaterThan(0);
    expect(r.headers.etag).toBeTruthy();
    const bytes = r.rawPayload;
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(bytes.subarray(-1024).toString('latin1')).toContain('%%EOF');
    expect(Number(r.headers['content-length'] ?? bytes.length)).toBe(bytes.length);
    await app.close();
  });

  it('If-None-Match com o ETag = 304 sem corpo; token inválido não muda nada (não autentica)', async () => {
    const app = subir();
    const ip = novoIp();
    const r1 = await app.inject({ method: 'GET', url: URL_GUIA, remoteAddress: ip });
    const r2 = await app.inject({ method: 'GET', url: URL_GUIA, headers: { 'if-none-match': String(r1.headers.etag) }, remoteAddress: ip });
    expect(r2.statusCode).toBe(304);
    expect(r2.rawPayload.length).toBe(0);
    const r3 = await app.inject({ method: 'GET', url: URL_GUIA, headers: { authorization: 'Bearer invalido' }, remoteAddress: ip });
    expect(r3.statusCode).toBe(200);
    expect(r3.headers.etag).toBe(r1.headers.etag);
    expect(Buffer.compare(r3.rawPayload, r1.rawPayload)).toBe(0);
    await app.close();
  });
});
