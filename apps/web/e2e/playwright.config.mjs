/**
 * Playwright do e2e do portal config. (`apps/web/e2e`), contra o `next dev` no modo falso, já de pé:
 * `NEXT_PUBLIC_PORTAL_FALSO=1 pnpm --filter web exec next dev -p 3311`. Navegador: `PW_CHROMIUM` (ex.: o Chromium da sessão
 * em `/opt/pw-browsers`) ou o do Playwright. Rodar: `pnpm exec playwright test -c apps/web/e2e/playwright.config.mjs --trace off`.
 */
const executablePath = process.env.PW_CHROMIUM;

export default {
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 240000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.PORTAL_URL ?? 'http://config.localhost:3311',
    headless: true,
    trace: 'off',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
};
