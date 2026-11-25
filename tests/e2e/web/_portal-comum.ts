/**
 * Auxiliares comuns dos e2e do portal e do menu do usuário (`menu-usuario-paginas.spec.ts` e `portal-01b-04-api.spec.ts`).
 */
import { expect, type Page, type Route } from '@playwright/test';

/** Os dois hosts do portal (ADR 0071): `config.` na raiz e `fdv./config`. */
export const hostsDoPortal = (porta: string) =>
  [
    { nome: 'config.', base: `http://config.localhost:${porta}` },
    { nome: 'fdv./config', base: `http://fdv.localhost:${porta}/config` },
  ] as const;

/** Empresa Distribuidora Uma. */
export const UMA = '0b6f1a52-5c1e-4c4e-9a43-000000000001';

export const json = (route: Route, status: number, corpo?: unknown) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: status === 204 || corpo === undefined ? '' : JSON.stringify(corpo),
  });

export async function semDevOverlay(page: Page) {
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' }).catch(() => undefined);
}

export async function entrarNoPortal(page: Page, base: string, email: string) {
  await page.goto(`${base}/entrar`);
  await page.getByTestId('entrar.email').fill(email);
  await page.getByTestId('entrar.senha').fill('Senha#Forte2026');
  await page.getByTestId('entrar.entrar').click();
  await expect(page.getByTestId('menu-usuario.botao')).toBeVisible({ timeout: 90000 });
  await semDevOverlay(page);
}

export async function abrirMenu(page: Page) {
  await expect(async () => {
    if (!(await page.getByTestId('menu-usuario.lista').isVisible()))
      await page.getByTestId('menu-usuario.botao').click();
    await expect(page.getByTestId('menu-usuario.lista')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30000 });
}

/** Nenhuma chave ou valor com cara de token de renovação no armazenamento da página (T-0117). */
export async function semTokenDeRenovacao(page: Page) {
  const tudo = await page.evaluate(() => {
    const ler = (s: Storage) =>
      Array.from({ length: s.length }, (_, i) => {
        const k = s.key(i) ?? '';
        return `${k}=${s.getItem(k) ?? ''}`;
      });
    return [...ler(localStorage), ...ler(sessionStorage)].join('\n');
  });
  expect(tudo).not.toMatch(/refresh/i);
  expect(tudo).not.toMatch(/renovac/i);
}
