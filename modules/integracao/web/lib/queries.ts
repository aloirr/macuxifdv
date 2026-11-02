'use client';

/**
 * Consultas do monitor do Hub no BKO (T-0051), só nas rotas `/v1/integracao/*` (JWT do usuário; a API confere licença do módulo,
 * perfil por ação do manifesto e o tenant do token). A resposta é validada pelo contrato (Zod) antes de chegar à tela.
 *  - `GET  /v1/integracao/monitor` (`monitor.ver`) → `MonitorResumo`
 *  - `GET  /v1/integracao/lotes/{id}/erros` (`monitor.ver`) → `ErrosLoteResposta` (contrato em `contracts/bko.ts`)
 *  - `POST /v1/integracao/inativacoes/{id}/decidir` (`inativacao.decidir`, P-3) → `DecidirInativacaoResposta`
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { relogioReal } from '@macuxi/comum/relogio';
import type { Perfil } from '@macuxi/platform-sdk';
import { api, useSession } from '@macuxi/platform-sdk/web';
import { DEFAULT_TZ } from '@macuxi/ui/web';
import { DecidirInativacaoResposta, ErrosLoteResposta, MonitorResumo, type DecidirInativacaoEntrada, type LinhaErro } from '../../contracts';
import { perfilDaSessao } from './apresentacao';

/** O monitor atualiza sozinho a cada 30 s (o sinal de vida do Conector é a cada 1 min). */
export const MONITOR_REFETCH_MS = 30_000;
export const ERROS_POR_PAGINA = 100;
/** CSV de erros: páginas de 500 (máximo do contrato) até este teto de linhas. */
export const CSV_ERROS_MAX = 20_000;

export const qk = {
  monitor: ['integracao', 'monitor'] as const,
  erros: (loteId: string, codigo: string) => ['integracao', 'lote', loteId, 'erros', codigo] as const,
};

const relogio = relogioReal();

/** "Agora" da tela, renovado a cada 30 s (o tempo desde o último sinal anda sem recarregar). */
export function useAgora(intervaloMs = MONITOR_REFETCH_MS): Date {
  const [agora, setAgora] = useState(() => relogio.agora());
  useEffect(() => {
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

export function useMonitor() {
  const enabled = useAutenticado();
  return useQuery({
    queryKey: qk.monitor,
    queryFn: async ({ signal }) => MonitorResumo.parse(await api<unknown>('/integracao/monitor', { signal })),
    enabled,
    refetchInterval: MONITOR_REFETCH_MS,
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

/** Confirmar ou recusar a inativação em massa (RN-INT-06, P-3). Atualiza o monitor ao terminar. */
export function useDecidirInativacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, entrada }: { id: string; entrada: DecidirInativacaoEntrada }) =>
      DecidirInativacaoResposta.parse(await api<unknown>(`/integracao/inativacoes/${encodeURIComponent(id)}/decidir`, { method: 'POST', body: entrada })),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.monitor }),
  });
}
