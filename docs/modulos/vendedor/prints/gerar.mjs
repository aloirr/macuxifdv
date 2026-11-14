// Prints (360x800, deviceScaleFactor 2) da folha "Adicionar ao orçamento" do Catálogo (R-20261114-151000).
// Maquete em HTML com os tokens do app (packages/ui: cores e fontes da marca v1); o repositório não tem render react-native-web.
// Uso, na raiz: node docs/modulos/vendedor/prints/gerar.mjs   (saída nesta pasta). Nomes e números são fictícios.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FONTES = join(process.cwd(), 'apps/web/app/fonts');
const { chromium } = createRequire(import.meta.url)('playwright');

const css = `
@font-face{font-family:Archivo;font-weight:800;src:url(file://${FONTES}/Archivo_800ExtraBold.ttf)}
@font-face{font-family:'IBM Plex Sans';font-weight:400;src:url(file://${FONTES}/IBMPlexSans_400Regular.ttf)}
@font-face{font-family:'IBM Plex Sans';font-weight:600;src:url(file://${FONTES}/IBMPlexSans_600SemiBold.ttf)}
*{box-sizing:border-box;margin:0;padding:0}
body{width:360px;height:800px;background:#F8F6F1;font-family:'IBM Plex Sans';color:#16202A;position:relative;overflow:hidden}
.faixa{background:#1E3350;color:#fff;padding:36px 16px 14px}
.voltar{font-size:13px;color:#C9CED5;min-height:24px}
.titulo{font:800 22px Archivo;margin-top:4px}
.corpo{padding:16px;display:flex;flex-direction:column;gap:14px}
.produto{font-weight:600;font-size:14px;color:#4A5562}
.cartao{background:#fff;border:1px solid #DFE2E6;border-radius:14px;overflow:hidden}
.linha{min-height:64px;padding:12px 14px;display:flex;flex-direction:column;justify-content:center;gap:3px}
.linha+.linha{border-top:1px solid #ECEEF1}
.l1{display:flex;justify-content:space-between;gap:10px}
.n{font-weight:600;font-size:15px}.d{font-size:13px;color:#4A5562;font-variant-numeric:tabular-nums}
.l2{display:flex;align-items:center;gap:8px;font-size:13px;color:#4A5562}.l2 span{flex:1}.l2 i{color:#5B6673;font-style:normal}
.vazio{margin-top:120px;text-align:center;padding:0 32px}
.vazio b{font:800 18px Archivo;display:block;margin-top:14px;color:#16202A}
.ic{width:56px;height:56px;border-radius:16px;background:#DFE2E6;margin:0 auto;display:flex;align-items:center;justify-content:center;font-size:26px}
.aviso{position:absolute;left:16px;right:16px;bottom:28px;background:#E2F1EA;color:#1D6B4F;border-radius:12px;padding:14px;font-weight:600;font-size:14px}
`;
const cab = `<div class="faixa"><div class="voltar">‹ Voltar</div><div class="titulo">Adicionar ao orçamento</div></div>`;
const tela = (corpo, extra = '') => `<!doctype html><meta charset="utf-8"><style>${css}</style>${cab}${corpo}${extra}`;
const linha = (n, d, c) => `<div class="linha"><div class="l1"><span class="n">${n}</span><span class="d">${d}</span></div><div class="l2"><span>${c}</span><i>›</i></div></div>`;

const lista = tela(`<div class="corpo"><div class="produto">AGU-1500 · Água sanitária 1,5 L</div><div class="cartao">${[
  linha('Nº 000042', '13/11/2026', 'Atacadinho Boa Vista'),
  linha('Orçamento', '12/11/2026', 'Mercantil Rio Branco'),
  linha('Nº 000037', '09/11/2026', 'Supermercado Pedra Pintada'),
].join('')}</div></div>`);
const confirmacao = tela(`<div class="corpo"><div class="produto">AGU-1500 · Água sanitária 1,5 L</div><div class="cartao">${[
  linha('Nº 000042', '13/11/2026', 'Atacadinho Boa Vista'),
  linha('Orçamento', '12/11/2026', 'Mercantil Rio Branco'),
].join('')}</div></div>`, `<div class="aviso">Adicionado ao orçamento nº 000042</div>`);
const vazio = tela(`<div class="vazio"><div class="ic">▤</div><b>Nenhum orçamento em aberto.</b></div>`);

const navegador = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const pagina = await navegador.newPage({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 2 });
for (const [nome, html] of [['folha-orcamentos', lista], ['folha-confirmacao', confirmacao], ['folha-vazio', vazio]]) {
  await pagina.setContent(html);
  await pagina.evaluate(() => document.fonts.ready);
  await pagina.screenshot({ path: join(AQUI, `${nome}.png`) });
}
await navegador.close();
