'use client';

/**
 * Consultas do monitor do Hub no BKO (T-0051), só nas rotas `/v1/integracao/*` (JWT do usuário; a API confere licença do módulo,
 * perfil por ação do manifesto e o tenant do token). A resposta é validada pelo contrato (Zod) antes de chegar à tela.
 *  - `GET  /v1/integracao/monitor` (`monitor.ver`) → `MonitorResumo`
 *  - `GET  /v1/integracao/lotes/{id}/erros` (`monitor.ver`) → `ErrosLoteResposta` (contrato em `contracts/bko.ts`)
 *  - `POST /v1/integracao/lotes/{id}/cancelar` (`lote.cancelar`) e `POST /v1/integracao/lotes/{id}/reprocessar` (RN-INT-15/16)
 *  - `GET  /v1/integracao/lotes/autorizadores` e `GET /v1/integracao/mapeamentos/codigos-macuxi` (`monitor.ver`)
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { MeusModulosRespostaSchema } from '@macuxi/core/contracts';
import { relogioReal } from '@macuxi/comum/relogio';
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
  MonitorResumo,
  ReprocessarLoteResposta,
  type LinhaErro,
  type Mapeamento,
  type TipoMapeamento,
} from '../../contracts';
import { perfilDaSessao } from './apresentacao';

/**
 * RN-CORE-23: o monitor atualiza pelo `sync_auto_min` do tenant (padrão 30 min, mínimo 15), lido de `parametros.core` em
 * `/v1/me/modulos`; fora isso, só o botão "Atualizar". Esta constante é o padrão enquanto a consulta carrega.
 */
export const MONITOR_REFETCH_MS = intervaloSyncAutoMs(SYNC_AUTO_PADRAO_MIN);
export const ERROS_POR_PAGINA = 100;
/** CSV de erros: páginas de 500 (máximo do contrato) até este teto de linhas. */
export const CSV_ERROS_MAX = 20_000;

export const qk = {
  monitor: ['integracao', 'monitor'] as const,
  mapeamentos: ['integracao', 'mapeamentos'] as const,
  autorizadores: ['integracao', 'autorizadores'] as const,
  codigosMacuxi: (tipo: string) => ['integracao', 'codigos-macuxi', tipo] as const,
  erros: (loteId: string, codigo: string) => ['integracao', 'lote', loteId, 'erros', codigo] as const,
};

const relogio = relogioReal();

/** "Agora" da tela, renovado no intervalo do tenant (o tempo desde o último sinal anda sem recarregar). */
export function useAgora(intervaloInformadoMs?: number): Date {
  // T-0140: o hook roda SEMPRE (antes ficava no valor padrão do parâmetro, que o React vê como chamada condicional)
  const intervaloDoTenantMs = useIntervaloSyncAutoMs();
  const intervaloMs = intervaloInformadoMs ?? intervaloDoTenantMs;
  const [agora, setAgora] = useState(() => relogio.agora());
  useEffect(() => {
    // timer-permitido: sync_auto_min do tenant passado por intervaloSyncAutoMs (nunca abaixo de 15 min)
    const t = setInterval(() => setAgora(relogio.agora()), intervaloMs);
    return () => clearInterval(t);
  }, [intervaloMs]);
  return agora;
}

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

/** `sync_auto_min` do tenant (RN-CORE-23) em `/v1/me/modulos`; enquanto carrega ou se falhar, vale o padrão. */
export function useIntervaloSyncAutoMs(): number {
  const enabled = useAutenticado();
  const q = useQuery({
    queryKey: ['integracao', 'sync-auto-min'] as const,
    enabled,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const r = MeusModulosRespostaSchema.parse(await api<unknown>('/me/modulos', { signal }));
      return intervaloSyncAutoMs(r.modulos.find((m) => m.id === 'core')?.parametros?.[PARAMETRO_SYNC_AUTO]);
    },
  });
  return q.data ?? MONITOR_REFETCH_MS;
}

export function useMonitor() {
  const enabled = useAutenticado();
  const intervalo = useIntervaloSyncAutoMs();
  return useQuery({
    queryKey: qk.monitor,
    queryFn: async ({ signal }) => MonitorResumo.parse(await api<unknown>('/integracao/monitor', { signal })),
    enabled,
    // timer-permitido: sync_auto_min do tenant passado por intervaloSyncAutoMs (nunca abaixo de 15 min)
    refetchInterval: intervalo,
    placeholderData: (prev) => prev,
  });
}

const caminhoErros = (loteId: string) => `/integracao/lotes/${encodeURIComponent(loteId)}/erros`;

/** Erros por linha de um lote, paginados ("Carregar mais"), com filtro opcional por código. */
export function useErrosLote(loteId: string | null, codigo: string) {
  const enabled = useAutenticado() && !!loteId;
  return useInfiniteQuery({
    queryKey: qk.erros(loteId ?? '', codigo),
    queryFn: async ({ pageParam, signal }) =>
      ErrosLoteResposta.parse(await api<unknown>(caminhoErros(loteId ?? ''), { query: { pagina: pageParam, por_pagina: ERROS_POR_PAGINA, codigo: codigo || undefined }, signal })),
    initialPageParam: 1,
    getNextPageParam: (ultima, todas) => (todas.length * ERROS_POR_PAGINA < ultima.total ? todas.length + 1 : undefined),
    enabled,
  });
}

/** Todos os erros do lote (mesmo filtro da tela) para o CSV, em páginas de 500 até `CSV_ERROS_MAX`. */
export async function buscarTodosErros(loteId: string, codigo: string): Promise<{ itens: LinhaErro[]; total: number; truncado: boolean }> {
  const itens: LinhaErro[] = [];
  let total = 0;
  for (let pagina = 1; itens.length < CSV_ERROS_MAX; pagina++) {
    const r = ErrosLoteResposta.parse(await api<unknown>(caminhoErros(loteId), { query: { pagina, por_pagina: 500, codigo: codigo || undefined } }));
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

/** Grava (cria ou atualiza pelo código do ERP) e libera os pedidos retidos que passam a montar. */
export function useGravarMapeamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entrada: Mapeamento) => GravarMapeamentoResposta.parse(await api<unknown>('/integracao/mapeamentos', { method: 'PUT', body: entrada })),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: qk.mapeamentos }), qc.invalidateQueries({ queryKey: qk.monitor })]),
  });
}

export function useApagarMapeamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api<unknown>(`/integracao/mapeamentos/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: qk.mapeamentos }), qc.invalidateQueries({ queryKey: qk.monitor })]),
  });
}

const encerrarAcaoDeLote = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: qk.monitor });

/** Cancelar lote em andamento (RN-INT-15): 409 se ele já terminou. */
export function useCancelarLote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (loteId: string) => CancelarLoteResposta.parse(await api<unknown>(`/integracao/lotes/${encodeURIComponent(loteId)}/cancelar`, { method: 'POST', body: {} })),
    onSettled: () => encerrarAcaoDeLote(qc),
  });
}

/** Reprocessar lote (RN-INT-15). Sem `lote.reprocessar`, leva o autorizador e a senha dele (RN-INT-16); a senha só vai no corpo da chamada. */
export function useReprocessarLote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ loteId, autorizadorId, senha }: { loteId: string; autorizadorId?: string; senha?: string }) =>
      ReprocessarLoteResposta.parse(
        await api<unknown>(`/integracao/lotes/${encodeURIComponent(loteId)}/reprocessar`, {
          method: 'POST',
          body: autorizadorId && senha ? { autorizador_id: autorizadorId, senha } : {},
        }),
      ),
    onSettled: () => encerrarAcaoDeLote(qc),
  });
}

/** Quem pode autorizar o reprocessamento (admin e analista ativos); só carrega quando o popup abre. */
export function useAutorizadores(ativo: boolean) {
  const enabled = useAutenticado() && ativo;
  return useQuery({
    queryKey: qk.autorizadores,
    queryFn: async ({ signal }) => AutorizadoresResposta.parse(await api<unknown>('/integracao/lotes/autorizadores', { signal })),
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
export function precisaAutorizador(e: unknown): boolean {
  return e instanceof Error && 'code' in e && (e as { code?: unknown }).code === 'autorizador_necessario';
}

/** Código do erro da API (`senha_incorreta`, `muitas_tentativas`…) ou vazio. */
export function codigoDoErro(e: unknown): string {
  return e instanceof Error && 'code' in e && typeof (e as { code?: unknown }).code === 'string' ? (e as { code: string }).code : '';
}
