/**
 * Endereços do portal nos e2e (ADR 0071, v1.0.33): o mesmo spec roda no host antigo `config.localhost` (portal na raiz) e no
 * `fdv.localhost` (portal em `/config`), pelos projetos do `playwright.config.mjs`. `urlDoPortal('/entrar')` monta o caminho do
 * projeto em execução; os prints só vão para `apps/web/docs/prints` com `E2E_PRINTS=1` e no projeto `fdv` (senão, para a pasta
 * do teste).
 */
import { fileURLToPath } from 'node:url';
import { test } from '@playwright/test';

/** Caminho do portal no host do projeto: `/entrar` no `config.`, `/config/entrar` no `fdv.`. */
export function urlDoPortal(caminho: string): string {
  const prefixo = (test.info().project.metadata as { prefixoDoPortal?: string } | undefined)?.prefixoDoPortal ?? '';
  return `${prefixo}${caminho}`;
}

/** Pasta dos prints: a de `docs/prints/<pasta>` com `E2E_PRINTS=1` no projeto `fdv` (um PNG por tela); senão, a saída do teste (fora do git). */
export function pastaDosPrints(pasta: string): string {
  if (process.env.E2E_PRINTS === '1' && test.info().project.name === 'fdv') return fileURLToPath(new URL(`../docs/prints/${pasta}`, import.meta.url));
  return test.info().outputPath(pasta);
}
