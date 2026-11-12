// Ativos finais da marca Macuxi FDV, v1 (aprovada pelo Alexandre em 12/11/2026, T-0169):
// símbolo Monte Roraima, Azul noite #1E3350, fundo Pérola #F8F6F1, sol laranja #C2540A.
// O texto do logo vira contorno (opentype.js), então os SVG não dependem de fonte instalada.
//
// Uso (na raiz do repositório):
//   npm i --prefix /tmp/macuxi-ot opentype.js@1.3.4
//   OPENTYPE_DIR=/tmp/macuxi-ot node docs/marca/ativos/gerar-ativos.mjs
// Saída: docs/marca/ativos/2026-11-12-v1/ (SVG, PNG, contraste.json e a prancha ativos.png).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SAIDA = join(AQUI, '2026-11-12-v1');
const FONTES = join(process.cwd(), 'apps/web/app/fonts');
const requireOt = createRequire(process.env.OPENTYPE_DIR ? join(process.env.OPENTYPE_DIR, 'resolver.js') : import.meta.url);
const opentype = requireOt('opentype.js');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
mkdirSync(SAIDA, { recursive: true });

// ---------- paleta aprovada ----------
export const MARCA = {
  azulNoite: '#1E3350', azulClaro: '#9AA3B0', azulSuave: '#DFE2E6', claroNoAzul: '#C9CED5',
  perola: '#F8F6F1', branco: '#FFFFFF', grafite: '#16202A', ink2: '#4A5562', ink3: '#5B6673',
  sol: '#C2540A', solClaro: '#F59A52', preto: '#000000',
};
const M = MARCA;

// ---------- contraste (WCAG 2.x, a mesma conta de packages/ui/src/comum/contraste.ts) ----------
const canal = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (h) => { const n = h.replace('#', ''); const [r, g, b] = [0, 2, 4].map((i) => canal(parseInt(n.slice(i, i + 2), 16))); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contraste = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const PARES = [
  ['texto branco no Azul noite (botão, faixa do cabeçalho)', M.branco, M.azulNoite, 4.5],
  ['texto claro na faixa Azul noite (subtítulo)', M.claroNoAzul, M.azulNoite, 4.5],
  ['Azul noite no Pérola (link, título)', M.azulNoite, M.perola, 4.5],
  ['Azul noite no branco (link no cartão)', M.azulNoite, M.branco, 4.5],
  ['Azul noite no Azul suave (chip)', M.azulNoite, M.azulSuave, 4.5],
  ['grafite no Pérola (texto)', M.grafite, M.perola, 4.5],
  ['texto secundário no Pérola', M.ink2, M.perola, 4.5],
  ['texto de apoio no Pérola', M.ink3, M.perola, 4.5],
  ['Azul claro no grafite (menu do BKO, ícone do logo negativo)', M.azulClaro, M.grafite, 4.5],
  ['sol laranja no Pérola (gráfico: barra, sol do logo)', M.sol, M.perola, 3],
  ['sol laranja no branco (gráfico)', M.sol, M.branco, 3],
  ['sol claro no Azul noite (gráfico: sol do logo negativo)', M.solClaro, M.azulNoite, 3],
  ['serra Azul noite no Pérola (ícone do Gestão)', M.azulNoite, M.perola, 3],
];

// ---------- símbolo (quadro 64; tinta de x 2 a 62 e de y 13 a 59,5) ----------
const SIMB = { x0: 2, y0: 13, w: 60, h: 46.5 };
function simbolo(cor, sol, id) {
  // o sol é cortado em y = 22,8: fica uma fresta de 2,7 entre ele e o topo da serra (vale também no monocromático)
  return `<clipPath id="${id}"><rect width="64" height="22.8"/></clipPath><circle cx="40" cy="24" r="11" fill="${sol}" clip-path="url(#${id})"/><path d="M2 50 L10 42 L12.8 28 Q13.3 25.5 16 25.5 L48 25.5 Q50.7 25.5 51.2 28 L54 42 L62 50Z" fill="${cor}"/><rect x="2" y="55" width="60" height="4.5" rx="2.25" fill="${cor}"/>`;
}

// ---------- escrita em contorno, alinhada pela tinta ----------
const archivo = opentype.loadSync(join(FONTES, 'Archivo_800ExtraBold.ttf'));
const plex = opentype.loadSync(join(FONTES, 'IBMPlexSans_600SemiBold.ttf'));
const capArchivo = -archivo.getPath('M', 0, 0, 100).getBoundingBox().y1; // 68,7
const tintaM = archivo.getPath('Macuxi', 0, 0, 100).getBoundingBox();
const capPlex = 0.698; // altura de maiúscula da IBM Plex Sans (OS/2 sCapHeight 698/1000)
const D = { corpo: 28, folga: 13 };
// "FORÇA DE VENDAS" letra a letra, com o espaço entre letras resolvido para a tinta ter a largura exata de "Macuxi"
function descritor(xTinta, baseline, largura) {
  const glifos = plex.stringToGlyphs('FORÇA DE VENDAS');
  const k = D.corpo / plex.unitsPerEm;
  const montar = (track) => {
    let x = 0; const partes = [];
    glifos.forEach((g, i) => { partes.push({ g, x }); x += g.advanceWidth * k + (i < glifos.length - 1 ? track : 0); });
    const bbs = partes.map(({ g, x: gx }) => g.getPath(gx, 0, D.corpo).getBoundingBox()).filter((b) => b.x2 > b.x1);
    return { partes, x1: Math.min(...bbs.map((b) => b.x1)), x2: Math.max(...bbs.map((b) => b.x2)) };
  };
  const base = montar(0);
  const track = (largura - (base.x2 - base.x1)) / (glifos.length - 1);
  const final = montar(track);
  const dx = xTinta - final.x1;
  return final.partes.map(({ g, x }) => g.getPath(x + dx, baseline, D.corpo).toPathData(2)).join('');
}
// Geometria do logo horizontal (unidades: "Macuxi" com corpo 100)
const G = {};
G.capTopo = 0;
G.baseM = capArchivo; // base de "Macuxi"
G.capD = G.baseM + D.folga; // topo das maiúsculas de "FORÇA DE VENDAS"
G.baseD = G.capD + capPlex * D.corpo; // base de "FORÇA DE VENDAS" = base do lavrado
G.altura = G.baseD - G.capTopo;
G.escala = G.altura / SIMB.h;
G.larguraS = SIMB.w * G.escala;
G.espaco = 0.3 * G.altura;
G.xTinta = G.larguraS + G.espaco;
G.larguraTinta = tintaM.x2 - tintaM.x1;
G.largura = G.xTinta + G.larguraTinta;
G.topoVisivel = G.baseM + tintaM.y1; // pingo do i, acima do topo do "M"
G.baixo = G.baseD + 0.211 * D.corpo; // cedilha
const PALAVRA = (x, y) => archivo.getPath('Macuxi', x - tintaM.x1, y, 100).toPathData(2);

function lockup({ cor, sol, texto, desc }) {
  const vb = [0, G.topoVisivel, G.largura, G.baixo - G.topoVisivel].map((n) => n.toFixed(2)).join(' ');
  const t = `translate(${(-SIMB.x0 * G.escala).toFixed(3)} ${(G.capTopo - SIMB.y0 * G.escala).toFixed(3)}) scale(${G.escala.toFixed(5)})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="Macuxi Força de Vendas"><defs/><g transform="${t}">${simbolo(cor, sol, 'sol-h')}</g><path fill="${texto}" d="${PALAVRA(G.xTinta, G.baseM)}"/><path fill="${desc}" d="${descritor(G.xTinta, G.baseD, G.larguraTinta)}"/></svg>`;
}
function empilhado({ cor, sol, texto, desc }) {
  const ls = 0.62 * G.larguraTinta; const es = ls / SIMB.w; const hs = SIMB.h * es; const gap = 0.3 * hs;
  const y0 = hs + gap; // topo do "M"
  const W = G.larguraTinta; const xS = (W - ls) / 2;
  const t = `translate(${(xS - SIMB.x0 * es).toFixed(3)} ${(-SIMB.y0 * es).toFixed(3)}) scale(${es.toFixed(5)})`;
  const baixo = y0 + G.baseD + 0.211 * D.corpo;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(2)} ${baixo.toFixed(2)}" role="img" aria-label="Macuxi Força de Vendas"><g transform="${t}">${simbolo(cor, sol, 'sol-e')}</g><path fill="${texto}" d="${PALAVRA(0, y0 + G.baseM)}"/><path fill="${desc}" d="${descritor(0, y0 + G.baseD, G.larguraTinta)}"/></svg>`;
}
function soSimbolo({ cor, sol }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${SIMB.x0} ${SIMB.y0} ${SIMB.w} ${SIMB.h}" role="img" aria-label="Macuxi">${simbolo(cor, sol, 'sol-s')}</svg>`;
}
// Ícone quadrado (tamanho em px); `fracao` = largura do símbolo sobre o lado. Sem fundo = camada da frente do ícone adaptativo.
function iconeQuadrado({ fundo, cor, sol, fracao = 0.6, raio = 0 }) {
  const lado = 108; const w = lado * fracao; const e = w / SIMB.w; const h = SIMB.h * e;
  const t = `translate(${((lado - w) / 2 - SIMB.x0 * e).toFixed(3)} ${((lado - h) / 2 - SIMB.y0 * e).toFixed(3)}) scale(${e.toFixed(5)})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}">${fundo ? `<rect width="${lado}" height="${lado}" rx="${raio}" fill="${fundo}"/>` : ''}<g transform="${t}">${simbolo(cor, sol, 'sol-i')}</g></svg>`;
}

// ---------- os arquivos ----------
const SVGS = {
  'macuxi-logo-positivo.svg': lockup({ cor: M.azulNoite, sol: M.sol, texto: M.grafite, desc: M.ink2 }),
  'macuxi-logo-negativo-azul-noite.svg': lockup({ cor: M.branco, sol: M.solClaro, texto: M.branco, desc: M.claroNoAzul }),
  'macuxi-logo-negativo-grafite.svg': lockup({ cor: M.azulClaro, sol: M.solClaro, texto: M.branco, desc: '#C9D0D8' }),
  'macuxi-logo-mono-preto.svg': lockup({ cor: M.preto, sol: M.preto, texto: M.preto, desc: M.preto }),
  'macuxi-logo-mono-branco.svg': lockup({ cor: M.branco, sol: M.branco, texto: M.branco, desc: M.branco }),
  'macuxi-logo-empilhado-positivo.svg': empilhado({ cor: M.azulNoite, sol: M.sol, texto: M.grafite, desc: M.ink2 }),
  'macuxi-logo-empilhado-negativo.svg': empilhado({ cor: M.branco, sol: M.solClaro, texto: M.branco, desc: M.claroNoAzul }),
  'macuxi-simbolo.svg': soSimbolo({ cor: M.azulNoite, sol: M.sol }),
  'macuxi-simbolo-negativo.svg': soSimbolo({ cor: M.branco, sol: M.solClaro }),
  'macuxi-simbolo-mono.svg': soSimbolo({ cor: M.preto, sol: M.preto }),
};
// Ícones do app (Campo: Azul noite; Gestão: Pérola, para os dois não se confundirem na tela do celular)
const ICONES = {
  campo: { fundo: M.azulNoite, cor: M.branco, sol: M.solClaro },
  gestao: { fundo: M.perola, cor: M.azulNoite, sol: M.sol },
};
const PNGS = [];
for (const [app, c] of Object.entries(ICONES)) {
  PNGS.push([`icone-${app}-1024.png`, iconeQuadrado({ ...c, fracao: 0.62 }), 1024]); // ícone da loja e do app (o sistema aplica a máscara)
  PNGS.push([`icone-${app}-adaptativo-frente-432.png`, iconeQuadrado({ cor: c.cor, sol: c.sol, fracao: 0.42 }), 432]); // 108 dp; o símbolo cabe na zona segura de 66 dp
  PNGS.push([`icone-${app}-adaptativo-fundo-432.png`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108"><rect width="108" height="108" fill="${c.fundo}"/></svg>`, 432]);
}
PNGS.push(['icone-monocromatico-432.png', iconeQuadrado({ cor: M.branco, sol: M.branco, fracao: 0.42 }), 432]); // Android 13+: o sistema pinta pela transparência
PNGS.push(['icone-notificacao-96.png', iconeQuadrado({ cor: M.branco, sol: M.branco, fracao: 0.8 }), 96]);
PNGS.push(['splash-campo-1024.png', SVGS['macuxi-logo-empilhado-negativo.svg'], 1024]); // fundo da splash do Campo: Azul noite
PNGS.push(['splash-gestao-1024.png', SVGS['macuxi-logo-empilhado-positivo.svg'], 1024]); // fundo da splash do Gestão: Pérola
PNGS.push(['logo-padrao-pdf-256.png', iconeQuadrado({ ...ICONES.campo, fracao: 0.62, raio: 22 }), 256]); // PDF de distribuidora sem logo
PNGS.push(['favicon-48.png', iconeQuadrado({ ...ICONES.campo, fracao: 0.7, raio: 20 }), 48]);
PNGS.push(['favicon-192.png', iconeQuadrado({ ...ICONES.campo, fracao: 0.62, raio: 22 }), 192]);
PNGS.push(['macuxi-logo-positivo-1200.png', SVGS['macuxi-logo-positivo.svg'], 1200]);
PNGS.push(['macuxi-logo-negativo-azul-noite-1200.png', SVGS['macuxi-logo-negativo-azul-noite.svg'], 1200]);

for (const [nome, svg] of Object.entries(SVGS)) writeFileSync(join(SAIDA, nome), `${svg}\n`);
const pares = PARES.map(([uso, fg, bg, min]) => ({ uso, fg, bg, razao: Number(contraste(fg, bg).toFixed(2)), minimo: min, passa: contraste(fg, bg) >= min }));
writeFileSync(join(SAIDA, 'contraste.json'), `${JSON.stringify({ paleta: MARCA, geometria: Object.fromEntries(Object.entries(G).map(([k, v]) => [k, Number(v.toFixed(2))])), pares }, null, 2)}\n`);
if (pares.some((p) => !p.passa)) throw new Error('par de contraste abaixo do mínimo');

const navegador = await chromium.launch();
const pagina = await navegador.newPage({ deviceScaleFactor: 1 });
for (const [nome, svg, largura] of PNGS) {
  const vb = /viewBox="([^"]+)"/.exec(svg)[1].split(' ').map(Number);
  const altura = Math.round((largura * vb[3]) / vb[2]);
  await pagina.setViewportSize({ width: largura, height: altura });
  await pagina.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${largura}" height="${altura}" `)}</body></html>`);
  await pagina.screenshot({ path: join(SAIDA, nome), omitBackground: true, clip: { x: 0, y: 0, width: largura, height: altura } });
}

// ---------- prancha de conferência (ativos.png) ----------
const xadrez = 'background:repeating-conic-gradient(#E6E6E6 0 25%,#FFFFFF 0 50%) 0 0/16px 16px';
const caixa = (fundo, html, rot) => `<div><div style="height:170px;border-radius:12px;border:1px solid #E3E0D8;background:${fundo};display:flex;align-items:center;justify-content:center;padding:18px">${html}</div><div style="font-size:12.5px;color:${M.ink2};margin-top:6px;text-align:center">${rot}</div></div>`;
const tam = (svg, w) => svg.replace('<svg ', `<svg width="${w}" `);
const guias = (() => {
  const s = SVGS['macuxi-logo-positivo.svg'];
  const linhas = [G.capTopo, G.baseM, G.baseD].map((y) => `<line x1="-20" x2="${G.largura + 20}" y1="${y}" y2="${y}" stroke="#E5484D" stroke-width="0.7" stroke-dasharray="3 3"/>`).join('') +
    [G.xTinta, G.xTinta + G.larguraTinta, G.larguraS].map((x) => `<line x1="${x}" x2="${x}" y1="${G.topoVisivel - 6}" y2="${G.baixo + 6}" stroke="#2F80ED" stroke-width="0.7" stroke-dasharray="3 3"/>`).join('');
  return s.replace('<svg ', '<svg width="620" style="overflow:visible" ').replace('</svg>', `${linhas}</svg>`);
})();
const icone = (app, px, forma) => `<div style="width:${px}px;height:${px}px;border-radius:${forma};overflow:hidden;flex:none">${iconeQuadrado({ ...ICONES[app], fracao: 0.62 }).replace('<svg ', `<svg width="${px}" height="${px}" `)}</div>`;
const FONTES_REL = relative(SAIDA, FONTES).replaceAll('\\', '/');
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
@font-face{font-family:Archivo;font-weight:800;src:url(${FONTES_REL}/Archivo_800ExtraBold.ttf)}
@font-face{font-family:Plex;font-weight:400;src:url(${FONTES_REL}/IBMPlexSans_400Regular.ttf)}
@font-face{font-family:Plex;font-weight:700;src:url(${FONTES_REL}/IBMPlexSans_700Bold.ttf)}
body{margin:0;padding:48px;width:1600px;box-sizing:border-box;font-family:Plex;color:${M.grafite};background:#fff}
h1{font:800 40px Archivo;margin:6px 0 0}h2{font:700 13px Plex;letter-spacing:.1em;color:${M.ink2};margin:30px 0 12px}
.g{display:grid;gap:16px}td{padding:5px 10px;border-bottom:1px solid #ECEEE9;font-size:13px}
</style></head><body>
<div style="font:700 14px Plex;letter-spacing:.08em;color:${M.ink2}">MARCA MACUXI FDV · ATIVOS FINAIS V1 · APROVADOS EM 12/11/2026</div>
<h1>Ativos da marca</h1>
<div style="font-size:16px;color:${M.ink2};margin-top:8px;max-width:1250px;line-height:1.45">Símbolo Monte Roraima, Azul noite #1E3350, fundo Pérola #F8F6F1 e sol laranja #C2540A. Texto em contorno: os arquivos não dependem de fonte instalada. As regras de uso estão em docs/marca/manual.md.</div>
<h2>Logo · alinhamento (topo do sol = topo do "M"; lavrado = base de "FORÇA DE VENDAS"; descritor da largura de "Macuxi")</h2>
<div style="border:1px solid #E3E0D8;border-radius:12px;padding:40px;display:flex;justify-content:center">${guias}</div>
<h2>Logo · versões</h2>
<div class="g" style="grid-template-columns:repeat(4,1fr)">
${caixa(M.perola, tam(SVGS['macuxi-logo-positivo.svg'], 300), 'positivo · Pérola')}
${caixa(M.azulNoite, tam(SVGS['macuxi-logo-negativo-azul-noite.svg'], 300), 'negativo · Azul noite')}
${caixa(M.grafite, tam(SVGS['macuxi-logo-negativo-grafite.svg'], 300), 'negativo · grafite (menu do BKO)')}
${caixa('#FFFFFF', tam(SVGS['macuxi-logo-mono-preto.svg'], 300), 'monocromático')}
${caixa(M.perola, tam(SVGS['macuxi-logo-empilhado-positivo.svg'], 170), 'empilhado · splash do Gestão')}
${caixa(M.azulNoite, tam(SVGS['macuxi-logo-empilhado-negativo.svg'], 170), 'empilhado · splash do Campo')}
${caixa(xadrez, tam(SVGS['macuxi-simbolo.svg'], 120), 'símbolo')}
${caixa(M.azulNoite, tam(SVGS['macuxi-simbolo-negativo.svg'], 120), 'símbolo negativo')}
</div>
<h2>Ícones do app</h2>
<div style="display:flex;gap:26px;align-items:flex-end;flex-wrap:wrap">
${['campo', 'gestao'].map((app) => `<div style="text-align:center"><div style="display:flex;gap:12px;align-items:flex-end">${icone(app, 96, '50%')}${icone(app, 96, '26%')}${icone(app, 48, '50%')}${icone(app, 24, '50%')}</div><div style="font-size:12.5px;color:${M.ink2};margin-top:6px">${app === 'campo' ? 'Macuxi Campo · Azul noite' : 'Macuxi Gestão · Pérola'} · 96, 48 e 24 px</div></div>`).join('')}
<div style="text-align:center"><div style="width:96px;height:96px;border-radius:50%;background:#DCE3EC;display:flex;align-items:center;justify-content:center">${tam(soSimbolo({ cor: '#2F4156', sol: '#2F4156' }), 56)}</div><div style="font-size:12.5px;color:${M.ink2};margin-top:6px">temático (Android 13+)</div></div>
<div style="text-align:center"><div style="width:144px;height:144px;position:relative;${xadrez}">${iconeQuadrado({ cor: M.azulNoite, sol: M.sol, fracao: 0.42 }).replace('<svg ', '<svg width="144" height="144" ')}<div style="position:absolute;left:28px;top:28px;width:88px;height:88px;border-radius:50%;border:1.5px dashed ${M.sol}"></div></div><div style="font-size:12.5px;color:${M.ink2};margin-top:6px">camada da frente · zona segura</div></div>
</div>
<h2>Paleta e contraste conferido</h2>
<div class="g" style="grid-template-columns:1fr 1.4fr;align-items:start">
<div>${[['Azul noite', M.azulNoite, 'cabeçalho, botão principal, link, ícone do Campo'], ['Pérola', M.perola, 'fundo das telas e ícone do Gestão'], ['Branco', M.branco, 'cartões, PDF e e-mail'], ['Sol laranja', M.sol, 'sol do logo e gráficos (barra, contador)'], ['Sol claro', M.solClaro, 'sol sobre fundo escuro'], ['Grafite', M.grafite, 'texto e menu do BKO'], ['Azul claro', M.azulClaro, 'azul sobre o grafite'], ['Azul suave', M.azulSuave, 'fundo do chip em destaque'], ['Texto claro na faixa', M.claroNoAzul, 'subtítulo no cabeçalho azul']].map(([n, h, p]) => `<div style="display:flex;gap:12px;align-items:center;margin-bottom:8px"><div style="width:56px;height:36px;border-radius:8px;background:${h};border:1px solid #E3E0D8"></div><div><b>${n}</b> <span style="font-family:monospace;color:${M.ink2}">${h}</span><div style="font-size:12.5px;color:${M.ink2}">${p}</div></div></div>`).join('')}</div>
<table style="border-collapse:collapse;width:100%">${pares.map((p) => `<tr><td>${p.uso}</td><td style="font-family:monospace;color:${M.ink2}">${p.fg} / ${p.bg}</td><td style="color:#1D6B4F;font-weight:700">${p.razao.toFixed(2).replace('.', ',')}:1 ✓</td><td>${p.minimo === 3 ? 'gráfico 3,0' : 'texto 4,5'}</td></tr>`).join('')}</table>
</div></body></html>`;
writeFileSync(join(SAIDA, 'ativos.html'), html);
const prancha = await navegador.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await prancha.goto(`file://${join(SAIDA, 'ativos.html')}`);
await prancha.evaluate(() => document.fonts.ready);
await prancha.screenshot({ path: join(SAIDA, 'ativos.png'), fullPage: true });
await navegador.close();
console.log(`${Object.keys(SVGS).length} SVG, ${PNGS.length} PNG, ativos.png; altura do logo ${G.altura.toFixed(1)}, largura ${G.largura.toFixed(1)}`);
