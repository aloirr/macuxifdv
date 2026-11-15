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
import { DiscountPolicy, FormasEPrazosResposta, FreteParametros, PedidosPage, Transportadora } from '../../contracts';
import { z } from 'zod';
import { type FiltrosTransportadoras, queryDosFiltrosTransportadoras } from './transportadoras';
import { type FiltrosPedidos, paraQuery } from './filtros-url';

/**
 * RN-CORE-23 (T-0054): sem consulta periódica própria. As listas atualizam ao abrir, ao voltar o foco para a janela
 * (`refetchOnWindowFocus` do shell), depois de cada decisão (`useAtualizarPedidos`) e pelo botão "Atualizar".
 */
export const POR_PAGINA = 50;

export const qk = {
  pedidos: (f: FiltrosPedidos) => ['vendedor', 'pedidos', f] as const,
  pendentes: ['vendedor', 'pedidos', 'pendentes'] as const,
  pedido: (id: string) => ['vendedor', 'pedido', id] as const,
  alcadas: ['vendedor', 'alcadas'] as const,
  decisoes: ['vendedor', 'decisoes'] as const,
  transportadoras: (f: FiltrosTransportadoras) => ['vendedor', 'transportadoras', f] as const,
  digitadas: ['vendedor', 'transportadoras', 'digitadas'] as const,
  frete: ['vendedor', 'frete', 'parametros'] as const,
  formasEPrazos: ['vendedor', 'formas-pagamento'] as const,
};

const ListaTransportadoras = z.object({ itens: z.array(Transportadora) });
export const Digitada = z.object({ nome: z.string(), documento: z.string(), telefone: z.string().nullable(), pedidos: z.number() });
export type Digitada = z.infer<typeof Digitada>;

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
      PedidosPage.parse(await api<unknown>('/vendedor/pedidos', { query: { ...paraQuery(f), limite: POR_PAGINA, sem_pendentes: '1', ...(pageParam ? { cursor: pageParam } : { totais: '1' }) }, signal })),
    initialPageParam: '' as string,
    getNextPageParam: (ultima) => ultima.proximo_cursor ?? undefined,
    enabled,
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
  });
}

/** Transportadoras do tenant (RN-VEN-16), com os filtros da URL. */
export function useTransportadoras(f: FiltrosTransportadoras) {
  const enabled = useAuthed();
  return useQuery({
    queryKey: qk.transportadoras(f),
    queryFn: async ({ signal }) => ListaTransportadoras.parse(await api<unknown>('/vendedor/transportadoras', { query: queryDosFiltrosTransportadoras(f), signal })).itens,
    enabled,
  });
}

/** Digitadas pelos vendedores nos pedidos e ainda fora do cadastro (para o BKO cadastrar). */
export function useTransportadorasDigitadas() {
  const enabled = useAuthed();
  return useQuery({
    queryKey: qk.digitadas,
    queryFn: async ({ signal }) => z.object({ itens: z.array(Digitada) }).parse(await api<unknown>('/vendedor/transportadoras/digitadas', { signal })).itens,
    enabled,
  });
}

/** Padrão do frete do tenant (CIF quando não configurado). */
export function useFreteParametros() {
  const enabled = useAuthed();
  return useQuery({ queryKey: qk.frete, queryFn: async ({ signal }) => FreteParametros.parse(await api<unknown>('/vendedor/frete/parametros', { signal })), enabled });
}

/** Formas de pagamento e prazos do tenant (RN-VEN-24, T-0089), ativos e inativos. */
export function useFormasEPrazos() {
  const enabled = useAuthed();
  return useQuery({ queryKey: qk.formasEPrazos, queryFn: async ({ signal }) => FormasEPrazosResposta.parse(await api<unknown>('/vendedor/formas-pagamento', { signal })), enabled });
}
