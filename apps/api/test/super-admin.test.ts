/**
 * ADR 0029 (T-0087; desenho docs/desenho/T-0087.md §3, §5.1 e §8): super-admin de plataforma na API, sem banco.
 * - rota de módulo sem `superAdmin` recusa o token de plataforma; `'aceita'` vale para os dois; `'exige'` só para ele;
 * - tenant do cabeçalho `x-macuxi-tenant` obrigatório e ativo; licença do módulo NO TENANT continua valendo;
 * - toda requisição do super-admin gera uma linha de auditoria da plataforma, inclusive as recusadas;
 * - `POST /v1/plataforma/empresas` (passo Empresa) pelo `planoDeOnboardingSemAdmin`, com core e integracao sempre.
 * - T-0091 (condição da ADR 0029): sessão, `sa_tenant_ativo`, empresas e auditoria SÓ no banco do portal (`macuxi_portal`);
 *   licença e dado do tenant seguem no `macuxi_app`; sem o banco do portal, 503 PORTAL_INDISPONIVEL e os tenants seguem.
 */
import { definirModuloApi, type AcessoBanco, type RotaModulo, type SuperAdminAutenticado } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createApp } from '../src/app';
import { criarBancoPortal, ErroPapelBanco, MARGEM_HORIZONTE_PADRAO_MS, PAPEL_PORTAL, PRAZO_PROVISIONAR_PORTAL_MS } from '../src/banco';
import type { LicencasTenant } from '../src/licencas';
import { MODULOS_API } from '../src/modulos';
import { fontePlataformaNoBanco, prefixoDoIp, SQL_PRAZO_PROVISIONAR, type EntradaProvisionarPlataforma, type FontePlataforma, type LinhaAuditoriaPlataforma } from '../src/plataforma';
import { bancoFalso, bancoPortalFalso, cab, LICENCAS_PADRAO, modulosDeTeste, opcoesDeTeste, TENANT, vendedorApi } from './apoio';

const SA: SuperAdminAutenticado = { id: '5a000000-0000-4000-8000-000000000001', sessao_id: '5b000000-0000-4000-8000-000000000001' };
const OUTRO_TENANT = '0a000000-0000-4000-8000-0000000000ff';
const comSA = (tenant: string | null = TENANT) => ({ 'x-teste-sa': '1', ...(tenant ? { 'x-macuxi-tenant': tenant } : {}) });

const vistos: { perfil: string; superAdmin: boolean; carteira: unknown; modulos: readonly string[] }[] = [];
const rota = (caminho: string, superAdmin?: RotaModulo['superAdmin']): RotaModulo => ({
  metodo: 'GET',
  caminho,
  carteira: 'nao_se_aplica',
  ...(superAdmin ? { superAdmin } : {}),
  executar: async (ctx) => {
    vistos.push({ perfil: ctx.usuario.perfil, superAdmin: !!ctx.superAdmin, carteira: await ctx.carteira(), modulos: ctx.usuario.modulos });
    return { tenant: ctx.usuario.tenant_id, usuario: ctx.usuario.id };
  },
});

/** Rota de módulo com `superAdmin` que lê dado do tenant: tem de ir pelo `comTenant` do macuxi_app (T-0091). */
const rotaDados: RotaModulo = { metodo: 'GET', caminho: 'sa/dados', carteira: 'nao_se_aplica', superAdmin: 'aceita', executar: async (ctx) => ctx.comTenant(async () => ({ ok: true })) };

function montar(licTenant: Partial<Record<string, LicencasTenant>> = {}, op: { semPortal?: boolean } = {}) {
  const auditoria: LinhaAuditoriaPlataforma[] = [];
  const provisionados: { entrada: EntradaProvisionarPlataforma; simular: boolean }[] = [];
  const app_ = bancoFalso();
  const portal = bancoPortalFalso();
  // cada fonte falsa abre uma transação no banco recebido, como a real: sem o banco do portal, dá 503
  const usos: { onde: string; banco: AcessoBanco }[] = [];
  const usar = async (onde: string, banco: AcessoBanco) => {
    usos.push({ onde, banco });
    await banco.semTenant(async () => undefined);
  };
  const fonte: FontePlataforma = {
    tenantAtivo: async (_sa, t, b) => {
      await usar('tenantAtivo', b);
      return t === TENANT;
    },
    listarEmpresas: async (_sa, b) => {
      await usar('listarEmpresas', b);
      return { itens: [] };
    },
    provisionar: async (_sa, entrada, simular, b) => {
      await usar('provisionar', b);
      provisionados.push({ entrada, simular });
      return { tenant_id: simular ? null : '0a000000-0000-4000-8000-0000000000aa', resultado: 'criado', modulos_adicionados: entrada.modulos.map((m) => m.modulo), parametros_gravados: entrada.parametros.map((p) => p.chave), avisos: [] };
    },
    auditar: async (l, b) => {
      await usar('auditar', b);
      auditoria.push(l);
    },
  };
  const vendedor = definirModuloApi({ ...vendedorApi, rotas: [...(vendedorApi.rotas ?? []), rota('sa/normal'), rota('sa/aceita', 'aceita'), rota('sa/exige', 'exige'), rotaDados] });
  const app = createApp(
    opcoesDeTeste(LICENCAS_PADRAO, {
      modulos: modulosDeTeste({ vendedor }),
      banco: app_.banco,
      bancoPortal: op.semPortal ? null : portal.banco,
      // como o do Core: só um token de plataforma válido chega ao banco (sessão viva)
      autenticarSuperAdmin: async (h, b) => {
        if (h['x-teste-sa'] !== '1') return null;
        await usar('autenticarSuperAdmin', b);
        return SA;
      },
      plataforma: fonte,
      licencasTenant: async (t, b) => {
        usos.push({ onde: 'licencasTenant', banco: b });
        return licTenant[t] ?? { ativosNoTenant: ['core', 'catalogo', 'vendedor', 'integracao'], parametros: {}, fuso: 'America/Manaus' };
      },
    }),
  );
  return { app, auditoria, provisionados, usos, bancoApp: app_, portal };
}

describe('rota de módulo com superAdmin (ADR 0029 §5)', () => {
  it('sem a opção, o token de plataforma não vale (401) e o usuário do tenant segue normal', async () => {
    const { app } = montar();
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/sa/normal', headers: comSA() })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/sa/normal', headers: cab('vendedor') })).statusCode).toBe(200);
  });

  it("'aceita': super-admin vira admin sintético do tenant, com carteira 'tenant' e os módulos do tenant", async () => {
    const { app } = montar();
    vistos.length = 0;
    const r = await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: comSA() });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ tenant: TENANT, usuario: SA.id });
    expect(vistos[0]).toMatchObject({ perfil: 'admin', superAdmin: true, carteira: 'tenant' });
    expect(vistos[0]?.modulos).toEqual(expect.arrayContaining(['core', 'vendedor', 'integracao']));
    // o usuário do tenant continua entrando, sem ctx.superAdmin
    vistos.length = 0;
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: cab('vendedor') })).statusCode).toBe(200);
    expect(vistos[0]).toMatchObject({ perfil: 'vendedor', superAdmin: false });
  });

  it("'exige': só o super-admin; usuário do tenant 403, sem login 401", async () => {
    const { app } = montar();
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/sa/exige', headers: comSA() })).statusCode).toBe(200);
    const r = await app.inject({ method: 'GET', url: '/v1/vendedor/sa/exige', headers: cab('vendedor') });
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('PERFIL_SEM_ACESSO');
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/sa/exige' })).statusCode).toBe(401);
  });

  it('tenant obrigatório (400), desconhecido/inativo (404) e licença do módulo no tenant (403 MODULO_INATIVO)', async () => {
    const { app } = montar({ [TENANT]: { ativosNoTenant: ['core', 'catalogo'], parametros: {}, fuso: null } });
    const sem = await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: comSA(null) });
    expect([sem.statusCode, sem.json().codigo]).toEqual([400, 'TENANT_OBRIGATORIO']);
    const outro = await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: comSA(OUTRO_TENANT) });
    expect([outro.statusCode, outro.json().codigo]).toEqual([404, 'TENANT_NAO_ENCONTRADO']);
    const semLicenca = await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: comSA() });
    expect([semLicenca.statusCode, semLicenca.json().codigo]).toEqual([403, 'MODULO_INATIVO']);
  });

  it('toda requisição do super-admin é auditada, também as recusadas; a do usuário do tenant não', async () => {
    const { app, auditoria } = montar();
    await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: comSA(), remoteAddress: '200.6.7.8' });
    await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: comSA(OUTRO_TENANT) });
    await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: cab('vendedor') });
    expect(auditoria).toHaveLength(2);
    expect(auditoria[0]).toMatchObject({ super_admin_id: SA.id, sessao_id: SA.sessao_id, tenant_id: TENANT, acao: 'sa.requisicao', metodo: 'GET', rota: '/v1/vendedor/sa/aceita', status: 200, ip_prefixo: '200.6.7.0/24' });
    expect(auditoria[1]).toMatchObject({ tenant_id: null, status: 404 });
  });

  it('token de plataforma numa rota sem a opção: 401 e linha na auditoria (ADR 0029 §6); sem token nenhum, nada', async () => {
    const { app, auditoria } = montar();
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/sa/normal', headers: comSA() })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/sa/normal' })).statusCode).toBe(401);
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({ super_admin_id: SA.id, tenant_id: null, rota: '/v1/vendedor/sa/normal', status: 401 });
  });
});

describe('POST /v1/plataforma/empresas (passo Empresa; RN-CORE-31)', () => {
  const corpo = { codigo: 'distribuidora-x', razao_social: 'Distribuidora X Ltda', cnpj: '11.222.333/0001-81', modulos: [{ modulo: 'catalogo' }, { modulo: 'vendedor', licencas: 20 }] };

  it('exige o super-admin (o token de tenant não vale)', async () => {
    const { app } = montar();
    expect((await app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: cab('analista'), payload: corpo })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: cab('analista') })).statusCode).toBe(401);
  });

  it('cria com core e integracao sempre, sem admin, com os parâmetros do Vendedor e auditoria do tenant novo', async () => {
    const { app, provisionados, auditoria } = montar();
    const r = await app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comSA(null), payload: corpo });
    expect(r.statusCode).toBe(201);
    const e = provisionados[0]!.entrada;
    expect(e).toMatchObject({ codigo: 'distribuidora-x', nome: 'Distribuidora X Ltda', documento: '11222333000181', fuso: 'America/Manaus', sem_admin: true });
    expect(e.modulos.map((m) => m.modulo)).toEqual(expect.arrayContaining(['core', 'integracao', 'catalogo', 'vendedor']));
    expect(e.modulos.find((m) => m.modulo === 'vendedor')?.licencas).toBe(20);
    expect(e.parametros).toContainEqual({ modulo: 'vendedor', chave: 'alcada.vendedor_pct', valor: 5 });
    expect(r.json()).toMatchObject({ codigo: 'distribuidora-x', resultado: 'criado', simulado: false });
    expect(auditoria.at(-1)).toMatchObject({ tenant_id: '0a000000-0000-4000-8000-0000000000aa', rota: '/v1/plataforma/empresas', status: 201 });
  });

  it('simular = 200 sem tenant; dependência faltando = 422 RN-CORE-31 com a lista; CNPJ inválido = 400', async () => {
    const { app, provisionados } = montar();
    const s = await app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comSA(null), payload: { ...corpo, simular: true } });
    expect([s.statusCode, s.json().simulado, provisionados[0]?.simular]).toEqual([200, true, true]);
    const dep = await app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comSA(null), payload: { ...corpo, modulos: [{ modulo: 'vendedor' }] } });
    expect(dep.statusCode).toBe(422);
    expect(dep.json().codigo).toBe('RN-CORE-31');
    expect(dep.json().detalhes.erros[0]).toMatchObject({ codigo: 'DEPENDENCIA_FALTANDO', dependencia: 'catalogo' });
    expect((await app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comSA(null), payload: { ...corpo, cnpj: '11.222.333/0001-82' } })).statusCode).toBe(400);
  });
});

describe('prefixo do IP (LGPD)', () => {
  it('IPv4 /24, IPv4 mapeado, IPv6 /48 e vazio', () => {
    expect(prefixoDoIp('200.6.7.8')).toBe('200.6.7.0/24');
    expect(prefixoDoIp('::ffff:10.1.2.3')).toBe('10.1.2.0/24');
    expect(prefixoDoIp('2804:14c:5b:abcd::1')).toBe('2804:14c:5b::/48');
    expect(prefixoDoIp('')).toBeNull();
  });
});

describe('sessão revogada no meio da requisição (0035: erro 28000)', () => {
  const bancoQueLanca = (code: string) => ({ semTenant: async () => Promise.reject(Object.assign(new Error('sessão inválida'), { code })) }) as unknown as AcessoBanco;
  const entrada = {} as EntradaProvisionarPlataforma;

  it('28000 em sa_listar_tenants e sa_provisionar_tenant vira 401 NAO_AUTENTICADO, não 500', async () => {
    await expect(fontePlataformaNoBanco.listarEmpresas(SA, bancoQueLanca('28000'))).rejects.toMatchObject({ status: 401, codigo: 'NAO_AUTENTICADO' });
    await expect(fontePlataformaNoBanco.provisionar(SA, entrada, false, bancoQueLanca('28000'))).rejects.toMatchObject({ status: 401 });
    await expect(fontePlataformaNoBanco.provisionar(SA, entrada, true, bancoQueLanca('28000'))).rejects.toMatchObject({ status: 401 });
  });

  it('outro erro do banco segue igual', async () => {
    await expect(fontePlataformaNoBanco.listarEmpresas(SA, bancoQueLanca('22023'))).rejects.toMatchObject({ code: '22023' });
  });
});

describe('T-0091: sessão do super-admin no papel macuxi_portal (condição da ADR 0029)', () => {
  const corpo = { codigo: 'distribuidora-x', razao_social: 'Distribuidora X Ltda', cnpj: '11.222.333/0001-81', modulos: [{ modulo: 'catalogo' }, { modulo: 'vendedor' }] };

  it('sessão, tenant ativo, empresas e auditoria só no banco do portal; licença e dado do tenant no macuxi_app', async () => {
    const { app, usos, bancoApp, portal } = montar();
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/sa/dados', headers: comSA() })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: comSA(null) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comSA(null), payload: corpo })).statusCode).toBe(201);
    const doPortal = ['autenticarSuperAdmin', 'tenantAtivo', 'listarEmpresas', 'provisionar', 'auditar'];
    expect(new Set(usos.map((u) => u.onde))).toEqual(new Set([...doPortal, 'licencasTenant']));
    for (const u of usos) expect([u.onde, u.banco === (doPortal.includes(u.onde) ? portal.banco : bancoApp.banco)]).toEqual([u.onde, true]);
    // o dado do tenant foi lido pelo comTenant do macuxi_app (RLS), com o tenant do cabeçalho
    expect(bancoApp.tenants).toEqual([TENANT]);
  });

  it('usuário do tenant nunca toca o banco do portal', async () => {
    const { app, portal } = montar();
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: cab('vendedor') })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/pedidos', headers: cab('vendedor') })).statusCode).toBe(200);
    expect(portal.transacoes()).toBe(0);
  });

  it('sem o banco do portal: /v1/plataforma/* e o token de plataforma dão 503 PORTAL_INDISPONIVEL; os tenants seguem', async () => {
    const { app, auditoria } = montar({}, { semPortal: true });
    const respostas = [
      await app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: comSA(null) }),
      await app.inject({ method: 'GET', url: '/v1/plataforma/empresas' }),
      await app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comSA(null), payload: corpo }),
      await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: comSA() }),
    ];
    for (const r of respostas) expect([r.statusCode, r.json().codigo]).toEqual([503, 'PORTAL_INDISPONIVEL']);
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: cab('vendedor') })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/sa/exige' })).statusCode).toBe(401);
    expect(auditoria).toEqual([]);
  });

  it('a API não sobe com rota do portal fora do lugar (erro de programação), nem com o portal noutro papel', async () => {
    const core = MODULOS_API.find((m) => m.manifesto.id === 'core')!;
    const publica = { metodo: 'POST' as const, caminho: 'plataforma/auth/login', limite: { max: 5, janelaMs: 60_000 }, executar: async () => ({}) };
    // montadas sem definirModuloApi: a checagem da subida é a última barreira
    const com = (extra: Parameters<typeof modulosDeTeste>[0]) => () => createApp(opcoesDeTeste(LICENCAS_PADRAO, { modulos: modulosDeTeste(extra) }));
    expect(com({ core: { ...core, rotasPublicas: [publica] } })).toThrow(/exige conexao 'portal'/);
    expect(com({ core: { ...core, rotasPublicas: [{ ...publica, caminho: 'auth/x', conexao: 'portal' }] } })).toThrow(/só em caminho plataforma/);
    expect(com({ vendedor: { ...vendedorApi, rotasPublicas: [{ ...publica, conexao: 'portal' }] } })).toThrow(/só no manifesto core/);
    const portal = bancoPortalFalso();
    const app = createApp({ ...opcoesDeTeste(), banco: bancoFalso().banco, bancoPortal: { ...portal.banco, verificar: async () => Promise.reject(new ErroPapelBanco('papel errado')) } });
    await expect(app.ready()).rejects.toThrow(/papel errado/);
  });
});

describe('criarBancoPortal (T-0091)', () => {
  const poolCom = (linha: { usuario: string; superusuario: boolean; ignora_rls: boolean } | undefined) => ({ query: async () => ({ rows: linha ? [linha] : [] }) }) as unknown as pg.Pool;

  it('na subida só aceita macuxi_portal, sem superusuário nem BYPASSRLS', async () => {
    await expect(criarBancoPortal(poolCom({ usuario: PAPEL_PORTAL, superusuario: false, ignora_rls: false })).verificar()).resolves.toBeUndefined();
    await expect(criarBancoPortal(poolCom({ usuario: 'macuxi_app', superusuario: false, ignora_rls: false })).verificar()).rejects.toThrow(/só conecta como macuxi_portal/);
    await expect(criarBancoPortal(poolCom({ usuario: PAPEL_PORTAL, superusuario: false, ignora_rls: true })).verificar()).rejects.toBeInstanceOf(ErroPapelBanco);
    await expect(criarBancoPortal(poolCom(undefined)).verificar()).rejects.toBeInstanceOf(ErroPapelBanco);
  });

  it('nunca abre tenant', async () => {
    await expect(criarBancoPortal(poolCom(undefined)).comTenant(TENANT, async () => 1)).rejects.toThrow(/nunca abre tenant/);
  });
});

describe('horizonte do pull × provisionar no papel do portal (desenho T-0091 §3 item 5)', () => {
  it('o prazo da sa_provisionar_tenant fica abaixo da margem do horizonte', () => {
    expect(PRAZO_PROVISIONAR_PORTAL_MS).toBeLessThan(MARGEM_HORIZONTE_PADRAO_MS);
    expect(SQL_PRAZO_PROVISIONAR).toBe(`set local statement_timeout = '${PRAZO_PROVISIONAR_PORTAL_MS}ms'`);
  });

  it('o set local do prazo vem antes da chamada, na mesma transação (de verdade e simulando)', async () => {
    for (const simular of [false, true]) {
      const portal = bancoPortalFalso();
      await fontePlataformaNoBanco.provisionar(SA, {} as EntradaProvisionarPlataforma, simular, portal.banco);
      expect(portal.transacoes()).toBe(1);
      expect(portal.consultas).toEqual([SQL_PRAZO_PROVISIONAR, 'select plataforma.sa_provisionar_tenant($1, $2::jsonb) as r']);
    }
  });
});
