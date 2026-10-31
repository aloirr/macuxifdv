/**
 * Apoio dos testes da API sem banco: módulos de fixture sobre os MANIFESTOS REAIS dos 8 módulos (rotas de exemplo
 * de vendedor e promotor), autenticação por cabeçalho de teste, licenças em memória e banco falso.
 */
import { manifest as promotor } from '@macuxi/promotor/manifest';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import {
  definirModuloApi,
  ErroNaoEncontrado,
  ErroRegraNegocio,
  type ClienteBanco,
  type ModuloApi,
  type ModuloId,
  type Perfil,
  type UsuarioAutenticado,
} from '@macuxi/platform-sdk';
import { z } from 'zod';
import type { OpcoesApp } from '../src/app';
import type { BancoApp } from '../src/banco';
import type { LicencasUsuario } from '../src/licencas';
import { MODULOS_API } from '../src/modulos';

export const TENANT = '0a000000-0000-4000-8000-000000000001';
export const CLIENTE_DA_CARTEIRA = '0c000000-0000-4000-8000-000000000001';
export const CLIENTE_FORA = '0c000000-0000-4000-8000-000000000002';

export const usuarios: Record<string, UsuarioAutenticado> = {
  vendedor: { id: '0b000000-0000-4000-8000-000000000001', tenant_id: TENANT, perfil: 'vendedor' },
  promotor: { id: '0b000000-0000-4000-8000-000000000002', tenant_id: TENANT, perfil: 'promotor' },
  supervisor: { id: '0b000000-0000-4000-8000-000000000003', tenant_id: TENANT, perfil: 'supervisor' },
  analista: { id: '0b000000-0000-4000-8000-000000000004', tenant_id: TENANT, perfil: 'analista' },
};

export const cab = (quem: keyof typeof usuarios) => ({ 'x-teste-usuario': quem });

/** Rotas de exemplo do Vendedor (as reais chegam com o módulo; o manifesto e as ações são os reais). */
export const vendedorApi = definirModuloApi({
  manifesto: vendedor,
  rotas: [
    { metodo: 'GET', caminho: 'pedidos', carteira: 'filtrar_no_dominio', executar: async (ctx) => ({ itens: [], quem: ctx.usuario.perfil }) },
    {
      metodo: 'POST',
      caminho: 'pedidos',
      acao: 'pedido.criar',
      status: 201,
      corpo: z.object({ id: z.string().uuid(), cliente_id: z.string().uuid(), total_centavos: z.number().int().nonnegative() }),
      carteira: (e) => (e.corpo as { cliente_id: string }).cliente_id,
      executar: async (ctx) => {
        if (ctx.corpo.total_centavos === 0) throw new ErroRegraNegocio('RN-VEN-01', 'Pedido sem itens.');
        return { id: ctx.corpo.id };
      },
    },
    { metodo: 'POST', caminho: 'pedidos/:id/aprovar', acao: 'pedido.aprovar', carteira: 'filtrar_no_dominio', params: z.object({ id: z.string().uuid() }), executar: async () => ({ ok: true }) },
    {
      metodo: 'GET',
      caminho: 'pedidos/:id',
      carteira: 'filtrar_no_dominio',
      executar: async () => {
        throw new ErroNaoEncontrado('PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado na sua carteira.');
      },
    },
  ],
});

/** Rota de exemplo do Promotor (coleta). */
export const promotorApi = definirModuloApi({
  manifesto: promotor,
  rotas: [{ metodo: 'POST', caminho: 'gondolas', acao: 'gondola.registrar', status: 201, carteira: (e) => (e.corpo as { cliente_id?: string }).cliente_id, executar: async () => ({ ok: true }) }],
});

/** Os 8 módulos instalados, com vendedor e promotor trocados pelas versões com rotas de exemplo. */
export function modulosDeTeste(extra: Partial<Record<ModuloId, ModuloApi>> = {}): ModuloApi[] {
  const trocas: Partial<Record<ModuloId, ModuloApi>> = { vendedor: vendedorApi, promotor: promotorApi, ...extra };
  return MODULOS_API.map((m) => trocas[m.manifesto.id] ?? m);
}

export interface Licencas {
  tenant: ModuloId[];
  perfil: Partial<Record<Perfil, ModuloId[]>>;
  removidos?: Partial<Record<string, ModuloId[]>>;
}

export const LICENCAS_PADRAO: Licencas = {
  tenant: ['core', 'catalogo', 'vendedor', 'promotor'],
  perfil: {
    vendedor: ['core', 'catalogo', 'vendedor'],
    // o promotor tem o Vendedor no perfil de propósito: RN-PRO-01 vale mesmo com o módulo ativo (esclarecimento de 2026-10-30)
    promotor: ['core', 'catalogo', 'promotor', 'vendedor'],
    supervisor: ['core', 'catalogo', 'vendedor', 'promotor'],
    analista: ['core', 'catalogo', 'vendedor', 'promotor'],
  },
};

/** Banco falso: registra as transações abertas com o tenant (prova que a rota passou pelo comTenant). */
export function bancoFalso(horizonte: () => Date = () => new Date(Date.now() - 2_000)) {
  const tenants: string[] = [];
  const cliente: ClienteBanco = { query: async () => ({ rows: [], rowCount: 0 }) };
  const banco: BancoApp = {
    verificar: async () => undefined,
    comTenant: async (t, fn) => {
      tenants.push(t);
      return fn(cliente);
    },
    semTenant: async (fn) => fn(cliente),
    horizonteSync: async () => horizonte(),
  };
  return { banco, tenants };
}

export function opcoesDeTeste(l: Licencas = LICENCAS_PADRAO, extra: Partial<OpcoesApp> = {}): OpcoesApp {
  return {
    modulos: modulosDeTeste(),
    autenticar: async (h) => usuarios[h['x-teste-usuario'] ?? ''] ?? null,
    licencas: async (u): Promise<LicencasUsuario> => ({
      ativosNoTenant: l.tenant,
      doPerfil: l.perfil[u.perfil] ?? ['core'],
      removidosDoUsuario: l.removidos?.[u.id] ?? [],
      parametros: { core: { raio_checkin_m: 150 } },
    }),
    carteira: async (u) => (u.perfil === 'analista' ? 'tenant' : new Set([CLIENTE_DA_CARTEIRA])),
    ...extra,
  };
}
