'use client';

/**
 * Consultas do SHELL web (copiadas de lib/queries.ts da Fase M). As consultas de tela de módulo
 * (faróis de pedidos e clientes, metas, planos, alçadas, rotas…) vão para `modules/<m>/web` na B2
 * (desenho T-0001 §5 e §14).
 */
import { useQuery } from '@tanstack/react-query';
import { MeusModulosRespostaSchema, type Me } from '@macuxi/core/contracts';
import { AuditoriaRespostaSchema, modulosEfetivos, ROTA_AUDITORIA, type ModuloId, type Perfil } from '@macuxi/platform-sdk';
import { api, ApiRequestError, MODO_API } from '@macuxi/platform-sdk/web';
import { intervaloSyncAutoMs, PARAMETRO_SYNC_AUTO, SYNC_AUTO_PADRAO_MIN } from '@macuxi/ui/web';
import { MANIFESTOS_WEB } from './modulos';
import { useSessao } from './session';

/**
 * Atualização automática das consultas do shell (RN-CORE-23 item 6, `sync_auto_min`): padrão 30 min, nunca abaixo de 15.
 * O valor do tenant vem de `/v1/me/modulos` (`useIntervaloSyncAutoMs`); esta constante é o padrão enquanto carrega.
 * Fora isso, só o botão "Atualizar" da página. O React Query só refaz com a aba em foco (`refetchIntervalInBackground` fica false).
 */
export const LIVE_REFETCH_MS = intervaloSyncAutoMs(SYNC_AUTO_PADRAO_MIN);

export interface ListResponse<T> {
  items: T[];
  next_cursor: string | null;
}

export const qk = {
  me: ['me'] as const,
  modulos: ['me', 'modulos'] as const,
  auditoria: (entidade: string) => ['plataforma', 'auditoria', entidade] as const,
};

function useAuthed() {
  return useSessao().status === 'authenticated';
}

/** `GET /v1/me` do mock-api (demonstração). Na API real o usuário e a empresa vêm do login (`useSessao`). */
export function useMe() {
  const enabled = useAuthed() && MODO_API === 'demo';
  return useQuery({ queryKey: qk.me, queryFn: () => api<Me>('/me'), enabled, staleTime: 60_000 });
}

interface ModulosDoUsuario {
  ids: ModuloId[];
  /** `parametros.core.sync_auto_min` do tenant (RN-CORE-23), ou `undefined` (vale o padrão de 30 min). */
  syncAutoMin: unknown;
}

/** Uma consulta só a `GET /v1/me/modulos` (cache do React Query): os efetivos e o `sync_auto_min` saem dela. */
function useMeusModulos<T>(perfil: Perfil | null, select: (d: ModulosDoUsuario) => T) {
  const enabled = useAuthed() && !!perfil;
  return useQuery({
    queryKey: [...qk.modulos, perfil],
    enabled,
    staleTime: 60_000,
    select,
    queryFn: async (): Promise<ModulosDoUsuario> => {
      try {
        const r = MeusModulosRespostaSchema.parse(await api<unknown>('/me/modulos'));
        return { ids: r.modulos.map((m) => m.id), syncAutoMin: r.modulos.find((m) => m.id === 'core')?.parametros?.[PARAMETRO_SYNC_AUTO] };
      } catch (e) {
        if (!(e instanceof ApiRequestError) || e.status !== 404 || !perfil) throw e;
        return {
          ids: modulosEfetivos({
            manifestos: MANIFESTOS_WEB,
            ativosNoTenant: MANIFESTOS_WEB.map((m) => m.id),
            doPerfil: MANIFESTOS_WEB.filter((m) => m.perfis.includes(perfil)).map((m) => m.id),
          }),
          syncAutoMin: undefined,
        };
      }
    },
  });
}

const soIds = (d: ModulosDoUsuario) => d.ids;
const soIntervalo = (d: ModulosDoUsuario) => intervaloSyncAutoMs(d.syncAutoMin);

/**
 * Módulos efetivos do usuário (RN-CORE-01/03) — `GET /v1/me/modulos`, checado a cada carga (não fica no token).
 * O mock-api da Fase M não tem a rota (404): enquanto isso o shell calcula com `modulosEfetivos`
 * supondo todos os módulos instalados ativos no tenant e o padrão do perfil (`manifest.perfis`).
 */
export function useModulosEfetivos(perfil: Perfil | null) {
  return useMeusModulos(perfil, soIds);
}

/**
 * RN-CORE-23 item 6: intervalo (ms) da atualização automática do BKO, pelo `parametros.core.sync_auto_min` do tenant
 * em `/v1/me/modulos` (padrão 30 min, mínimo 15). Enquanto a consulta carrega, vale o padrão (`LIVE_REFETCH_MS`).
 */
export function useIntervaloSyncAutoMs(): number {
  const perfil = useSessao().user?.perfil ?? null;
  return useMeusModulos(perfil, soIntervalo).data ?? LIVE_REFETCH_MS;
}

/**
 * Trilha de auditoria (RN-AUD-01): `GET /v1/auditoria` da plataforma (T-0030 D-B29). A API filtra pela licença dos
 * módulos e pelo escopo do perfil; aqui só a página mais recente (até 300 linhas).
 */
export function useAuditoria(entidade: string) {
  const enabled = useAuthed();
  const intervalo = useIntervaloSyncAutoMs();
  return useQuery({
    queryKey: qk.auditoria(entidade),
    queryFn: async () =>
      AuditoriaRespostaSchema.parse(await api<unknown>(ROTA_AUDITORIA.replace(/^\/v1/, ''), { query: { entidade, limite: 300 } })).itens,
    enabled,
    // timer-permitido: sync_auto_min do tenant passado por intervaloSyncAutoMs (nunca abaixo de 15 min)
    refetchInterval: intervalo,
  });
}
