// Gera os PNGs da simulação "Trocar senha" (docs/design/trocar-senha/png/). Uso: node docs/design/trocar-senha/gerar-png.cjs
const path = require('path');
const { chromium } = require('playwright');

const NOMES = {
  t01: '01-perfil-entrada',
  t02: '02-trocar-senha-ao-abrir',
  t03: '03-digitando',
  t04: '04-senhas-nao-conferem',
  t05: '05-senha-atual-errada',
  t06: '06-sem-internet',
  t07: '07-sucesso',
  t08: '08-esqueci-a-senha',
  t09: '09-esqueci-pedido-feito',
};

(async () => {
  const pasta = __dirname;
  // usa o chromium já instalado na sessão (PW_CHROMIUM) quando o do pacote não existe
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 1640, height: 1000 }, deviceScaleFactor: 2 });
  await page.goto('file://' + path.join(pasta, 'telas.html'));
  await page.evaluate(() => document.fonts.ready);
  for (const [id, nome] of Object.entries(NOMES)) {
    await page.locator(`#${id} .phone`).screenshot({ path: path.join(pasta, 'png', `${nome}.png`) });
  }
  await page.screenshot({ path: path.join(pasta, 'png', '00-prancha.png'), fullPage: true });
  await browser.close();
})();
