'use client';

import { lerDetalheDoPedido } from './detalhe-pedido';
/**
 * Consultas das páginas do Vendedor no BKO (T-0029 §8), só na API nova (`/v1/vendedor/*` e `/v1/auditoria`): nenhuma rota da
 * Fase M. A sessão vem de `useSession` (perfil e fuso do login do Core).
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { AuditoriaRespostaSchema, ROTA_AUDITORIA } from '@macuxi/platform-sdk';
import { api, useSession } from '@macuxi/platform-sdk/web';
import { DEFAULT_TZ } from '@macuxi/ui/web';
import { DiscountPolicy, PedidosPage } from '../../contracts';
import { type FiltrosPedidos, paraQuery } from './filtros-url';

/** A lista atualiza sozinha a cada ~10 s. */
export const LIVE_REFETCH_MS = 10_000;
export const POR_PAGINA = 50;

export const qk = {
  pedidos: (f: FiltrosPedidos) => ['vendedor', 'pedidos', f] as const,
  pendentes: ['vendedor', 'pedidos', 'pendentes'] as const,
  pedido: (id: string) => ['vendedor', 'pedido', id] as const,
  alcadas: ['vendedor', 'alcadas'] as const,
  decisoes: ['vendedor', 'decisoes'] as const,
};

function useAuthed() {
  return useSession().status === 'authenticated';
}

export interface SessaoDoBko {
  perfil: string;
  fuso: string;
  empresa: string;
}

/** Perfil, fuso do tenant e nome da empresa do login real (sem `GET /me` da Fase M). */
export function useSessaoDoBko(): SessaoDoBko {
  const s = useSession<{ perfil?: string | null; fuso?: string; empresa?: string }>();
  return { perfil: s.user?.perfil ?? '', fuso: s.user?.fuso ?? DEFAULT_TZ, empresa: s.user?.empresa ?? '' };
}

/** Lista de pedidos com os filtros da URL, paginada por cursor ("Carregar mais"). */
export function usePedidos(f: FiltrosPedidos) {
  const enabled = useAuthed();
  return useInfiniteQuery({
    queryKey: qk.pedidos(f),
    queryFn: async ({ pageParam, signal }) =>
      PedidosPage.parse(await api<unknown>('/vendedor/pedidos', { query: { ...paraQuery(f), limite: POR_PAGINA, ...(pageParam ? { cursor: pageParam } : {}) }, signal })),
    initialPageParam: '' as string,
    getNextPageParam: (ultima) => ultima.proximo_cursor ?? undefined,
    enabled,
    refetchInterval: LIVE_REFETCH_MS,
    placeholderData: (prev) => prev,
  });
}

/** Painel "Aguardando aprovação": os pendentes do escopo do usuário (independente dos filtros da tabela). */
export function usePendentes() {
  const enabled = useAuthed();
  return useQuery({
    queryKey: qk.pendentes,
    queryFn: async ({ signal }) => PedidosPage.parse(await api<unknown>('/vendedor/pedidos', { query: { status: 'pending_approval', limite: 100 }, signal })).itens,
    enabled,
    refetchInterval: LIVE_REFETCH_MS,
  });
}

export function usePedido(id: string | null) {
  const enabled = useAuthed() && !!id;
  return useQuery({ queryKey: qk.pedido(id ?? ''), queryFn: async () => lerDetalheDoPedido(await api<unknown>(`/vendedor/pedidos/${id}`)), enabled });
}

export function useAlcadas() {
  const enabled = useAuthed();
  return useQuery({ queryKey: qk.alcadas, queryFn: async () => DiscountPolicy.parse(await api<unknown>('/vendedor/alcadas')), enabled });
}

/** Decisões de pedido (aprovar, rejeitar, cancelar) da trilha de auditoria da plataforma (RN-AUD-01, `GET /v1/auditoria`). */
export function useDecisoesRecentes() {
  const enabled = useAuthed();
  return useQuery({
    queryKey: qk.decisoes,
    queryFn: async () =>
      AuditoriaRespostaSchema.parse(await api<unknown>(ROTA_AUDITORIA.replace(/^\/v1/, ''), { query: { modulo: 'vendedor', entidade: 'pedido', limite: 30 } })).itens.filter((i) => i.acao !== 'pedido.criar'),
    enabled,
    refetchInterval: LIVE_REFETCH_MS,
  });
}
