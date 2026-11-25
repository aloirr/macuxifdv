/** Apoio comum dos e2e do BKO (tests/e2e/bko). */
import type { Page } from '@playwright/test';

/** Na sanfona do menu lateral, abre o grupo (`nav-grupo-<id>`) se estiver fechado; com tudo aberto o título não tem `aria-expanded`. */
export async function abrirGrupo(page: Page, id: string): Promise<void> {
  const titulo = page.getByTestId('menu-bko').getByTestId(`nav-grupo-${id}`);
  if ((await titulo.getAttribute('aria-expanded')) === 'false') await titulo.click();
}
