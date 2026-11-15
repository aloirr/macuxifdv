'use client';

/**
 * Consultas de Parâmetros › Alertas (T-0180): valores das regras da equipe (`/v1/gestor/parametros/alertas`), módulos
 * ativos (`/v1/me/modulos`, RN-CORE-03) e os parâmetros do Core da Produtividade do dia, no formato do contrato do Core:
 * `GET|PUT /core/parametros/alertas-produtividade` (`alertas.produtividade`), `inicio.parado_min` lido em
 * `GET /core/parametros/inicio` e gravado em `PUT /core/parametros/parado-min` (D1, RN-CORE-26).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CAMINHO_PARAMETRO_PARADO_MIN,
  CAMINHO_PARAMETROS_ALERTAS_PRODUTIVIDADE,
  MeusModulosRespostaSchema,
  ParametroParadoMinSchema,
  ParametrosAlertasProdutividadeSchema,
  ParametrosInicioSchema,
  type ParametrosAlertasProdutividade,
} from '@macuxi/core/contracts';
import { api, useSession } from '@macuxi/platform-sdk/web';
import { ParametrosAlertasEquipe, ROTAS_GESTOR } from '../../contracts';

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

/** Parâmetro `alertas.produtividade` do Core (com os padrões D6 enquanto o tenant não salvou). */
export function useParametrosProdutividade() {
  return useQuery({
    queryKey: qk.produtividade,
    enabled: useLogado(),
    queryFn: async ({ signal }) => ParametrosAlertasProdutividadeSchema.parse(await api<unknown>(`/core/${CAMINHO_PARAMETROS_ALERTAS_PRODUTIVIDADE}`, { signal })),
  });
}

export function useGravarParametrosProdutividade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: ParametrosAlertasProdutividade) => ParametrosAlertasProdutividadeSchema.parse(await api<unknown>(`/core/${CAMINHO_PARAMETROS_ALERTAS_PRODUTIVIDADE}`, { method: 'PUT', body: v })),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.produtividade }),
  });
}

/** `inicio.parado_min` (só leitura aqui; a gravação é `useGravarParadoMin`). */
export function useParadoMin() {
  return useQuery({ queryKey: qk.inicio, enabled: useLogado(), queryFn: async ({ signal }) => ParametrosInicioSchema.parse(await api<unknown>('/core/parametros/inicio', { signal })).parado_min });
}

export function useGravarParadoMin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (parado_min: number) => ParametroParadoMinSchema.parse(await api<unknown>(`/core/${CAMINHO_PARAMETRO_PARADO_MIN}`, { method: 'PUT', body: { parado_min } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.inicio }),
  });
}
