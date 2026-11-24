/**
 * Endereços do web na v1.0.33 (ADR 0071), com os hosts antigos ainda de pé: no `fdv.` a raiz vai para o Início do BKO (`/bko`),
 * o `/login` do BKO abre e o portal abre por caminho (`/config/entrar`), com a CSP estrita e sem erro de CSP no console; no
 * `config.` antigo o portal segue na raiz, com a mesma CSP; no `bko.` antigo o `/config` dá 404.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const porta = () => (test.info().project.metadata as { porta?: string }).porta ?? '3311';
const url = (host: string, caminho: string) => `http://${host}:${porta()}${caminho}`;

/** Pedido HTTP fora do navegador: o Node não resolve `*.localhost`, então vai ao 127.0.0.1 com o host no `x-forwarded-host` (como o túnel). */
const pedir = (request: APIRequestContext, host: string, caminho: string) =>
  request.get(`http://127.0.0.1:${porta()}${caminho}`, { maxRedirects: 0, headers: { 'x-forwarded-host': host } });

/** Mensagens de violação de CSP no console da página. */
function violacoesDeCsp(page: Page): string[] {
  const lista: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to (execute|load|apply|evaluate)/i.test(m.text())) lista.push(m.text());
  });
  page.on('pageerror', (e) => {
    if (/Content Security Policy|unsafe-eval/i.test(e.message)) lista.push(e.message);
  });
  return lista;
}

test('fdv.: a raiz vai para /bko e o /login do BKO abre', async ({ page, request }) => {
  const raiz = await pedir(request, 'fdv.localhost', '/');
  expect(raiz.status()).toBe(307);
  expect(new URL(raiz.headers()['location'] ?? '', 'http://x').pathname).toBe('/bko');
  await page.goto(url('fdv.localhost', '/'));
  await expect(page).toHaveURL(/\/(bko|login)(\?|$)/, { timeout: 60000 });
  const login = await page.goto(url('fdv.localhost', '/login'));
  expect(login?.status()).toBe(200);
  expect(login?.headers()['content-security-policy']).toBeUndefined();
  await expect(page.getByRole('button', { name: /entrar/i }).first()).toBeVisible({ timeout: 60000 });
});

test('fdv.: /config/entrar abre o portal, sem 404 e sem erro de CSP', async ({ page }) => {
  const erros = violacoesDeCsp(page);
  const r = await page.goto(url('fdv.localhost', '/config/entrar'));
  expect(r?.status()).toBe(200);
  const csp = r?.headers()['content-security-policy'] ?? '';
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(r?.headers()['x-robots-tag']).toBe('noindex, nofollow');
  expect(r?.headers()['cache-control']).toBe('no-store');
  await expect(page.getByTestId('entrar.email')).toBeVisible({ timeout: 60000 });
  // hidratado (os scripts do Next rodaram com o nonce): o "Mostrar senha" troca o campo, sem servidor (vale no next start, sem o
  // modo falso)
  await page.getByTestId('entrar.senha').fill('certa-123');
  await expect(async () => {
    await page.getByRole('button', { name: 'Mostrar senha' }).click();
    await expect(page.getByTestId('entrar.senha')).toHaveAttribute('type', 'text', { timeout: 1000 });
  }).toPass({ timeout: 60000 });
  expect(erros).toEqual([]);
});

test('config. (antigo): o portal segue na raiz, com a CSP', async ({ page }) => {
  const erros = violacoesDeCsp(page);
  const r = await page.goto(url('config.localhost', '/entrar'));
  expect(r?.status()).toBe(200);
  expect(r?.headers()['content-security-policy'] ?? '').toMatch(/script-src 'self' 'nonce-/);
  await expect(page.getByTestId('entrar.email')).toBeVisible({ timeout: 60000 });
  expect(erros).toEqual([]);
});

test('bko. (antigo): /config dá 404 e a raiz vai para /bko', async ({ request, page }) => {
  expect((await pedir(request, 'bko.localhost', '/config/entrar')).status()).toBe(404);
  const raiz = await pedir(request, 'bko.localhost', '/');
  expect(raiz.status()).toBe(307);
  expect(new URL(raiz.headers()['location'] ?? '', 'http://x').pathname).toBe('/bko');
  // no navegador, com o host de verdade
  expect((await page.goto(url('bko.localhost', '/config')))?.status()).toBe(404);
});

test('rotas que o workflow de produção confere depois do deploy respondem 200', async ({ request }) => {
  for (const [host, caminho] of [
    ['bko.localhost', '/login'],
    ['config.localhost', '/login'],
  ] as const) {
    expect((await pedir(request, host, caminho)).status(), `${host}${caminho}`).toBe(200);
  }
});
