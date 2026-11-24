// Apoio dos prints da jornada AM2808 (reprodução local). Senhas de teste lidas de fora do repositório.
const { chromium } = require(process.env.MACUXI_PLAYWRIGHT ?? '/opt/node-tools/node_modules/playwright');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const SENHAS = JSON.parse(readFileSync(process.env.MACUXI_SENHAS ?? '/home/user/jornada/senhas.json', 'utf8'));
const TELAS = join(__dirname, '..', 'telas');
const BKO = process.env.MACUXI_BKO ?? 'http://127.0.0.1:3000';
const PORTAL = process.env.MACUXI_PORTAL ?? 'http://config.localhost:3000';
const CSS = 'nextjs-portal{display:none!important}';
async function abrir() {
  const navegador = await chromium.launch();
  const ctx = await navegador.newContext({ viewport: { width: 1366, height: 860 }, deviceScaleFactor: 2, timezoneId: 'America/Manaus', locale: 'pt-BR' });
  const p = await ctx.newPage();
  p.on('load', () => p.addStyleTag({ content: CSS }).catch(() => {}));
  return { navegador, ctx, p };
}
async function print(p, nome, op = {}) {
  await p.addStyleTag({ content: CSS }).catch(() => {});
  await p.waitForTimeout(op.espera ?? 600);
  await p.screenshot({ path: join(TELAS, `${nome}.png`), fullPage: op.inteira ?? true, ...(op.clip ? { clip: op.clip } : {}) });
  console.log('print', nome);
}
/** Troca a chave em claro por máscara antes do print (a chave nunca aparece em tela salva). */
async function mascararChaves(p) {
  await p.evaluate(() => {
    const re = /mxk_[A-Za-z0-9_-]+/g;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (re.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(re, 'mxk_••••••••••••••••••••••••(mascarada)');
    for (const i of document.querySelectorAll('input,textarea')) if (/mxk_/.test(i.value)) i.value = 'mxk_••••(mascarada)';
  });
}
async function entrarPortal(p) {
  await p.goto(`${PORTAL}/entrar`, { waitUntil: 'networkidle' });
  await p.getByLabel('E-mail').fill('time@macuxi-teste.com.br');
  await p.getByTestId('entrar.senha').fill(SENHAS.super);
  await p.getByRole('button', { name: 'Entrar' }).click();
  await p.waitForURL('**/empresas');
}
module.exports = { abrir, print, mascararChaves, entrarPortal, SENHAS, TELAS, BKO, PORTAL };
async function entrarBko(p, email = 'admin@thathyany-teste.com.br', senha = SENHAS.admin) {
  await p.goto(`${BKO}/login`, { waitUntil: 'networkidle' });
  await p.getByLabel('Código da empresa').fill('thathyany-teste');
  await p.getByLabel('E-mail').fill(email);
  await p.getByTestId('login.senha').fill(senha);
  await p.getByTestId('login.entrar').click();
  await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  await p.waitForLoadState('networkidle');
}
module.exports.entrarBko = entrarBko;
