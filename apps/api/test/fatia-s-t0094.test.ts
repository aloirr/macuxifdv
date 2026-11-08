/**
 * T-0094 fatia S (desenho docs/desenho/T-0094.md §8, §10 item 6 e §14; ADR 0032 e 0033), sem banco:
 * - rota `superficie: 'bko'` recusa vendedor, promotor e supervisor (403 PERFIL_SEM_BKO) e aceita admin, analista, assistente e
 *   gerente, com qualquer token; a recusa vem depois da licença (MODULO_INATIVO) e antes da ação/perfil e do Zod;
 * - multiperfil (RN-CORE-35): vendedor + promotor cria pedido (união nas ações) e não entra no BKO (regra mais restritiva no acesso);
 * - `ctx.email` chega à rota de módulo e à rota pública (porta da outbox; padrão desligado).
 */
import { manifest as core } from '@macuxi/core/manifest';
import { criarServicoEmailMemoria, definirModuloApi, perfilDeFabrica, type ModuloId, type Perfil, type RotaModulo, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app';
import { cab, CLIENTE_DA_CARTEIRA, LICENCAS_PADRAO, modulosDeTeste, opcoesDeTeste, TENANT, usuarios, vendedorApi } from './apoio';

const ID = (n: number) => `0b000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
const extras: Record<string, UsuarioAutenticado> = {
  gerente: { id: ID(1), tenant_id: TENANT, perfil: 'gerente' },
  assistente: { id: ID(2), tenant_id: TENANT, perfil: 'assistente' },
  admin: { id: ID(3), tenant_id: TENANT, perfil: 'admin' },
  // multiperfil: o token diz promotor (perfil principal); os perfis de acesso vêm da fonte (0041)
  vendedor_promotor: { id: ID(4), tenant_id: TENANT, perfil: 'promotor' },
};
const todos = { ...usuarios, ...extras };
const MODULOS_BKO = ['core', 'catalogo', 'vendedor', 'promotor'] as const;

const vistos: { email: boolean | null }[] = [];
const rotaBko: RotaModulo = {
  metodo: 'GET',
  caminho: 'bko/relatorio',
  superficie: 'bko',
  // todos os perfis na lista: quem decide é só a superfície
  perfis: ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'],
  carteira: 'nao_se_aplica',
  query: z.object({ n: z.coerce.number() }),
  executar: async (ctx) => {
    vistos.push({ email: ctx.email ? ctx.email.disponivel() : null });
    return { ok: true };
  },
};

function montar(op: { email?: ReturnType<typeof criarServicoEmailMemoria>; tenant?: ModuloId[] } = {}) {
  const vendedor = definirModuloApi({ ...vendedorApi, rotas: [...(vendedorApi.rotas ?? []), rotaBko] });
  const coreDeTeste = definirModuloApi({
    manifesto: core,
    rotasPublicas: [
      {
        metodo: 'POST',
        caminho: 'auth/eco-email',
        limite: { max: 50, janelaMs: 60_000 },
        corpo: z.object({}),
        executar: async (ctx) => ({ email: ctx.email ? ctx.email.disponivel() : null }),
      },
    ],
  });
  const base = opcoesDeTeste(
    { ...LICENCAS_PADRAO, tenant: op.tenant ?? LICENCAS_PADRAO.tenant, perfil: Object.fromEntries(['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'].map((p) => [p, [...MODULOS_BKO]])) as never },
    {
      modulos: modulosDeTeste({ vendedor, core: coreDeTeste }),
      autenticar: async (h) => todos[h['x-teste-usuario'] ?? ''] ?? null,
      carteira: async () => 'tenant',
      ...(op.email ? { email: op.email } : {}),
    },
  );
  const licencas = base.licencas!;
  return createApp({
    ...base,
    licencas: async (u, b) => {
      const l = await licencas(u, b);
      return u.id === extras.vendedor_promotor!.id ? { ...l, perfis: [perfilDeFabrica('vendedor'), perfilDeFabrica('promotor')] } : l;
    },
  });
}

const comoQuem = (quem: string) => ({ 'x-teste-usuario': quem });

describe('RN-CORE-33: rota superficie "bko" (403 PERFIL_SEM_BKO)', () => {
  it.each(['vendedor', 'promotor', 'supervisor'] as const)('%s: 403 PERFIL_SEM_BKO com qualquer entrada (antes do Zod)', async (quem) => {
    const app = montar();
    for (const url of ['/v1/vendedor/bko/relatorio?n=1', '/v1/vendedor/bko/relatorio?errado=1']) {
      const r = await app.inject({ method: 'GET', url, headers: comoQuem(quem) });
      expect([r.statusCode, r.json().codigo]).toEqual([403, 'PERFIL_SEM_BKO']);
      expect(r.json().mensagem).toBe('Seu perfil não tem acesso ao backoffice.');
    }
  });

  it.each(['admin', 'analista', 'assistente', 'gerente'] as const satisfies readonly Perfil[])('%s: entra', async (quem) => {
    const r = await montar().inject({ method: 'GET', url: '/v1/vendedor/bko/relatorio?n=1', headers: comoQuem(quem) });
    expect(r.statusCode, r.body).toBe(200);
  });

  it('a licença vem antes: módulo inativo no tenant = 403 MODULO_INATIVO, mesmo para o vendedor; sem token = 401', async () => {
    const app = montar({ tenant: ['core', 'catalogo'] });
    const r = await app.inject({ method: 'GET', url: '/v1/vendedor/bko/relatorio?n=1', headers: comoQuem('vendedor') });
    expect([r.statusCode, r.json().codigo]).toEqual([403, 'MODULO_INATIVO']);
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/bko/relatorio?n=1' })).statusCode).toBe(401);
  });

  it('rota sem a marca segue pelo perfil/ação (o supervisor lê pedidos)', async () => {
    const r = await montar().inject({ method: 'GET', url: '/v1/vendedor/pedidos', headers: cab('supervisor') });
    expect(r.statusCode).toBe(200);
  });
});

describe('RN-CORE-35: multiperfil vendedor + promotor', () => {
  it('cria pedido pelo perfil de vendedor (união nas ações) e não entra no BKO (regra mais restritiva no acesso)', async () => {
    const app = montar();
    const pedido = await app.inject({
      method: 'POST',
      url: '/v1/vendedor/pedidos',
      headers: comoQuem('vendedor_promotor'),
      payload: { id: '0d000000-0000-4000-8000-000000000201', cliente_id: CLIENTE_DA_CARTEIRA, total_centavos: 100 },
    });
    expect(pedido.statusCode, pedido.body).toBe(201);
    const bko = await app.inject({ method: 'GET', url: '/v1/vendedor/bko/relatorio?n=1', headers: comoQuem('vendedor_promotor') });
    expect([bko.statusCode, bko.json().codigo]).toEqual([403, 'PERFIL_SEM_BKO']);
  });

  it('RN-PRO-01: o promotor sozinho continua sem criar pedido', async () => {
    const r = await montar().inject({
      method: 'POST',
      url: '/v1/vendedor/pedidos',
      headers: cab('promotor'),
      payload: { id: '0d000000-0000-4000-8000-000000000202', cliente_id: CLIENTE_DA_CARTEIRA, total_centavos: 100 },
    });
    expect([r.statusCode, r.json().codigo]).toEqual([403, 'PERFIL_SEM_ACESSO']);
  });
});

describe('ctx.email (desenho §10 item 6)', () => {
  it('chega à rota de módulo e à pública; padrão desligado (disponivel = false)', async () => {
    vistos.length = 0;
    const desligado = montar();
    await desligado.inject({ method: 'GET', url: '/v1/vendedor/bko/relatorio?n=1', headers: comoQuem('admin') });
    expect((await desligado.inject({ method: 'POST', url: '/v1/auth/eco-email', payload: {} })).json()).toEqual({ email: false });
    const ligado = montar({ email: criarServicoEmailMemoria() });
    await ligado.inject({ method: 'GET', url: '/v1/vendedor/bko/relatorio?n=1', headers: comoQuem('admin') });
    expect((await ligado.inject({ method: 'POST', url: '/v1/auth/eco-email', payload: {} })).json()).toEqual({ email: true });
    expect(vistos).toEqual([{ email: false }, { email: true }]);
  });
});
