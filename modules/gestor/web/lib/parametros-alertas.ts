'use client';

/**
 * Consultas de Parâmetros › Alertas (T-0180): valores das regras da equipe (`/v1/gestor/parametros/alertas`), módulos
 * ativos (`/v1/me/modulos`, RN-CORE-03) e o ADAPTADOR dos parâmetros do core (Produtividade do dia).
 *
 * ADAPTADOR TEMPORÁRIO do core: `GET|PUT /core/parametros/alertas-produtividade` (parâmetro `alertas.produtividade`, modulo-core,
 * branch `nuvem/T-0180-alertas-modulo-core`) e `inicio.parado_min` por `GET|PUT /core/parametros/inicio` (D1, RN-CORE-26). O tipo
 * local espelha o combinado; trocar pelo contrato do core (`parametrosAlertasProdutividadeSchema`) quando o PR do modulo-core
 * entrar. Antes disso a rota nova responde 404: a tela mostra os padrões da D6 e o erro aparece só ao salvar.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MeusModulosRespostaSchema, ParametrosInicioSchema } from '@macuxi/core/contracts';
import { ApiRequestError, api, useSession } from '@macuxi/platform-sdk/web';
import { ParametrosAlertasEquipe, ROTAS_GESTOR } from '../../contracts';
import { PARAMETROS_PRODUTIVIDADE_PADRAO, type ParametrosAlertasProdutividade } from '../../domain';

const CAMINHO_PRODUTIVIDADE = '/core/parametros/alertas-produtividade';
const CAMINHO_INICIO = '/core/parametros/inicio';
const qk = {
  equipe: ['gestor', 'parametros-alertas'] as const,
  modulos: ['gestor', 'me-modulos'] as const,
  produtividade: ['core', 'parametros', 'alertas-produtividade'] as const,
  inicio: ['core', 'parametros', 'inicio'] as const,
};
const useLogado = () => useSession().status === 'authenticated';

export function useParametrosAlertasEquipe() {
  return useQuery({ queryKey: qk.equipe, enabled: useLogado(), queryFn: async ({ signal }) => ParametrosAlertasEquipe.parse(await api<unknown>(ROTAS_GESTOR.parametrosAlertas, { signal })) });
}

export function useGravarParametrosAlertasEquipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: ParametrosAlertasEquipe) => ParametrosAlertasEquipe.parse(await api<unknown>(ROTAS_GESTOR.parametrosAlertas, { method: 'PUT', body: v })),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.equipe }),
  });
}

/** Módulos ativos do tenant (RN-CORE-03); `core` sempre. Enquanto carrega, `null`. */
export function useModulosAtivos(): ReadonlySet<string> | null {
  const q = useQuery({
    queryKey: qk.modulos,
    enabled: useLogado(),
    staleTime: 60_000,
    queryFn: async ({ signal }) => new Set<string>(['core', ...MeusModulosRespostaSchema.parse(await api<unknown>('/me/modulos', { signal })).modulos.map((m) => m.id)]),
  });
  return q.data ?? null;
}

/** Parâmetro de produtividade do core; rota ainda ausente (404) = padrões da D6. */
export function useParametrosProdutividade() {
  return useQuery({
    queryKey: qk.produtividade,
    enabled: useLogado(),
    queryFn: async ({ signal }): Promise<ParametrosAlertasProdutividade> => {
      try {
        return { ...PARAMETROS_PRODUTIVIDADE_PADRAO, ...(await api<Partial<ParametrosAlertasProdutividade>>(CAMINHO_PRODUTIVIDADE, { signal })) };
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 404) return PARAMETROS_PRODUTIVIDADE_PADRAO;
        throw e;
      }
    },
  });
}

export function useGravarParametrosProdutividade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: ParametrosAlertasProdutividade) => api<ParametrosAlertasProdutividade>(CAMINHO_PRODUTIVIDADE, { method: 'PUT', body: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.produtividade }),
  });
}

/** `inicio.parado_min` e a semana útil (o PUT do core leva os dois). */
export function useParametrosInicio() {
  return useQuery({ queryKey: qk.inicio, enabled: useLogado(), queryFn: async ({ signal }) => ParametrosInicioSchema.parse(await api<unknown>(CAMINHO_INICIO, { signal })) });
}

export function useGravarParadoMin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ atual, parado_min }: { atual: { dias_uteis_semana: number[] }; parado_min: number }) =>
      ParametrosInicioSchema.parse(await api<unknown>(CAMINHO_INICIO, { method: 'PUT', body: { dias_uteis_semana: atual.dias_uteis_semana, parado_min } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.inicio }),
  });
}
