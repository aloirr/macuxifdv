'use client';

/**
 * Consultas das páginas do Core no BKO (copiadas de lib/queries.ts da Fase M). `useMe` usa a mesma chave
 * do shell (`['me']`), então os dados são compartilhados no cache do React Query. Chamadas pelo cliente
 * da API do platform-sdk (`@macuxi/platform-sdk/web`); a sessão vem de `useSession`.
 */
import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, useSession } from '@macuxi/platform-sdk/web';
import { HierarquiaEquipeSchema, RotasListaSchema, type RouteDay, type Seller, type Team } from '../../contracts';
import { intervaloSyncAutoMs, SYNC_AUTO_PADRAO_MIN } from '@macuxi/ui/web';
import { hojeNoFuso } from './hoje';
import { clienteDaCarteira, equipesDaHierarquia, INICIO_PADRAO, paraRouteDay, type ClienteDaCarteira } from './rotas-api';

export const qk = {
  me: ['me'] as const,
  routes: (f: object) => ['routes', f] as const,
  sellerCustomers: (sellerId: string) => ['customers', 'seller', sellerId] as const,
  hierarquia: ['core', 'hierarquia'] as const,
};

function useAuthed() {
  return useSession().status === 'authenticated';
}

/**
 * Quem está logado, sem chamar `/v1/me` (rota só da Fase M): o fuso do tenant vem da sessão do login real
 * (`SessaoResposta.tenant.fuso`, RN-CORE-11) e o "hoje" é a data nesse fuso. Mesmo formato de leitura de antes.
 */
export function useMe() {
  const sessao = useSession<{ fuso?: string }>();
  const fuso = sessao.user?.fuso || 'America/Manaus';
  const data = useMemo(() => ({ today: hojeNoFuso(new Date(), fuso), tenant: { timezone: fuso } }), [fuso]);
  return { data, isPending: sessao.status === 'loading', isError: false as const };
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

/** "Hoje" (AAAA-MM-DD) no fuso do tenant da sessão, lido no momento da chamada (RN-CORE-11; nunca a data UTC). */
export function useHojeDoTenant(): () => string {
  const fuso = useMe().data.tenant.timezone;
  return useCallback(() => hojeNoFuso(new Date(), fuso), [fuso]);
}


/**
 * Rotas do período (até 62 dias) de `GET /v1/core/rotas`, no formato do editor. Sem filtro de usuário, as dos
 * usuários visíveis (a API filtra pelo escopo, RN-CORE-04). Atualiza a cada `sync_auto_min` (30 min) ou pelo botão Atualizar da página (RN-CORE-23).
 */
export function useRoutes(f: RoutesFilter, enabled = true) {
  const authed = useAuthed();
  const hojeIso = useHojeDoTenant();
  return useQuery({
    queryKey: qk.routes(f),
    queryFn: async ({ signal }): Promise<RoutesResponse> => {
      const r = await api<unknown>('/core/rotas', { query: { de: f.from, ate: f.to, ...(f.seller_id ? { usuario_id: f.seller_id } : {}) }, signal });
      const hoje = hojeIso();
      return { start: { ...INICIO_PADRAO }, items: RotasListaSchema.parse(r).itens.map((i) => paraRouteDay(i, hoje)) };
    },
    enabled: authed && enabled && !!f.from,
    refetchInterval: intervaloSyncAutoMs(SYNC_AUTO_PADRAO_MIN), // RN-CORE-23 item 6: sync_auto_min (30, mín. 15); o botão Atualizar cobre o resto
    placeholderData: (prev) => prev,
  });
}

/** Carteira vigente do usuário (com lat/lng) para incluir clientes na rota. */
export function useSellerCustomers(sellerId: string | null) {
  const enabled = useAuthed() && !!sellerId;
  const hojeIso = useHojeDoTenant();
  return useQuery({
    queryKey: qk.sellerCustomers(sellerId ?? ''),
    queryFn: ({ signal }) => api<{ itens: ClienteDaCarteira[] }>(`/core/usuarios/${encodeURIComponent(sellerId ?? '')}/clientes`, { signal }).then((r) => r.itens.map((c) => clienteDaCarteira(c, hojeIso()))),
    enabled,
    staleTime: 5 * 60_000,
  });
}
