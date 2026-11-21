'use client';

/**
 * Consultas do SHELL web (copiadas de lib/queries.ts da Fase M). As consultas de tela de módulo
 * (faróis de pedidos e clientes, metas, planos, alçadas, rotas…) vão para `modules/<m>/web` na B2
 * (desenho T-0001 §5 e §14).
 */
import { queryOptions, useQuery } from '@tanstack/react-query';
import { MeusModulosRespostaSchema, type Me } from '@macuxi/core/contracts';
import {
  AuditoriaRespostaSchema,
  empresaDosParametros,
  logoQueSubstituiAMarca,
  modulosEfetivos,
  ocultarMarcaMacuxiDosParametros,
  parametrosDosModulos,
  ROTA_AUDITORIA,
  rotaLogoDoAparelho,
  type LogoDoAparelho,
  type ModuloId,
  type ParametrosModulos,
  type Perfil,
} from '@macuxi/platform-sdk';
import { api, apiFetch, ApiRequestError, MODO_API } from '@macuxi/platform-sdk/web';
import { intervaloSyncAutoMs, PARAMETRO_SYNC_AUTO, SYNC_AUTO_PADRAO_MIN } from '@macuxi/ui/web';
import { MANIFESTOS_WEB } from './modulos';
import { semV1 } from './portal-rotas';
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

export interface ModulosDoUsuario {
  ids: ModuloId[];
  /** `parametros.core.sync_auto_min` do tenant (RN-CORE-23), ou `undefined` (vale o padrão de 30 min). */
  syncAutoMin: unknown;
  /** `empresa_logo` dos parâmetros do Core (T-0182), ou `null` (sem logo ou servidor anterior: o PDF usa a padrão). */
  logo: LogoDoAparelho | null;
  /** `empresa_ocultar_marca_macuxi` (item 15, v1.0.17): com a logo, o shell mostra só a do cliente. */
  ocultarMarcaMacuxi: boolean;
  /**
   * ADR 0060: `modulos_contratados` (módulos ativos na EMPRESA, sem o recorte do perfil), só para a vitrine sem licença do
   * BKO (Pesquisa, Trade, Treinamento com cadeado). Ausente (servidor anterior): nada aparece desativado.
   */
  contratados?: ModuloId[];
  /**
   * D-PAR-04: `modulos[].parametros` do tenant, por módulo, para o `useParametros` das páginas (ambiente do shell,
   * `lib/ambiente.ts`). Módulo fora da resposta não tem entrada (RN-CORE-02); servidor anterior (404) = `{}`.
   */
  parametros: ParametrosModulos;
}

/**
 * Uma consulta só a `GET /v1/me/modulos` (cache do React Query, chave `qk.modulos`): os efetivos, o `sync_auto_min` e a
 * logo da empresa saem dela. O ambiente das páginas (`lib/ambiente.ts`, PDF) lê a logo pela mesma chave (`fetchQuery`).
 */
export function consultaMeusModulos(perfil: Perfil | null) {
  return queryOptions({
    queryKey: [...qk.modulos, perfil],
    staleTime: 60_000,
    queryFn: async (): Promise<ModulosDoUsuario> => {
      try {
        const r = MeusModulosRespostaSchema.parse(await api<unknown>('/me/modulos'));
        const core = r.modulos.find((m) => m.id === 'core')?.parametros;
        return {
          ids: r.modulos.map((m) => m.id),
          syncAutoMin: core?.[PARAMETRO_SYNC_AUTO],
          logo: empresaDosParametros(core)?.logo ?? null,
          ocultarMarcaMacuxi: ocultarMarcaMacuxiDosParametros(core),
          ...(r.modulos_contratados ? { contratados: r.modulos_contratados } : {}),
          parametros: parametrosDosModulos(r),
        };
      } catch (e) {
        if (!(e instanceof ApiRequestError) || e.status !== 404 || !perfil) throw e;
        return {
          ids: modulosEfetivos({
            manifestos: MANIFESTOS_WEB,
            ativosNoTenant: MANIFESTOS_WEB.map((m) => m.id),
            doPerfil: MANIFESTOS_WEB.filter((m) => m.perfis.includes(perfil)).map((m) => m.id),
          }),
          syncAutoMin: undefined,
          logo: null,
          ocultarMarcaMacuxi: false,
          parametros: {},
        };
      }
    },
  });
}

function useMeusModulos<T>(perfil: Perfil | null, select: (d: ModulosDoUsuario) => T) {
  return useQuery({ ...consultaMeusModulos(perfil), enabled: useAuthed() && !!perfil, select });
}

const soIds = (d: ModulosDoUsuario) => d.ids;
const soContratados = (d: ModulosDoUsuario) => d.contratados;
const soParametros = (d: ModulosDoUsuario) => d.parametros;
/** Item 15: a logo do cliente que substitui a do Macuxi no shell; `null` = a do Macuxi (chave desligada ou sem logo). */
const logoDoShell = (d: ModulosDoUsuario): LogoDoAparelho | null => logoQueSubstituiAMarca(d.ocultarMarcaMacuxi, d.logo);
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
 * ADR 0060: módulos contratados pela empresa (`modulos_contratados` de `GET /v1/me/modulos`, mesma consulta dos efetivos);
 * `undefined` enquanto carrega ou quando a API não manda o campo (nada aparece desativado). Só exibição (RN-CORE-01).
 */
export function useModulosContratados(perfil: Perfil | null): ModuloId[] | undefined {
  return useMeusModulos(perfil, soContratados).data;
}

/**
 * D-PAR-04: parâmetros do tenant por módulo (`modulos[].parametros` de `GET /v1/me/modulos`, mesma consulta dos efetivos,
 * sem segunda chamada: RD-0700); `undefined` enquanto carrega.
 */
export function useParametrosDosModulos(perfil: Perfil | null): ModulosDoUsuario['parametros'] | undefined {
  return useMeusModulos(perfil, soParametros).data;
}

/**
 * Bytes da logo da empresa (`GET /v1/me/empresa/logo/:sha256`), em cache pelo sha256: o shell (item 15) e o PDF (T-0182,
 * `lib/ambiente.ts`) usam a mesma consulta, sem baixar a logo duas vezes.
 */
export function consultaLogoDaEmpresa(sha: string) {
  return queryOptions({
    queryKey: ['empresa-logo', sha] as const,
    queryFn: async (): Promise<Blob> => (await apiFetch(semV1(rotaLogoDoAparelho(sha)))).blob(),
    staleTime: Infinity,
  });
}

/**
 * Item 15 (v1.0.17): com `empresa_ocultar_marca_macuxi` ligada e a logo da empresa, os bytes da logo (`GET /v1/me/empresa/logo/:sha256`,
 * cache pelo sha256) para o shell mostrar só a logo do cliente. `null` = mostra a do Macuxi (também enquanto carrega ou sem rede).
 */
export function useLogoQueSubstituiAMarca(perfil: Perfil | null): Blob | null {
  const logo = useMeusModulos(perfil, logoDoShell).data ?? null;
  const bytes = useQuery({ ...consultaLogoDaEmpresa(logo?.sha256 ?? ''), enabled: logo !== null });
  return logo ? (bytes.data ?? null) : null;
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
