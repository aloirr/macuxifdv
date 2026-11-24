'use client';

/**
 * Consultas do monitor do Hub (T-0051), só nas rotas `/v1/integracao/*`. As do monitor usam o cliente do painel (`cliente.tsx`: no BKO,
 * o JWT do usuário; no portal, a sessão do super-admin com o tenant); as do de-para são só do BKO. A API confere licença do módulo,
 * perfil por ação do manifesto e o tenant. A resposta é validada pelo contrato (Zod) antes de chegar à tela.
 *  - `GET  /v1/integracao/monitor` (`monitor.ver`) → `MonitorResumo`
 *  - `GET  /v1/integracao/monitor/detalhes` (só o super-admin, portal) → `MonitorDetalhes`
 *  - `GET  /v1/integracao/lotes/{id}/erros` (`monitor.ver`) → `ErrosLoteResposta` (contrato em `contracts/bko.ts`)
 *  - `POST /v1/integracao/lotes/{id}/cancelar` (`lote.cancelar`) e `POST /v1/integracao/lotes/{id}/reprocessar` (RN-INT-15/16)
 *  - `GET  /v1/integracao/lotes/autorizadores` e `GET /v1/integracao/mapeamentos/codigos-macuxi` (`monitor.ver`)
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MeusModulosRespostaSchema } from '@macuxi/core/contracts';
import type { Perfil } from '@macuxi/platform-sdk';
import { api, useSession } from '@macuxi/platform-sdk/web';
import { DEFAULT_TZ, intervaloSyncAutoMs, PARAMETRO_SYNC_AUTO, SYNC_AUTO_PADRAO_MIN } from '@macuxi/ui/web';
import {
  AutorizadoresResposta,
  CancelarLoteResposta,
  CodigosMacuxiResposta,
  ErrosLoteResposta,
  GravarMapeamentoResposta,
  MapeamentosResposta,
  MonitorDetalhes,
  MonitorResumo,
  ROTA_MONITOR,
  ROTA_MONITOR_DETALHES,
  ReprocessarLoteResposta,
  type LinhaErro,
  type Mapeamento,
  type TipoMapeamento,
} from '../../contracts';
import { perfilDaSessao } from './apresentacao';
import { useClienteIntegracao, useEscopoIntegracao, type ClienteIntegracao } from './cliente';
import { paraSeNaoForDoLote } from './reprocessar-lotes';

/**
 * RN-CORE-23: o monitor atualiza pelo `sync_auto_min` do tenant (padrão 30 min, mínimo 15), lido de `parametros.core` em
 * `/v1/me/modulos`; fora isso, só o botão "Atualizar". Esta constante é o padrão enquanto a consulta carrega.
 */
export const MONITOR_REFETCH_MS = intervaloSyncAutoMs(SYNC_AUTO_PADRAO_MIN);
export const ERROS_POR_PAGINA = 100;
/** CSV de erros: páginas de 500 (máximo do contrato) até este teto de linhas. */
export const CSV_ERROS_MAX = 20_000;

/** Chaves do cache; as do monitor levam o escopo do cliente (BKO ou a empresa no portal) para não misturar tenants. */
export const qk = {
  monitor: (escopo: string) => ['integracao', escopo, 'monitor'] as const,
  detalhes: (escopo: string) => ['integracao', escopo, 'monitor', 'detalhes'] as const,
  syncAutoMin: (escopo: string) => ['integracao', escopo, 'sync-auto-min'] as const,
  mapeamentos: ['integracao', 'mapeamentos'] as const,
  autorizadores: (escopo: string) => ['integracao', escopo, 'autorizadores'] as const,
  codigosMacuxi: (tipo: string) => ['integracao', 'codigos-macuxi', tipo] as const,
  erros: (escopo: string, loteId: string, codigo: string) => ['integracao', escopo, 'lote', loteId, 'erros', codigo] as const,
};

/** Prefixo de tudo o que o painel guardou no cache para um cliente: o portal invalida depois de zerar ou reprocessar. */
export const chaveDoCacheIntegracao = (escopo: string) => ['integracao', escopo] as const;

export interface SessaoDoBko {
  perfil: Perfil | null;
  fuso: string;
}

/** Perfil e fuso do tenant do login real (Core). */
export function useSessaoDoBko(): SessaoDoBko {
  const s = useSession<{ perfil?: string | null; fuso?: string }>();
  return { perfil: perfilDaSessao(s.user?.perfil), fuso: s.user?.fuso ?? DEFAULT_TZ };
}

function useAutenticado() {
  return useSession().status === 'authenticated';
}

/** `sync_auto_min` do tenant (RN-CORE-23) em `/v1/me/modulos` (BKO); o portal passa o intervalo no cliente. Enquanto carrega ou se falhar, vale o padrão. */
export function useIntervaloSyncAutoMs(explicito?: ClienteIntegracao): number {
  const cliente = useClienteIntegracao(explicito);
  const enabled = cliente.ativo && cliente.intervaloMs === undefined;
  const q = useQuery({
    queryKey: qk.syncAutoMin(cliente.escopo),
    enabled,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const r = MeusModulosRespostaSchema.parse(await api<unknown>('/me/modulos', { signal }));
      return intervaloSyncAutoMs(r.modulos.find((m) => m.id === 'core')?.parametros?.[PARAMETRO_SYNC_AUTO]);
    },
  });
  return cliente.intervaloMs ?? q.data ?? MONITOR_REFETCH_MS;
}

/** Resumo do monitor; o cliente vem do painel em volta ou por parâmetro (o cabeçalho do BKO, fora do painel). */
export function useMonitor(explicito?: ClienteIntegracao) {
  const cliente = useClienteIntegracao(explicito);
  const intervalo = useIntervaloSyncAutoMs(cliente);
  return useQuery({
    queryKey: qk.monitor(cliente.escopo),
    queryFn: async ({ signal }) => MonitorResumo.parse(await cliente.chamar<unknown>(ROTA_MONITOR, { signal })),
    enabled: cliente.ativo,
    // timer-permitido: sync_auto_min do tenant passado por intervaloSyncAutoMs (nunca abaixo de 15 min)
    refetchInterval: intervalo,
    placeholderData: (prev) => prev,
  });
}

/**
 * Detalhe por entidade e por Conector (só o super-admin; aba Integração da empresa no portal). Atualiza junto com o monitor. O portal
 * chama fora do painel, com o mesmo cliente que passa a ele.
 */
export function useMonitorDetalhes(cliente?: ClienteIntegracao) {
  const c = useClienteIntegracao(cliente);
  const intervalo = useIntervaloSyncAutoMs(c);
  return useQuery({
    queryKey: qk.detalhes(c.escopo),
    queryFn: async ({ signal }) => MonitorDetalhes.parse(await c.chamar<unknown>(ROTA_MONITOR_DETALHES, { signal })),
    enabled: c.ativo,
    // timer-permitido: o mesmo intervalo do monitor (sync_auto_min do tenant ou o do portal)
    refetchInterval: intervalo,
    placeholderData: (prev) => prev,
  });
}

const caminhoErros = (loteId: string) => `/integracao/lotes/${encodeURIComponent(loteId)}/erros`;

/** Erros por linha de um lote, paginados ("Carregar mais"), com filtro opcional por código. */
export function useErrosLote(loteId: string | null, codigo: string) {
  const cliente = useClienteIntegracao();
  const enabled = cliente.ativo && !!loteId;
  return useInfiniteQuery({
    queryKey: qk.erros(cliente.escopo, loteId ?? '', codigo),
    queryFn: async ({ pageParam, signal }) =>
      ErrosLoteResposta.parse(await cliente.chamar<unknown>(caminhoErros(loteId ?? ''), { query: { pagina: pageParam, por_pagina: ERROS_POR_PAGINA, codigo: codigo || undefined }, signal })),
    initialPageParam: 1,
    getNextPageParam: (ultima, todas) => (todas.length * ERROS_POR_PAGINA < ultima.total ? todas.length + 1 : undefined),
    enabled,
  });
}

/** Todos os erros do lote (mesmo filtro da tela) para o CSV, em páginas de 500 até `CSV_ERROS_MAX`. */
export async function buscarTodosErros(chamar: ClienteIntegracao['chamar'], loteId: string, codigo: string): Promise<{ itens: LinhaErro[]; total: number; truncado: boolean }> {
  const itens: LinhaErro[] = [];
  let total = 0;
  for (let pagina = 1; itens.length < CSV_ERROS_MAX; pagina++) {
    const r = ErrosLoteResposta.parse(await chamar<unknown>(caminhoErros(loteId), { query: { pagina, por_pagina: 500, codigo: codigo || undefined } }));
    total = r.total;
    itens.push(...r.itens);
    if (r.itens.length === 0 || itens.length >= r.total) break;
  }
  return { itens, total, truncado: itens.length < total };
}

/** De-para de códigos (T-0120): lista e condições do Macuxi sem correspondente. */
export function useMapeamentos() {
  const enabled = useAutenticado();
  return useQuery({
    queryKey: qk.mapeamentos,
    queryFn: async ({ signal }) => MapeamentosResposta.parse(await api<unknown>('/integracao/mapeamentos', { signal })),
    enabled,
    placeholderData: (prev) => prev,
  });
}

/** O que gravar/apagar um mapeamento invalida: a lista do de-para e o monitor do escopo do cliente (pedidos retidos liberados). */
export const chavesAposMapeamento = (escopo: string) => [qk.mapeamentos, qk.monitor(escopo)] as const;

function useInvalidarAposMapeamento() {
  const qc = useQueryClient();
  const escopo = useEscopoIntegracao();
  return () => Promise.all(chavesAposMapeamento(escopo).map((queryKey) => qc.invalidateQueries({ queryKey })));
}

/** Grava (cria ou atualiza pelo código do ERP) e libera os pedidos retidos que passam a montar. */
export function useGravarMapeamento() {
  const invalidar = useInvalidarAposMapeamento();
  return useMutation({
    mutationFn: async (entrada: Mapeamento) => GravarMapeamentoResposta.parse(await api<unknown>('/integracao/mapeamentos', { method: 'PUT', body: entrada })),
    onSettled: invalidar,
  });
}

export function useApagarMapeamento() {
  const invalidar = useInvalidarAposMapeamento();
  return useMutation({
    mutationFn: async (id: string) => {
      await api<unknown>(`/integracao/mapeamentos/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    onSettled: invalidar,
  });
}

/** O prefixo `qk.monitor` cobre também os detalhes do portal. */
const encerrarAcaoDeLote = (qc: ReturnType<typeof useQueryClient>, escopo: string) => qc.invalidateQueries({ queryKey: qk.monitor(escopo) });

/** Cancelar lote em andamento (RN-INT-15): 409 se ele já terminou. */
export function useCancelarLote() {
  const qc = useQueryClient();
  const cliente = useClienteIntegracao();
  return useMutation({
    mutationFn: async (loteId: string) => CancelarLoteResposta.parse(await cliente.chamar<unknown>(`/integracao/lotes/${encodeURIComponent(loteId)}/cancelar`, { method: 'POST', body: {} })),
    onSettled: () => encerrarAcaoDeLote(qc, cliente.escopo),
  });
}

/** Reprocessar lote (RN-INT-15). Sem `lote.reprocessar`, leva o autorizador e a senha dele (RN-INT-16); a senha só vai no corpo da chamada. */
export function useReprocessarLote() {
  const qc = useQueryClient();
  const cliente = useClienteIntegracao();
  return useMutation({
    mutationFn: async ({ loteId, autorizadorId, senha }: { loteId: string; autorizadorId?: string; senha?: string }) =>
      ReprocessarLoteResposta.parse(
        await cliente.chamar<unknown>(`/integracao/lotes/${encodeURIComponent(loteId)}/reprocessar`, {
          method: 'POST',
          body: autorizadorId && senha ? { autorizador_id: autorizadorId, senha } : {},
        }),
      ),
    // a senha do autorizador está nas `variables`: sem `gcTime: 0` ela ficaria no MutationCache por 5 min
    gcTime: 0,
    onSettled: () => encerrarAcaoDeLote(qc, cliente.escopo),
  });
}

/** Quem pode autorizar o reprocessamento (admin e analista ativos); só carrega quando o popup abre. */
export function useAutorizadores(ativo: boolean) {
  const cliente = useClienteIntegracao();
  const enabled = cliente.ativo && ativo;
  return useQuery({
    queryKey: qk.autorizadores(cliente.escopo),
    queryFn: async ({ signal }) => AutorizadoresResposta.parse(await cliente.chamar<unknown>('/integracao/lotes/autorizadores', { signal })),
    enabled,
    staleTime: 60_000,
  });
}

/** Códigos do Macuxi da entidade do De-para (condição de pagamento vem do Vendedor). */
export function useCodigosMacuxi(tipo: TipoMapeamento, ativo: boolean) {
  const enabled = useAutenticado() && ativo;
  return useQuery({
    queryKey: qk.codigosMacuxi(tipo),
    queryFn: async ({ signal }) => CodigosMacuxiResposta.parse(await api<unknown>('/integracao/mapeamentos/codigos-macuxi', { query: { tipo }, signal })),
    enabled,
    staleTime: 60_000,
  });
}

/** O erro é a recusa de quem não tem `lote.reprocessar` (a tela abre a autorização por senha)? */
export const precisaAutorizador = (e: unknown): boolean => codigoDoErro(e) === 'autorizador_necessario';
/** Erro que interrompe a fila do reprocessamento (RN-INT-16). */
export const paraAFila = (e: unknown): boolean => paraSeNaoForDoLote(codigoDoErro(e));

/** Código do erro da API (`senha_incorreta`, `muitas_tentativas`…) ou vazio: `code` no cliente do BKO, `codigo` no do portal. */
export function codigoDoErro(e: unknown): string {
  if (!(e instanceof Error)) return '';
  const { code, codigo } = e as { code?: unknown; codigo?: unknown };
  return typeof code === 'string' ? code : typeof codigo === 'string' ? codigo : '';
}
