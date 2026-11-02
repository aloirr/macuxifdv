'use client';

/**
 * Consultas das páginas do Gestor no BKO (`/v1/gestor/*`, T-0055). Toda resposta é validada no contrato. A sessão vem
 * do login do Core (perfil e fuso do tenant). RN-CORE-23: sem consulta periódica curta. As páginas buscam ao abrir, ao
 * voltar para a aba do navegador (padrão do react-query) e no botão "Atualizar"; só o painel de aprovação (item 6)
 * atualiza sozinho, a cada `sync_auto_min` (padrão 30 min, mínimo 15 — o BKO ainda não expõe o parâmetro do tenant).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, useSession } from '@macuxi/platform-sdk/web';
import { DEFAULT_TZ } from '@macuxi/ui/web';
import { Alerta, FilaAprovacao, ListaAlertas, RankingEquipe, RegraAlerta, RegrasAlertaResposta, ROTAS_GESTOR, VisaoEquipe, type AjusteRegraAlerta, type TipoAlerta } from '../../contracts';
import { intervaloAutomaticoMs } from '../../domain/sincronizacao';
import { paraQuery, type FiltrosAlertas, type FiltrosPainel, type FiltrosRanking } from './filtros';

const qk = {
  equipe: (f: FiltrosPainel) => ['gestor', 'equipe', f] as const,
  ranking: (f: FiltrosRanking) => ['gestor', 'ranking', f] as const,
  fila: ['gestor', 'aprovacoes'] as const,
  alertas: (f: FiltrosAlertas) => ['gestor', 'alertas', f] as const,
  regras: ['gestor', 'regras'] as const,
};

function useLogado() {
  return useSession().status === 'authenticated';
}

export function useFusoDoTenant(): string {
  return useSession<{ fuso?: string }>().user?.fuso ?? DEFAULT_TZ;
}

export function useVisaoEquipe(f: FiltrosPainel) {
  return useQuery({ queryKey: qk.equipe(f), enabled: useLogado(), queryFn: async ({ signal }) => VisaoEquipe.parse(await api<unknown>(ROTAS_GESTOR.equipe, { query: paraQuery(f), signal })) });
}

export function useRanking(f: FiltrosRanking) {
  return useQuery({ queryKey: qk.ranking(f), enabled: useLogado(), queryFn: async ({ signal }) => RankingEquipe.parse(await api<unknown>(ROTAS_GESTOR.ranking, { query: paraQuery(f), signal })) });
}

export function useFila() {
  return useQuery({ queryKey: qk.fila, enabled: useLogado(), refetchInterval: intervaloAutomaticoMs(undefined), queryFn: async ({ signal }) => FilaAprovacao.parse(await api<unknown>(ROTAS_GESTOR.aprovacoes, { signal })) });
}

export function useAlertas(f: FiltrosAlertas) {
  return useQuery({ queryKey: qk.alertas(f), enabled: useLogado(), queryFn: async ({ signal }) => ListaAlertas.parse(await api<unknown>(ROTAS_GESTOR.alertas, { query: paraQuery(f), signal })) });
}

export function useDispensarAlerta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => Alerta.parse(await api<unknown>(ROTAS_GESTOR.dispensarAlerta(id), { method: 'POST' })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gestor', 'alertas'] }),
  });
}

export function useRegras(habilitado: boolean) {
  return useQuery({ queryKey: qk.regras, enabled: useLogado() && habilitado, queryFn: async ({ signal }) => RegrasAlertaResposta.parse(await api<unknown>(ROTAS_GESTOR.regras, { signal })).regras });
}

export function useAjustarRegra() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ tipo, ajuste }: { tipo: TipoAlerta; ajuste: AjusteRegraAlerta }) => RegraAlerta.parse(await api<unknown>(ROTAS_GESTOR.regra(tipo), { method: 'PUT', body: ajuste })),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.regras }),
  });
}
