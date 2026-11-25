/**
 * Playwright do e2e do portal (`apps/web/e2e`), contra o `next dev` no modo falso, já de pé:
 * `NEXT_PUBLIC_PORTAL_FALSO=1 pnpm --filter web exec next dev -p 3311` (ou `next build` + `next start -p 3311`). Navegador:
 * `PW_CHROMIUM` (ex.: o Chromium da sessão em `/opt/pw-browsers`) ou o do Playwright.
 * Rodar: `pnpm exec playwright test -c apps/web/e2e/playwright.config.mjs --trace off` (um host só: `--project fdv`).
 *
 * ADR 0071 (v1.0.33): os specs do portal rodam nos dois hosts que valem até o corte, um projeto por host:
 * - `config`: o host antigo `config.localhost` (portal na raiz, o `proxy.ts` reescreve para `/config`);
 * - `fdv`: o `fdv.localhost` (portal por caminho, em `/config`).
 * O `enderecos.spec.ts` (raiz → `/bko`, `/login`, `/config/entrar` e o 404 no `bko.`) usa endereços completos e roda uma vez.
 * Os `bko-*.spec.ts` (projeto `bko`, v1.0.34) rodam no `fdv.localhost`, com a API do BKO respondida pelo `page.route`.
 * Os `*.localhost` vão para o 127.0.0.1 (o Chromium já resolve; a regra abaixo garante). Prints em `docs/prints` só com
 * `E2E_PRINTS=1` (`enderecos.ts`).
 */
const executablePath = process.env.PW_CHROMIUM;
const PORTA = process.env.PORTAL_PORTA ?? '3311';
const PORTAL = ['portal-*.spec.ts'];

export default {
  testDir: '.',
  timeout: 240000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    headless: true,
    trace: 'off',
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ['--host-resolver-rules=MAP *.localhost 127.0.0.1'],
    },
  },
  projects: [
    { name: 'config', testMatch: PORTAL, metadata: { prefixoDoPortal: '' }, use: { baseURL: `http://config.localhost:${PORTA}` } },
    { name: 'fdv', testMatch: PORTAL, metadata: { prefixoDoPortal: '/config' }, use: { baseURL: `http://fdv.localhost:${PORTA}` } },
    { name: 'enderecos', testMatch: ['enderecos.spec.ts'], metadata: { porta: PORTA } },
    { name: 'bko', testMatch: ['bko-*.spec.ts'], use: { baseURL: `http://fdv.localhost:${PORTA}` } },
  ],
};
