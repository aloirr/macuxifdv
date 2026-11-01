/**
 * `@macuxi/platform-sdk/react` — contexto do shell para telas de módulos (web e app; só depende de React).
 *
 * O shell (apps/web, apps/mobile) monta `<ShellProvider visao={...} motor={...}>`; as telas dos módulos
 * usam `usePode('pedido.criar')`, `<SePode acao="pedido.criar">…</SePode>`, `useExtensoes('cliente.acoes')`,
 * `useVisaoShell()`, `useMotorSync()` e `useAmbiente()`/`useHttp()` (HTTP com a sessão, sinal, UUID, usuário). Nos testes de componente basta envolver a tela num `ShellProvider` com uma visão
 * montada por `criarShell(...).montar(...)` (registro injetável — pedido do agente de testes).
 */
import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { ambienteIndisponivel, type AmbienteAparelho, type AmbienteModulo, type ClienteHttp } from '../ambiente';
import { completarAmbiente } from '../consultas';
import type { ModuloId } from '../nomes';
import type { EstadoMotorSync, MotorSync } from '../motor-sync';
import type { VisaoShell } from '../shell';
import type { ItemExtensao } from '../extensoes';

interface ValorShell {
  visao: VisaoShell<unknown>;
  motor: MotorSync | null;
  ambiente: AmbienteModulo;
}

const Ctx = createContext<ValorShell | null>(null);

const AMBIENTE_PADRAO = ambienteIndisponivel();

/**
 * `ambiente` padrão: o do motor (app) ou "indisponível" (offline, `http` lança `ErroSemConexao`).
 * O shell web passa o próprio ambiente (sem motor). `consultar` e `parametros` vêm do ambiente dado ou, se ele não os
 * tiver, do motor (ADR 0012; T-0029 E3); sem motor, consulta indisponível e parâmetros `{}`.
 */
export function ShellProvider({
  visao,
  motor = null,
  ambiente,
  children,
}: {
  visao: VisaoShell<unknown>;
  motor?: MotorSync | null;
  ambiente?: AmbienteAparelho | null;
  children: ReactNode;
}) {
  const valor = useMemo(
    () => ({
      visao,
      motor,
      ambiente: completarAmbiente(ambiente ?? motor?.ambiente ?? AMBIENTE_PADRAO, {
        consultar: ambiente?.consultar ?? motor?.ambiente.consultar,
        parametros: ambiente?.parametros ?? motor?.ambiente.parametros,
      }),
    }),
    [visao, motor, ambiente],
  );
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

function useValor(): ValorShell {
  const v = useContext(Ctx);
  if (!v) throw new Error('Tela de módulo fora do ShellProvider (o shell monta o provider; nos testes, envolva a tela).');
  return v;
}

export function useVisaoShell<C = unknown>(): VisaoShell<C> {
  return useValor().visao as VisaoShell<C>;
}

/** Permissão por ação (ADR 0004). Promotor nunca recebe ação de escrita de pedido (RN-PRO-01); leitura segue o manifesto. */
export function usePode(acao: string): boolean {
  return useValor().visao.pode(acao);
}

/** Itens de um slot de extensão de UI visíveis ao usuário (módulos efetivos, perfil e ação). */
export function useExtensoes<P = unknown>(slot: string): ItemExtensao<P>[] {
  return useValor().visao.extensoes<P>(slot);
}

/** Renderiza os filhos só se o usuário pode executar a ação; senão, `senao` (padrão: nada). */
export function SePode({ acao, children, senao = null }: { acao: string; children: ReactNode; senao?: ReactNode }) {
  return <>{usePode(acao) ? children : senao}</>;
}

const ESTADO_VAZIO: EstadoMotorSync = {
  fila: [],
  aceitos: [],
  enviando: false,
  sincronizando: false,
  etapa: '',
  progresso: 0,
  erro: null,
  sincronizado_em: null,
  modulosAtivos: [],
  limpezaPendente: [],
  avisos: [],
  arquivos: [],
};

const semMotor = () => () => {};

/** Motor de sync do aparelho (null no web) e o estado dele, re-renderizando a cada mudança. */
export function useMotorSync(): { motor: MotorSync | null; estado: EstadoMotorSync } {
  const { motor } = useValor();
  const estado = useSyncExternalStore(
    motor ? (cb) => motor.assinar(cb) : semMotor,
    () => (motor ? motor.estado() : ESTADO_VAZIO),
    () => (motor ? motor.estado() : ESTADO_VAZIO),
  );
  return { motor, estado };
}

/**
 * Ambiente do aparelho/navegador: `http` (sessão do shell; respeita o modo sem sinal), `online()`, `novoId()`,
 * `usuario()`, `consultar(def, entrada)` (ADR 0012) e `parametros(modulo)`. Sempre devolve um ambiente: antes do login
 * é o "indisponível" (offline).
 */
export function useAmbiente(): AmbienteModulo {
  return useValor().ambiente;
}

/** Parâmetros do tenant do módulo (ex.: alçadas do Vendedor), da última sessão: valem offline (T-0029 E3). */
export function useParametros(modulo: ModuloId): Readonly<Record<string, unknown>> {
  return useValor().ambiente.parametros(modulo);
}

/** Atalho para `useAmbiente().http`. */
export function useHttp(): ClienteHttp {
  return useValor().ambiente.http;
}
