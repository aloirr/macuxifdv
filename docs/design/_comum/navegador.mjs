// Abre o Chromium dos geradores de simulação de docs/design (pedido-aprovacao, menu-parametros, alertas-parametros, tracking).
// Playwright do repositório; se o navegador dele não estiver instalado, o Playwright global da sessão (sem instalar nada).
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

export async function abrirNavegador() {
  try {
    return await require('playwright').chromium.launch();
  } catch {
    const global = join(execSync('npm root -g').toString().trim(), 'playwright');
    return await require(global).chromium.launch();
  }
}

// Grava cada prancha (HTML e PNG em escala 2) na pasta `aqui` e lê a conferência de sobreposição que a página publica em
// body[data-info] quando marca body[data-pronto="1"]. `telas`: { nome: [html, largura?, altura?] } (padrão 800×900).
// Sai com código 1 se alguma prancha tiver conflito.
export async function gerarPranchas(aqui, telas) {
  const browser = await abrirNavegador();
  let falhou = false;
  for (const [nome, [html, w, h]] of Object.entries(telas)) {
    const arq = join(aqui, `${nome}.html`);
    writeFileSync(arq, html);
    const page = await browser.newPage({ viewport: { width: w || 800, height: h || 900 }, deviceScaleFactor: 2 });
    await page.goto(pathToFileURL(arq).href);
    await page.waitForSelector('body[data-pronto="1"]');
    const info = JSON.parse(await page.evaluate(() => document.body.dataset.info));
    if (info.conflitos.length) falhou = true;
    await page.screenshot({ path: join(aqui, `${nome}.png`), fullPage: true });
    console.log(nome, JSON.stringify({ conflitos: info.conflitos }));
    await page.close();
  }
  await browser.close();
  if (falhou) process.exit(1);
}
