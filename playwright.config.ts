/**
 * Playwright do agente `testes` (T-0028): e2e do BKO contra a demo local (API real em 8100 + `pnpm --filter web dev`).
 * Não sobe servidor: a demo (`scripts\demo\subir-demo.ps1 -SemTunel`) e o BKO precisam estar no ar.
 * `MACUXI_BKO_URL` (padrão http://localhost:3000) · `MACUXI_PW_CANAL` (padrão `chrome`: usa o Chrome instalado,
 * sem baixar navegador; vazio = Chromium do Playwright).
 */
import { defineConfig } from '@playwright/test';

const canal = process.env.MACUXI_PW_CANAL ?? 'chrome';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.MACUXI_BKO_URL ?? 'http://localhost:3000',
    ...(canal ? { channel: canal } : {}),
    headless: true,
    trace: 'retain-on-failure',
  },
});
