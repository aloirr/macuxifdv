/**
 * ADR 0029 (T-0087; desenho docs/desenho/T-0087.md §3, §5.1 e §8): super-admin de plataforma na API, sem banco.
 * - rota de módulo sem `superAdmin` recusa o token de plataforma; `'aceita'` vale para os dois; `'exige'` só para ele;
 * - tenant do cabeçalho `x-macuxi-tenant` obrigatório e ativo; licença do módulo NO TENANT continua valendo;
 * - toda requisição do super-admin gera uma linha de auditoria da plataforma, inclusive as recusadas;
 * - `POST /v1/plataforma/empresas` (passo Empresa) pelo `planoDeOnboardingSemAdmin`, com core e integracao sempre.
 */
import { definirModuloApi, type AcessoBanco, type RotaModulo, type SuperAdminAutenticado } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { LicencasTenant } from '../src/licencas';
import { fontePlataformaNoBanco, prefixoDoIp, type EntradaProvisionarPlataforma, type FontePlataforma, type LinhaAuditoriaPlataforma } from '../src/plataforma';
import { cab, LICENCAS_PADRAO, modulosDeTeste, opcoesDeTeste, TENANT, vendedorApi } from './apoio';

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

function montar(licTenant: Partial<Record<string, LicencasTenant>> = {}) {
  const auditoria: LinhaAuditoriaPlataforma[] = [];
  const provisionados: { entrada: EntradaProvisionarPlataforma; simular: boolean }[] = [];
  const fonte: FontePlataforma = {
    tenantAtivo: async (_sa, t) => t === TENANT,
    listarEmpresas: async () => ({ itens: [] }),
    provisionar: async (_sa, entrada, simular) => {
      provisionados.push({ entrada, simular });
      return { tenant_id: simular ? null : '0a000000-0000-4000-8000-0000000000aa', resultado: 'criado', modulos_adicionados: entrada.modulos.map((m) => m.modulo), parametros_gravados: entrada.parametros.map((p) => p.chave), avisos: [] };
    },
    auditar: async (l) => void auditoria.push(l),
  };
  const vendedor = definirModuloApi({ ...vendedorApi, rotas: [...(vendedorApi.rotas ?? []), rota('sa/normal'), rota('sa/aceita', 'aceita'), rota('sa/exige', 'exige')] });
  const app = createApp(
    opcoesDeTeste(LICENCAS_PADRAO, {
      modulos: modulosDeTeste({ vendedor }),
      autenticarSuperAdmin: async (h) => (h['x-teste-sa'] === '1' ? SA : null),
      plataforma: fonte,
      licencasTenant: async (t) => licTenant[t] ?? { ativosNoTenant: ['core', 'catalogo', 'vendedor', 'integracao'], parametros: {}, fuso: 'America/Manaus' },
    }),
  );
  return { app, auditoria, provisionados };
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
