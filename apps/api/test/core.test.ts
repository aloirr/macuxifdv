/**
 * Core × createApp × Postgres, de ponta a ponta (T-0003 Fase 2; critérios 2 e 3): login real (código da empresa +
 * e-mail + senha, JWT do Core) → GET /v1/me/modulos → o admin desliga o Vendedor do usuário pela rota de licenças →
 * a próxima chamada já recebe 403 MODULO_INATIVO (licença por requisição, RN-CORE-01/02) → promotor sem nenhuma rota
 * de pedido (RN-PRO-01). Fixture dois-tenants (senha `MACUXI_SENHA_TESTE` ou a padrão da fixture); pula sem Postgres
 * (aviso no fim) e falha com MACUXI_PG_EXIGIR=1 (CI).
 *
 * Isolamento entre arquivos (o banco efêmero é um só): a licença alterada é a EXCEÇÃO de um usuário (vendedor2 de A),
 * que os outros testes não usam, e volta ao estado da fixture no fim.
 */
import { MeusModulosRespostaSchema, RefreshRespostaSchema, SessaoRespostaSchema } from '@macuxi/core/contracts';
import { criarModuloApiCore } from '@macuxi/core/api';
import { DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { definirModuloApi, ErroApiSchema, ErroNaoEncontrado, promotorBarradoNaRota, type ModuloApi, type RotaModulo } from '@macuxi/platform-sdk';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app';
import { criarBancoApp } from '../src/banco';
import { licencasDoBanco } from '../src/licencas';
import { MODULOS_API } from '../src/modulos';

const A = DOIS_TENANTS.A;
const SENHA = process.env.MACUXI_SENHA_TESTE ?? 'Teste@1234';
const SEGREDO = 'segredo-de-teste-do-jwt-com-32-caracteres-ou-mais';
const UM_UUID = '0e000000-0000-4000-8000-000000000001';

const coreApi = criarModuloApiCore({ segredo: () => SEGREDO });
const modulos: ModuloApi[] = MODULOS_API.map((m) => (m.manifesto.id === 'core' ? coreApi : m));

describe.skipIf(semBanco())('Core ponta a ponta: login → /v1/me/modulos → licença → 403 (Postgres)', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof createApp>;

  // limite de 5 logins / 5 min por IP + código da empresa: cada login do teste vem de um IP próprio
  let ip = 0;
  const entrar = async (email: string, senha = SENHA) =>
    app.inject({ method: 'POST', url: '/v1/auth/login', remoteAddress: `10.0.0.${++ip}`, payload: { codigo_empresa: A.codigo, email, senha } });
  const tokenDe = async (email: string) => {
    const r = await entrar(email);
    expect(r.statusCode, r.body).toBe(200);
    return SessaoRespostaSchema.parse(r.json());
  };
  const comToken = (token: string) => ({ authorization: `Bearer ${token}` });
  const meusModulos = async (token: string) => {
    const r = await app.inject({ method: 'GET', url: '/v1/me/modulos', headers: comToken(token) });
    expect(r.statusCode, r.body).toBe(200);
    return MeusModulosRespostaSchema.parse(r.json());
  };
  const licencaDoUsuario = (tokenAdmin: string, usuarioId: string, modulo: string, ativo: boolean) =>
    app.inject({ method: 'PUT', url: `/v1/core/licencas/usuarios/${usuarioId}/${modulo}`, headers: comToken(tokenAdmin), payload: { ativo } });

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    app = createApp({ banco: criarBancoApp(pool), modulos });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it('RF-CORE-01: credenciais erradas → CREDENCIAIS_INVALIDAS sem revelar nada do tenant', async () => {
    const r = await entrar('assistente@exemplo.com.br', 'senha-errada');
    // 401 com o ErroHttpModulo do SDK (modules/core/api/erros.ts)
    expect(r.statusCode).toBe(401);
    const corpo = ErroApiSchema.parse(r.json());
    expect(corpo.codigo).toBe('CREDENCIAIS_INVALIDAS');
    expect(r.body).not.toContain('Distribuidora Alfa');
  });

  it('login → /v1/me/modulos → admin desliga o Vendedor → 403 MODULO_INATIVO na próxima chamada → religa', async () => {
    const vendedor = await tokenDe('vendedor2@exemplo.com.br');
    expect(vendedor.usuario.perfil).toBe('vendedor');
    expect(vendedor.tenant).toMatchObject({ id: A.tenantId, codigo: A.codigo, fuso: A.fuso });

    const antes = await meusModulos(vendedor.access_token);
    expect(antes.modulos.map((m) => m.id)).toEqual(['core', 'catalogo', 'vendedor']);

    const admin = await tokenDe('admin@exemplo.com.br');
    const desliga = await licencaDoUsuario(admin.access_token, A.usuarios.vendedor2, 'vendedor', false);
    expect(desliga.statusCode, desliga.body).toBe(200);

    // o MESMO token (licença nunca vai no JWT): a próxima requisição já vê o módulo desligado
    const depois = await meusModulos(vendedor.access_token);
    expect(depois.modulos.map((m) => m.id)).toEqual(['core', 'catalogo']);
    expect(depois.versao_licencas).not.toBe(antes.versao_licencas);
    const rota = await app.inject({ method: 'POST', url: `/v1/vendedor/pedidos/${UM_UUID}/cancelar`, headers: comToken(vendedor.access_token), payload: {} });
    expect(rota.statusCode).toBe(403);
    expect(ErroApiSchema.parse(rota.json())).toMatchObject({ codigo: 'MODULO_INATIVO', detalhes: { modulo: 'vendedor' } });

    const religa = await licencaDoUsuario(admin.access_token, A.usuarios.vendedor2, 'vendedor', true);
    expect(religa.statusCode, religa.body).toBe(200);
    expect((await meusModulos(vendedor.access_token)).modulos.map((m) => m.id)).toEqual(['core', 'catalogo', 'vendedor']);
  });

  it('licenças: só o admin altera (vendedor → 403) e o Core nunca desliga (RN-CORE-01)', async () => {
    const vendedor = await tokenDe('vendedor@exemplo.com.br');
    const negado = await licencaDoUsuario(vendedor.access_token, A.usuarios.vendedor2, 'vendedor', false);
    expect(negado.statusCode).toBe(403);
    const admin = await tokenDe('admin@exemplo.com.br');
    const core = await app.inject({ method: 'PUT', url: '/v1/core/licencas/tenant/core', headers: comToken(admin.access_token), payload: { ativo: false } });
    expect(core.statusCode).toBe(422);
    expect(ErroApiSchema.parse(core.json()).codigo).toBe('RN-CORE-01');
  });

  it('RN-PRO-01: o promotor não passa em NENHUMA rota de escrita de pedido montada (todas as rotas reais dos módulos)', async () => {
    const promotor = await tokenDe('promotor@exemplo.com.br');
    expect(promotor.usuario.perfil).toBe('promotor');
    // a leitura (GET com pedido.ver) segue o manifesto e a carteira (O-3): ver o bloco "O-3" abaixo
    const dePedido = modulos.flatMap((m) => (m.rotas ?? []).filter((r) => promotorBarradoNaRota(r)).map((r) => ({ modulo: m.manifesto.id, r })));
    expect(dePedido.length).toBeGreaterThan(0);
    for (const { modulo, r } of dePedido) {
      const url = `/v1/${modulo}/${r.caminho.replace(/:[a-zA-Z_]+/g, UM_UUID)}`;
      const resp = await app.inject({ method: r.metodo, url, headers: comToken(promotor.access_token), ...(r.metodo === 'GET' ? {} : { payload: {} }) });
      expect(resp.statusCode, `${r.metodo} ${url}`).toBe(403);
      expect(['MODULO_INATIVO', 'PERFIL_SEM_ACESSO']).toContain(ErroApiSchema.parse(resp.json()).codigo);
    }
  });

  it('refresh rotativo: o refresh devolve um par novo; o antigo não vale de novo', async () => {
    const s = await tokenDe('supervisor@exemplo.com.br');
    const r1 = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: s.refresh_token } });
    expect(r1.statusCode, r1.body).toBe(200);
    const novo = RefreshRespostaSchema.parse(r1.json());
    expect(novo.refresh_token).not.toBe(s.refresh_token);
    expect((await meusModulos(novo.access_token)).modulos.map((m) => m.id)).toContain('core');
    const reuso = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: s.refresh_token } });
    expect(reuso.statusCode).toBe(401);
    expect(ErroApiSchema.parse(reuso.json()).codigo).toBe('SESSAO_INVALIDA');
  });

  it('sem token ou com token de outro segredo → 401 NAO_AUTENTICADO (falha fechada)', async () => {
    const sem = await app.inject({ method: 'GET', url: '/v1/me/modulos' });
    expect(sem.statusCode).toBe(401);
    const outroCore = criarModuloApiCore({ segredo: () => 'outro-segredo-de-teste-com-32-caracteres-no-minimo' });
    const outro = createApp({ banco: criarBancoApp(pool), modulos: MODULOS_API.map((m) => (m.manifesto.id === 'core' ? outroCore : m)) });
    const s = await tokenDe('gerente@exemplo.com.br');
    const r = await outro.inject({ method: 'GET', url: '/v1/me/modulos', headers: comToken(s.access_token) });
    expect(r.statusCode).toBe(401);
    expect(ErroApiSchema.parse(r.json()).codigo).toBe('NAO_AUTENTICADO');
    await outro.close();
  });
});

/**
 * O-3 (doc 03 §2 "Ver pedidos": promotor = carteira, leitura) com o Postgres: login, carteira e licenças REAIS do Core;
 * manifesto REAL do Vendedor (`pedido.ver` com o promotor) e as rotas reais de escrita. As rotas de leitura são de
 * exemplo sobre pedidos em memória, porque `vendedor.pedido` ainda não existe no banco; a carteira usada é a do banco
 * (promotor de A → só o cliente c1). O Vendedor (e o Catálogo, RN-CORE-03) entra no perfil do promotor só nesta
 * instância, pela fonte de licenças — sem alterar a licença no banco que os outros arquivos leem.
 */
describe.skipIf(semBanco())('O-3: promotor lê pedidos da carteira e nunca escreve (Postgres)', () => {
  const PEDIDO_C1 = '0d000000-0000-4000-8000-0000000000c1';
  const PEDIDO_C2 = '0d000000-0000-4000-8000-0000000000c2';
  const pedidos = [
    { id: PEDIDO_C1, cliente_id: A.clientes.c1 },
    { id: PEDIDO_C2, cliente_id: A.clientes.c2 },
  ];
  const naCarteira = (c: ReadonlySet<string> | 'tenant', id: string) => c === 'tenant' || c.has(id);
  const leitura: RotaModulo[] = [
    {
      metodo: 'GET',
      caminho: 'pedidos',
      acao: 'pedido.ver',
      carteira: 'filtrar_no_dominio',
      executar: async (ctx) => {
        const c = await ctx.carteira();
        return { itens: pedidos.filter((p) => naCarteira(c, p.cliente_id)) };
      },
    },
    {
      metodo: 'GET',
      caminho: 'pedidos/:id',
      acao: 'pedido.ver',
      carteira: 'filtrar_no_dominio',
      params: z.object({ id: z.string().uuid() }),
      executar: async (ctx) => {
        const p = pedidos.find((x) => x.id === (ctx.params as { id: string }).id);
        if (!p || !naCarteira(await ctx.carteira(), p.cliente_id)) throw new ErroNaoEncontrado('PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado na sua carteira.');
        return p;
      },
    },
  ];
  const vendedorReal = modulos.find((m) => m.manifesto.id === 'vendedor')!;
  const escrita = (vendedorReal.rotas ?? []).filter((r) => r.metodo !== 'GET');
  const vendedorO3 = definirModuloApi({ ...vendedorReal, manifesto: vendedor, rotas: [...leitura, ...escrita] });
  const instalados = modulos.map((m) => (m.manifesto.id === 'vendedor' ? vendedorO3 : m));

  let pool: pg.Pool;
  let app: ReturnType<typeof createApp>;
  let ip = 100;
  const tokenDoPromotor = async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/auth/login', remoteAddress: `10.0.1.${++ip}`, payload: { codigo_empresa: A.codigo, email: 'promotor@exemplo.com.br', senha: SENHA } });
    expect(r.statusCode, r.body).toBe(200);
    return { authorization: `Bearer ${SessaoRespostaSchema.parse(r.json()).access_token}` };
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    app = createApp({
      banco: criarBancoApp(pool),
      modulos: instalados,
      licencas: async (u, b) => {
        const l = await licencasDoBanco(u, b);
        return u.perfil === 'promotor' ? { ...l, doPerfil: [...new Set([...l.doPerfil, 'catalogo', 'vendedor'] as const)] } : l;
      },
    });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it('o manifesto real do Vendedor dá pedido.ver ao promotor e nenhuma outra ação', () => {
    expect(vendedor.acoes['pedido.ver']?.perfis).toContain('promotor');
    expect(Object.entries(vendedor.acoes).filter(([a, d]) => a !== 'pedido.ver' && d.perfis.includes('promotor'))).toEqual([]);
  });

  it('GET pedidos → 200 só com os da carteira; GET pedidos/:id → 200 na carteira e 404 fora (RN-CORE-04)', async () => {
    const h = await tokenDoPromotor();
    const lista = await app.inject({ method: 'GET', url: '/v1/vendedor/pedidos', headers: h });
    expect(lista.statusCode, lista.body).toBe(200);
    expect(lista.json()).toEqual({ itens: [{ id: PEDIDO_C1, cliente_id: A.clientes.c1 }] });
    expect((await app.inject({ method: 'GET', url: `/v1/vendedor/pedidos/${PEDIDO_C1}`, headers: h })).statusCode).toBe(200);
    const fora = await app.inject({ method: 'GET', url: `/v1/vendedor/pedidos/${PEDIDO_C2}`, headers: h });
    expect(fora.statusCode).toBe(404);
    expect(ErroApiSchema.parse(fora.json()).codigo).toBe('PEDIDO_NAO_ENCONTRADO');
  });

  it('RN-PRO-01: toda escrita de pedido → 403 PERFIL_SEM_ACESSO, com o Vendedor ativo e a leitura liberada; push → RN-PRO-01', async () => {
    const h = await tokenDoPromotor();
    expect(escrita.length).toBeGreaterThan(0);
    for (const r of escrita) {
      const url = `/v1/vendedor/${r.caminho.replace(/:[a-zA-Z_]+/g, PEDIDO_C1)}`;
      const resp = await app.inject({ method: r.metodo, url, headers: h, payload: {} });
      expect(resp.statusCode, `${r.metodo} ${url}`).toBe(403);
      expect(ErroApiSchema.parse(resp.json()).codigo).toBe('PERFIL_SEM_ACESSO');
    }
    const push = await app.inject({ method: 'POST', url: '/v1/sync/push', headers: h, payload: { itens: [{ entidade: 'pedido', id: UM_UUID, payload: {} }] } });
    expect(push.json().resultados[0]).toMatchObject({ status: 'rejeitado', codigo: 'RN-PRO-01' });
  });

  it('D-1 / RN-CORE-02: com as licenças do banco (promotor sem Vendedor), GET → 403 MODULO_INATIVO e push de pedido_item → MODULO_INATIVO', async () => {
    const h = await tokenDoPromotor();
    const semVendedor = createApp({ banco: criarBancoApp(pool), modulos: instalados });
    const lista = await semVendedor.inject({ method: 'GET', url: '/v1/vendedor/pedidos', headers: h });
    expect([lista.statusCode, ErroApiSchema.parse(lista.json()).codigo]).toEqual([403, 'MODULO_INATIVO']);
    const push = await semVendedor.inject({ method: 'POST', url: '/v1/sync/push', headers: h, payload: { itens: [{ entidade: 'pedido_item', id: UM_UUID, payload: {} }] } });
    expect(push.json().resultados[0]).toMatchObject({ status: 'rejeitado', codigo: 'MODULO_INATIVO' });
    await semVendedor.close();
  });
});
