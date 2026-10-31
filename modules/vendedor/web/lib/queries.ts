'use client';

/** Consultas das páginas do Vendedor no BKO (pedidos, painel, alçadas). Mesma chave `me` do shell. */
import { useQuery } from '@tanstack/react-query';
import type { AuditEntry, Branch, Me, Seller, Team } from '@macuxi/core/contracts';
import { api, useSession } from '@macuxi/platform-sdk/web';
import type { DiscountPolicy, OrderDetail, OrdersDashboard } from '../../contracts';

/** Faróis: atualizam sozinhos a cada ~10 s. */
export const LIVE_REFETCH_MS = 10_000;

export interface ListResponse<T> {
  items: T[];
  next_cursor: string | null;
}

export const qk = {
  me: ['me'] as const,
  branches: ['branches'] as const,
  teams: ['teams'] as const,
  sellers: ['sellers'] as const,
  ordersDashboard: (f: object) => ['dashboards', 'orders', f] as const,
  order: (id: string) => ['order', id] as const,
  discountPolicy: ['discount-policy'] as const,
  audit: (entity: string) => ['audit-log', entity] as const,
};

function useAuthed() {
  return useSession().status === 'authenticated';
}

export function useMe() {
  const enabled = useAuthed();
  return useQuery({ queryKey: qk.me, queryFn: () => api<Me>('/me'), enabled, staleTime: 60_000 });
}

export function useBranches() {
  const enabled = useAuthed();
  return useQuery({ queryKey: qk.branches, queryFn: () => api<ListResponse<Branch>>('/branches').then((r) => r.items), enabled, staleTime: 5 * 60_000 });
}

export function useTeams() {
  const enabled = useAuthed();
  return useQuery({ queryKey: qk.teams, queryFn: () => api<ListResponse<Team>>('/teams').then((r) => r.items), enabled, staleTime: 5 * 60_000 });
}

export function useSellers() {
  const enabled = useAuthed();
  return useQuery({ queryKey: qk.sellers, queryFn: () => api<ListResponse<Seller>>('/sellers').then((r) => r.items), enabled, staleTime: 5 * 60_000 });
}

export interface OrdersFilter {
  period: 'today' | 'week' | 'month';
  branch_id: string;
  team_id: string;
  status: string;
}

export function useOrdersDashboard(f: OrdersFilter) {
  const enabled = useAuthed();
  return useQuery({
    queryKey: qk.ordersDashboard(f),
    queryFn: ({ signal }) => api<OrdersDashboard>('/dashboards/orders', { query: { ...f }, signal }),
    enabled,
    refetchInterval: LIVE_REFETCH_MS,
    placeholderData: (prev) => prev,
  });
}

export function useOrderDetail(id: string | null) {
  const enabled = useAuthed() && !!id;
  return useQuery({ queryKey: qk.order(id ?? ''), queryFn: () => api<OrderDetail>(`/orders/${id}`), enabled });
}

export function useDiscountPolicy() {
  const enabled = useAuthed();
  return useQuery({ queryKey: qk.discountPolicy, queryFn: () => api<DiscountPolicy>('/discount-policy'), enabled });
}

export function useAuditLog(entity: string) {
  const enabled = useAuthed();
  return useQuery({
    queryKey: qk.audit(entity),
    queryFn: () => api<ListResponse<AuditEntry>>('/audit-log', { query: { entity, limit: 300 } }).then((r) => r.items),
    enabled,
    refetchInterval: LIVE_REFETCH_MS,
  });
}
