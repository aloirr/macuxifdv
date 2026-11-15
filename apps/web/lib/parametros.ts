/**
 * Página Parâmetros do BKO (ADR 0058): funções puras do shell.
 */
import type { SecaoParametrosVisivel } from '@macuxi/platform-sdk';

/** `/parametros` sem seção abre a primeira seção não bloqueada (ou a primeira, se todas estiverem bloqueadas); null sem seção. */
export function secaoInicialParametros<C>(secoes: readonly SecaoParametrosVisivel<C>[]): SecaoParametrosVisivel<C> | null {
  return secoes.find((s) => !s.bloqueado) ?? secoes[0] ?? null;
}
