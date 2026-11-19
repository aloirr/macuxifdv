// Abre o Chromium dos geradores de simulação de docs/design (pedido-aprovacao, menu-parametros, alertas-parametros).
// Playwright do repositório; se o navegador dele não estiver instalado, o Playwright global da sessão (sem instalar nada).
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

export async function abrirNavegador() {
  try {
    return await require('playwright').chromium.launch();
  } catch {
    const global = join(execSync('npm root -g').toString().trim(), 'playwright');
    return await require(global).chromium.launch();
  }
}
