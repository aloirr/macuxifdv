/**
 * T-0176 (RN-CORE-39; ADR 0056): guarda GLOBAL do usuário sem a filial de cadastro, sem banco.
 * - bloqueado: 403 `USUARIO_SEM_FILIAL` em toda rota autenticada (módulos, me/modulos, push, pull de entidade comum);
 * - exceções: rotas públicas (login, refresh, logout, saúde), rota do Core `liberadaSemFilial` e o sync restrito (novidades e
 *   pull só da entidade liberada, com carteira vazia e equipe = só o próprio);
 * - com filial ou estado não informado: passa; multi-tenant: o bloqueio é do usuário do token, nunca de outro tenant.
 */
import { decodificarCursorNovidades, type AcessoPortalAutenticado, type ContextoBase, type ModuloApi, type RotaModulo, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MODULOS_API } from '../src/modulos';
import { bancoFalso, bancoPortalFalso, LICENCAS_PADRAO, modulosDeTeste, opcoesDeTeste, TENANT, usuarios } from './apoio';

const OUTRO_TENANT = '0a000000-0000-4000-8000-0000000000ff';
const BLOQ = '0b000000-0000-4000-8000-0000000000e1';

/** Tokens de teste: o mesmo id de usuário, bloqueado no TENANT e livre no OUTRO_TENANT (a guarda é do usuário do token). */
const tokens: Record<string, UsuarioAutenticado> = {
  ...usuarios,
  bloqueado: { id: BLOQ, tenant_id: TENANT, perfil: 'vendedor', sem_filial: true },
  admin_bloqueado: { id: '0b000000-0000-4000-8000-0000000000e2', tenant_id: TENANT, perfil: 'analista', sem_filial: true },
  livre_outro_tenant: { id: BLOQ, tenant_id: OUTRO_TENANT, perfil: 'vendedor', sem_filial: false },
};
const cab = (quem: string) => ({ 'x-teste-usuario': quem });

type Visto = { rota: string; tenant: string; carteira: unknown; equipe: unknown };

/** Core real com uma rota liberada de destravamento e o provedor `usuario` liberado (puxar falso que registra o escopo). */
function coreDeTeste(vistos: Visto[]): ModuloApi {
  const core = MODULOS_API.find((m) => m.manifesto.id === 'core')!;
  const registrar = async (rota: string, ctx: ContextoBase) => vistos.push({ rota, tenant: ctx.usuario.tenant_id, carteira: await ctx.carteira(), equipe: await ctx.usuariosVisiveis() });
  const destravar: RotaModulo = {
    metodo: 'GET',
    caminho: 'eu/filial-teste',
    perfis: ['vendedor', 'analista', 'admin'],
    carteira: 'nao_se_aplica',
    liberadaSemFilial: true,
    executar: async (ctx) => {
      await registrar('destravar', ctx);
      return { ok: true };
    },
  };
  const comum: RotaModulo = { metodo: 'GET', caminho: 'teste-comum', perfis: ['vendedor', 'analista', 'admin'], carteira: 'nao_se_aplica', executar: async () => ({ ok: true }) };
  return {
    ...core,
    rotas: [...(core.rotas ?? []), destravar, comum],
    sync: (core.sync ?? []).map((p) =>
      p.entidade.nome === 'usuario'
        ? {
            ...p,
            liberadoSemFilial: true as const,
            puxar: async (ctx: ContextoBase) => {
              await registrar('pull-usuario', ctx);
              return [{ id: ctx.usuario.id, updated_at: new Date(Date.now() - 60_000).toISOString(), deleted_at: null }];
            },
          }
        : p,
    ),
  };
}

function montar() {
  const vistos: Visto[] = [];
  const modulos = modulosDeTeste({ core: coreDeTeste(vistos) });
  const { banco, tenants } = bancoFalso();
  const licencas = { ...LICENCAS_PADRAO, perfil: { ...LICENCAS_PADRAO.perfil, admin: LICENCAS_PADRAO.tenant } };
  const app = createApp({
    ...opcoesDeTeste(licencas, { banco }),
    modulos,
    autenticar: async (h) => tokens[h['x-teste-usuario'] ?? ''] ?? null,
    usuariosVisiveis: async () => 'tenant',
    carteira: async () => 'tenant',
  });
  return { app, vistos, tenants };
}

const PEDIDO = { entidade: 'pedido', id: '0d000000-0000-4000-8000-0000000000a1', operacao: 'upsert', payload: { cliente_id: '0c000000-0000-4000-8000-000000000001', total_centavos: 100 } };

describe('RN-CORE-39: usuário sem a filial de cadastro (bloqueado)', () => {
  it('rota comum de qualquer módulo, do core e me/modulos: 403 USUARIO_SEM_FILIAL', async () => {
    const { app, tenants } = montar();
    for (const url of ['/v1/vendedor/pedidos', '/v1/core/teste-comum', '/v1/me/modulos']) {
      const r = await app.inject({ method: 'GET', url, headers: cab('bloqueado') });
      expect(r.statusCode, url).toBe(403);
      expect(r.json(), url).toMatchObject({ codigo: 'USUARIO_SEM_FILIAL' });
    }
    // a escrita também, antes de validar ou gravar qualquer coisa
    const post = await app.inject({ method: 'POST', url: '/v1/vendedor/pedidos', headers: cab('bloqueado'), payload: { id: PEDIDO.id, cliente_id: PEDIDO.payload.cliente_id, total_centavos: 1 } });
    expect(post.json()).toMatchObject({ codigo: 'USUARIO_SEM_FILIAL' });
    // a guarda vem antes de abrir transação do tenant
    expect(tenants).toEqual([]);
  });

  it('analista/admin sem filial também é bloqueado (qualquer perfil), menos na rota de destravamento', async () => {
    const { app, vistos } = montar();
    expect((await app.inject({ method: 'GET', url: '/v1/core/teste-comum', headers: cab('admin_bloqueado') })).json()).toMatchObject({ codigo: 'USUARIO_SEM_FILIAL' });
    const r = await app.inject({ method: 'GET', url: '/v1/core/eu/filial-teste', headers: cab('admin_bloqueado') });
    expect(r.statusCode).toBe(200);
    // restrito: carteira vazia e equipe só ele, mesmo com o serviço do Core dizendo 'tenant'
    expect(vistos).toEqual([{ rota: 'destravar', tenant: TENANT, carteira: new Set(), equipe: new Set([tokens.admin_bloqueado!.id]) }]);
  });

  it('rotas públicas e saúde não passam pela guarda (login, refresh, logout)', async () => {
    const { app } = montar();
    expect((await app.inject({ method: 'GET', url: '/v1/saude', headers: cab('bloqueado') })).statusCode).toBe(200);
    for (const url of ['/v1/auth/login', '/v1/auth/refresh', '/v1/auth/logout']) {
      const r = await app.inject({ method: 'POST', url, headers: cab('bloqueado'), payload: {} });
      expect(r.json().codigo, url).not.toBe('USUARIO_SEM_FILIAL');
    }
  });

  it('sync: pull só da entidade liberada (a linha do próprio), com carteira vazia e equipe = só ele', async () => {
    const { app, vistos } = montar();
    const comum = await app.inject({ method: 'GET', url: '/v1/sync/pull?entidade=cliente', headers: cab('bloqueado') });
    expect(comum.statusCode).toBe(403);
    expect(comum.json()).toMatchObject({ codigo: 'USUARIO_SEM_FILIAL' });
    const proprio = await app.inject({ method: 'GET', url: '/v1/sync/pull?entidade=usuario', headers: cab('bloqueado') });
    expect(proprio.statusCode).toBe(200);
    expect(proprio.json().itens.map((l: { id: string }) => l.id)).toEqual([BLOQ]);
    expect(vistos).toEqual([{ rota: 'pull-usuario', tenant: TENANT, carteira: new Set(), equipe: new Set([BLOQ]) }]);
  });

  it('sync: novidades só com a entidade liberada; ao destravar, o cursor antigo devolve todas as elegíveis', async () => {
    const { app } = montar();
    const bloq = await app.inject({ method: 'GET', url: '/v1/sync/novidades', headers: cab('bloqueado') });
    expect(bloq.statusCode).toBe(200);
    expect(bloq.json().entidades).toEqual(['usuario']);
    const cursor = bloq.json().cursor as string;
    // destravado (mesmo usuário com filial): o escopo do cursor muda e vêm todas as entidades elegíveis
    tokens.bloqueado = { ...tokens.bloqueado!, sem_filial: false };
    try {
      const livre = await app.inject({ method: 'GET', url: `/v1/sync/novidades?desde=${encodeURIComponent(cursor)}`, headers: cab('bloqueado') });
      expect(livre.statusCode).toBe(200);
      expect(livre.json().entidades.length).toBeGreaterThan(1);
      expect(livre.json().entidades).toContain('cliente');
      expect(decodificarCursorNovidades(livre.json().cursor)?.escopo).not.toBe(decodificarCursorNovidades(cursor)?.escopo);
    } finally {
      tokens.bloqueado = { ...tokens.bloqueado!, sem_filial: true };
    }
  });

  it('sync: push inteiro recusado com 403 (nenhuma transação aberta; a fila do aparelho fica pendente)', async () => {
    const { app, tenants } = montar();
    const r = await app.inject({ method: 'POST', url: '/v1/sync/push', headers: cab('bloqueado'), payload: { itens: [PEDIDO] } });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ codigo: 'USUARIO_SEM_FILIAL' });
    expect(tenants).toEqual([]);
  });
});

describe('RN-CORE-39: com filial (ou estado não informado) passa', () => {
  it('rotas comuns, pull e push seguem; a rota de destravamento também atende sem restrição', async () => {
    const { app, vistos } = montar();
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/pedidos', headers: cab('vendedor') })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/me/modulos', headers: cab('vendedor') })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/sync/pull?entidade=cliente', headers: cab('vendedor') })).statusCode).toBe(200);
    // o lote chega aos provedores (o resultado por item é do módulo)
    const push = await app.inject({ method: 'POST', url: '/v1/sync/push', headers: cab('vendedor'), payload: { itens: [PEDIDO] } });
    expect(push.statusCode).toBe(200);
    expect(push.json().resultados).toHaveLength(1);
    await app.inject({ method: 'GET', url: '/v1/core/eu/filial-teste', headers: cab('vendedor') });
    expect(vistos.at(-1)).toMatchObject({ carteira: 'tenant', equipe: 'tenant' });
  });
});

describe('RN-CORE-39: multi-tenant', () => {
  it('o mesmo id bloqueado num tenant e livre no outro: cada token vale só no próprio tenant', async () => {
    const { app, tenants } = montar();
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/pedidos', headers: cab('bloqueado') })).json()).toMatchObject({ codigo: 'USUARIO_SEM_FILIAL' });
    const outro = await app.inject({ method: 'GET', url: '/v1/sync/pull?entidade=cliente', headers: cab('livre_outro_tenant') });
    expect(outro.statusCode).toBe(200);
    // nenhuma transação foi aberta no tenant do bloqueado; a do livre foi no tenant dele
    expect(tenants.every((t) => t === OUTRO_TENANT)).toBe(true);
  });
});

describe('RN-CORE-39: admin do cliente pelo portal', () => {
  /** Rota `'aceita'` do core de teste; o admin do cliente entra como o admin real da empresa (ADR 0031). */
  const comPortal = (semFilial: boolean) => {
    const portal: AcessoPortalAutenticado = { tipo: 'admin_cliente', sessao_id: '5b000000-0000-4000-8000-0000000000c1', empresa: { tenant_id: TENANT, usuario_id: '0b000000-0000-4000-8000-0000000000a1', sem_filial: semFilial } };
    const core = coreDeTeste([]);
    const rota: RotaModulo = { metodo: 'GET', caminho: 'teste-portal', perfis: ['admin'], carteira: 'nao_se_aplica', superAdmin: 'aceita', executar: async () => ({ ok: true }) };
    const { banco } = bancoFalso();
    return createApp({
      ...opcoesDeTeste({ ...LICENCAS_PADRAO, perfil: { ...LICENCAS_PADRAO.perfil, admin: LICENCAS_PADRAO.tenant } }, { banco }),
      modulos: modulosDeTeste({ core: { ...core, rotas: [...(core.rotas ?? []), rota] } }),
      bancoPortal: bancoPortalFalso().banco,
      autenticarPortal: async () => portal,
    });
  };
  it('com o admin real sem filial: 403 USUARIO_SEM_FILIAL; com filial: passa', async () => {
    const h = { 'x-macuxi-tenant': TENANT };
    expect((await comPortal(true).inject({ method: 'GET', url: '/v1/core/teste-portal', headers: h })).json()).toMatchObject({ codigo: 'USUARIO_SEM_FILIAL' });
    expect((await comPortal(false).inject({ method: 'GET', url: '/v1/core/teste-portal', headers: h })).statusCode).toBe(200);
  });
});
