'use client';

/**
 * Consultas das páginas do Core no BKO (copiadas de lib/queries.ts da Fase M). `useMe` usa a mesma chave
 * do shell (`['me']`), então os dados são compartilhados no cache do React Query. Chamadas pelo cliente
 * da API do platform-sdk (`@macuxi/platform-sdk/web`); a sessão vem de `useSession`.
 */
import { useQuery } from '@tanstack/react-query';
import { api, useSession } from '@macuxi/platform-sdk/web';
import { HierarquiaEquipeSchema, RotasListaSchema, type Branch, type CustomersDashboard, type IncentivePlan, type Me, type RouteDay, type Seller, type Team, type TeamGoals } from '../../contracts';
import { clienteDaCarteira, equipesDaHierarquia, INICIO_PADRAO, paraRouteDay, type ClienteDaCarteira } from './rotas-api';

/** Faróis: atualizam sozinhos a cada ~10 s. */
export const LIVE_REFETCH_MS = 10_000;

interface ListResponse<T> {
  items: T[];
  next_cursor: string | null;
}

export interface GoalPeriod {
  id: string;
  year_month: string;
  status: 'open' | 'closed';
  closed_by: string;
  closed_at: string;
}

export const qk = {
  me: ['me'] as const,
  branches: ['branches'] as const,
  teams: ['teams'] as const,
  sellers: ['sellers'] as const,
  customersDashboard: (f: object) => ['dashboards', 'customers', f] as const,
  goals: (period: string, team: string) => ['goals', period, team] as const,
  goalPeriods: ['goal-periods'] as const,
  currentPlan: (period: string) => ['incentive-plans', 'current', period] as const,
  plans: ['incentive-plans', 'list'] as const,
  routes: (f: object) => ['routes', f] as const,
  sellerCustomers: (sellerId: string) => ['customers', 'seller', sellerId] as const,
  hierarquia: ['core', 'hierarquia'] as const,
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

export interface CustomersFilter {
  period: string;
  team_id: string;
  abc: string;
  segment: string;
}

export function useCustomersDashboard(f: CustomersFilter) {
  const enabled = useAuthed() && !!f.period;
  return useQuery({
    queryKey: qk.customersDashboard(f),
    queryFn: ({ signal }) => api<CustomersDashboard>('/dashboards/customers', { query: { ...f }, signal }),
    enabled,
    refetchInterval: LIVE_REFETCH_MS,
    placeholderData: (prev) => prev,
  });
}

export function useGoals(period: string, teamId: string) {
  const enabled = useAuthed() && !!period;
  return useQuery({
    queryKey: qk.goals(period, teamId),
    queryFn: ({ signal }) => api<TeamGoals>('/goals', { query: { period, team_id: teamId }, signal }),
    enabled,
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useGoalPeriods() {
  const enabled = useAuthed();
  return useQuery({ queryKey: qk.goalPeriods, queryFn: () => api<ListResponse<GoalPeriod>>('/goal-periods').then((r) => r.items), enabled });
}

export function useCurrentPlan(period: string) {
  const enabled = useAuthed() && !!period;
  return useQuery({ queryKey: qk.currentPlan(period), queryFn: () => api<IncentivePlan>('/incentive-plans/current', { query: { period } }), enabled });
}

export function usePlans() {
  const enabled = useAuthed();
  return useQuery({ queryKey: qk.plans, queryFn: () => api<ListResponse<IncentivePlan>>('/incentive-plans').then((r) => r.items), enabled });
}

export interface RoutesResponse {
  start: { lat: number; lng: number };
  items: RouteDay[];
}

export interface RoutesFilter {
  from: string;
  to: string;
  seller_id: string;
  team_id: string;
}

/** Equipe de campo (vendedores e promotores) e "equipes" (o supervisor de cada um) da hierarquia do Core (T-0018). */
function useEquipeDeCampo<T>(select: (e: { sellers: Seller[]; teams: Team[]; papeis: Record<string, 'vendedor' | 'promotor'> }) => T) {
  const enabled = useAuthed();
  return useQuery({
    queryKey: qk.hierarquia,
    queryFn: () => api<unknown>('/core/equipe/hierarquia').then((r) => equipesDaHierarquia(HierarquiaEquipeSchema.parse(r).membros)),
    select,
    enabled,
    staleTime: 5 * 60_000,
  });
}
export const useSellersDeCampo = () => useEquipeDeCampo((e) => e.sellers);
export const useTeamsDeCampo = () => useEquipeDeCampo((e) => e.teams);
/** Papel do vínculo da carteira por usuário (o do perfil, premissa da T-0017). */
export const usePapeisDeCampo = () => useEquipeDeCampo((e) => e.papeis);

const hojeIso = () => new Date().toISOString().slice(0, 10);

/**
 * Rotas do período (até 62 dias) de `GET /v1/core/rotas`, no formato do editor. Sem filtro de usuário, as dos
 * usuários visíveis (a API filtra pelo escopo, RN-CORE-04). Atualiza a cada 30 s para acompanhar as visitas do dia.
 */
export function useRoutes(f: RoutesFilter, enabled = true) {
  const authed = useAuthed();
  return useQuery({
    queryKey: qk.routes(f),
    queryFn: async ({ signal }): Promise<RoutesResponse> => {
      const r = await api<unknown>('/core/rotas', { query: { de: f.from, ate: f.to, ...(f.seller_id ? { usuario_id: f.seller_id } : {}) }, signal });
      const hoje = hojeIso();
      return { start: { ...INICIO_PADRAO }, items: RotasListaSchema.parse(r).itens.map((i) => paraRouteDay(i, hoje)) };
    },
    enabled: authed && enabled && !!f.from,
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
}

/** Carteira vigente do usuário (com lat/lng) para incluir clientes na rota. */
export function useSellerCustomers(sellerId: string | null) {
  const enabled = useAuthed() && !!sellerId;
  return useQuery({
    queryKey: qk.sellerCustomers(sellerId ?? ''),
    queryFn: ({ signal }) => api<{ itens: ClienteDaCarteira[] }>(`/core/usuarios/${encodeURIComponent(sellerId ?? '')}/clientes`, { signal }).then((r) => r.itens.map((c) => clienteDaCarteira(c, hojeIso()))),
    enabled,
    staleTime: 5 * 60_000,
  });
}
