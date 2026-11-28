// Simulação T-0210 (v1.0.44): "Vendas do mês" pelas RN-CORE-20 e 21, ANTES × DEPOIS, nas telas que já existem:
// app Gestão (ficha › cartão Mês, Ranking mensal) a 390 px e BKO (Ranking da equipe) a 1366 px. Números da simulação do
// testes (docs/testes/T-0210.md, base demo de 28/11/2026), com nomes fictícios. Os valores passam pelo mesmo formato das
// telas (formatBRL0: real inteiro; percentual arredondado). Uso, a partir da raiz: node docs/design/vendas-mes-v1044/gerar.mjs
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const AQUI = dirname(fileURLToPath(import.meta.url));

const brl0 = (cents) => `R$ ${Math.round(cents / 100).toLocaleString('pt-BR')}`;
const pctR = (v) => `${Math.round(v)}%`;
const META_A = 18_000_000; // meta de venda do Vendedor A (demo)
const DIAS_RESTANTES = 1; // 28/11/2026 é sábado; semana seg–sex: resta a segunda 30/11
const precisa = (vendido) => brl0(Math.ceil((META_A - vendido) / DIAS_RESTANTES));

// --- cenários (centavos) -------------------------------------------------------------------------------------------
const C = {
  s5: {
    titulo: 'S5 · parâmetro "faturado" · meta de faturamento',
    antes: { a: 160_391, b: 72_130, posA: 2, posB: 1, base: 'faturado' },
    depois: { a: 157_196, b: 65_230, posA: 5, posB: 1, base: 'faturado' },
  },
  s2: {
    titulo: 'S2 · meta de faturamento',
    antes: { a: 322_300, b: 72_130, posA: 5, posB: 1, base: 'aprovado' },
    depois: { a: 157_196, b: 65_230, posA: 5, posB: 1, base: 'faturado' },
  },
};
const BASE = { aprovado: 'base: pedidos aprovados', faturado: 'base: notas faturadas' };
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// --- moldura comum -------------------------------------------------------------------------------------------------
const CSS_COMUM = `*{box-sizing:border-box;margin:0}
body{font-family:Roboto,system-ui,'Segoe UI',-apple-system,sans-serif;color:#16202A;background:#F8F6F1}
.faixa-sim{display:flex;align-items:center;gap:10px;padding:10px 16px;font-size:13px;font-weight:600;color:#16202A;background:#fff;border-bottom:1px solid #DFE2E6}
.faixa-sim .tag{font-size:12px;font-weight:700;letter-spacing:.06em;padding:3px 8px;border-radius:999px}
.tag.antes{background:#ECEEF1;color:#34404D}.tag.depois{background:#E2F1EA;color:#1D6B4F}
.faixa-sim span{font-weight:400;color:#4A5562}
.muda{background:#FFF1D6;border-radius:6px;padding:0 6px;margin:0 -6px;box-shadow:inset 0 0 0 1px #E8C98A}`;

const faixaSim = (fase, titulo) => `<div class="faixa-sim"><b class="tag ${fase}">${fase === 'antes' ? 'ANTES' : 'DEPOIS'}</b>${titulo}<span>${fase === 'antes' ? 'v1.0.43' : 'RN-CORE-20 e 21'}</span></div>`;
const v = (txt, muda) => (muda ? `<b class="muda">${txt}</b>` : `<b>${txt}</b>`);

// --- app Gestão (390) ----------------------------------------------------------------------------------------------
const CSS_APP = `body{width:390px}
.faixa-sim span{display:none}
.cab{background:#1E3350;color:#fff;padding:12px 20px 16px}
.cab .volta{font-size:14px;color:#C9CED5;margin-bottom:8px}
.cab h1{font-size:22px;line-height:28px;font-weight:700}
.cab small{display:block;font-size:14px;color:#C9CED5;margin-top:2px}
.corpo{padding:16px 20px 24px;display:flex;flex-direction:column;gap:14px}
.chip{display:inline-flex;align-items:center;height:36px;padding:0 12px;border-radius:18px;border:1px solid #7A8593;background:#fff;font-size:14px;font-weight:600;white-space:nowrap}
.chip.on{background:#DFE2E6;border-color:#DFE2E6;color:#1E3350}
.chip.p{height:28px;font-size:12px;padding:0 10px}
.chips{display:flex;gap:6px;margin:0 -20px;padding:0 20px;overflow:hidden}
.cartao{background:#fff;border:1px solid #DFE2E6;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:6px}
.cartao h2{font-size:18px;font-weight:700}
.linha{display:flex;justify-content:space-between;align-items:center;min-height:24px;font-size:16px}
.linha b{font-weight:600}
.apaga{opacity:.38}
.small{font-size:12px;color:#4A5562}
.rk{padding:0}
.rk .l{display:flex;align-items:center;gap:10px;min-height:48px;padding:0 14px;font-size:16px}
.rk .l + .l{border-top:1px solid #ECEEF1}
.rk .pos{width:28px;text-align:center;font-size:18px;font-weight:700}
.rk .nome{flex:1;font-weight:600}`;

const app = (fase, titulo, cab, corpo) => `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><style>${CSS_COMUM}${CSS_APP}</style><body>
${faixaSim(fase, titulo)}
<header class="cab"><div class="volta">‹ Equipe</div><h1>${cab.titulo}</h1>${cab.sub ? `<small>${cab.sub}</small>` : ''}</header>
<main class="corpo">${corpo}</main></body></html>`;

function fichaA(fase, cen) {
  const x = C[cen][fase];
  const muda = fase === 'depois';
  const corpo = `<div><span class="chip p">Em rota</span></div>
<section class="cartao apaga"><h2>Visitas</h2><div class="linha">Realizadas<b>4 de 7</b></div><div class="linha">Cobertura de rota<b>57%</b></div><div class="linha">Tempo em cliente<b>96 min</b></div></section>
<section class="cartao apaga"><h2>Vendas do dia</h2><div class="linha">Vendido<b>R$ 480</b></div><div class="linha">Pedidos<b>2</b></div><div class="linha">Positivados<b>2</b></div><div class="linha">Desconto médio<b>3%</b></div></section>
<section class="cartao"><h2>Mês</h2>
<div class="linha">Vendido no mês${v(brl0(x.a), muda)}</div>
<div class="linha">Meta<b>${brl0(META_A)}</b></div>
<div class="linha">Atingido${v(pctR((x.a / META_A) * 100), muda && pctR((x.a / META_A) * 100) !== pctR((C[cen].antes.a / META_A) * 100))}</div>
<div class="linha">Precisa por dia${v(precisa(x.a), muda)}</div></section>
<p class="small">Cartões do dia apagados: não mudam.</p>`;
  return app(fase, C[cen].titulo, { titulo: 'Vendedor A', sub: 'Vendedor' }, corpo);
}

const PERIODOS = ['Hoje', 'Semana', 'Mês'];
const INDICADORES = ['Vendas', 'Pedidos', 'Positivados', 'Ticket médio', 'Meta', 'Cobertura de rota', 'Gôndola', 'Ruptura'];
function rankingApp(fase, cen, indicador) {
  const x = C[cen][fase];
  const muda = fase === 'depois';
  const ant = C[cen].antes;
  const linhas =
    indicador === 'Vendas'
      ? [['Vendedor A', brl0(x.a), muda && x.a !== ant.a], ['Vendedor B', brl0(x.b), muda && x.b !== ant.b]]
      : [['Vendedor A', String(x.posA), muda && x.posA !== ant.posA], ['Vendedor B', String(x.posB), muda && x.posB !== ant.posB]];
  linhas.sort((p, q) => parseFloat(q[1].replace(/\D/g, '')) - parseFloat(p[1].replace(/\D/g, '')));
  const corpo = `<div class="chips">${PERIODOS.map((p) => `<span class="chip${p === 'Mês' ? ' on' : ''}">${p}</span>`).join('')}</div>
<div class="chips">${INDICADORES.map((i) => `<span class="chip${i === indicador ? ' on' : ''}">${i}</span>`).join('')}</div>
<p class="small">${v(cap(BASE[x.base]), muda && x.base !== ant.base).replace('<b', '<span').replace('</b>', '</span>')}</p>
<section class="cartao rk">${linhas.map(([n, val, m], i) => `<div class="l"><span class="pos">${i + 1}</span><span class="nome">${n}</span>${v(val, m)}</div>`).join('')}</section>`;
  return app(fase, C[cen].titulo, { titulo: 'Ranking' }, corpo);
}

// --- BKO (1366) ----------------------------------------------------------------------------------------------------
const CSS_BKO = `body{width:1366px}
.bko{display:flex;min-height:640px}
.menu{width:240px;background:#16202A;color:#C9CED5;padding:20px 12px;flex-shrink:0;display:flex;flex-direction:column;gap:2px}
.menu .brand{padding:0 8px 16px}.menu .brand img{height:28px;display:block}.menu .brand span{display:block;font-size:12px;margin-top:18px}
.menu .t{height:30px;display:flex;align-items:center;padding:0 10px;color:#F59A52;font-size:12px;font-weight:600;letter-spacing:.07em;text-transform:uppercase}
.menu .i{min-height:32px;display:flex;align-items:center;padding:6px 10px 6px 20px;font-size:15px;border-radius:8px;position:relative}
.menu .i.on{background:#2B3743;color:#fff;font-weight:600}
.menu .i.on:before{content:'';position:absolute;left:8px;top:8px;bottom:8px;width:3px;border-radius:2px;background:#F59A52}
main{flex:1;padding:28px 32px;display:flex;flex-direction:column;gap:16px}
.ph{display:flex;align-items:center;justify-content:space-between;min-height:42px}
.ph h1{font-size:24px;font-weight:700;display:flex;align-items:baseline;gap:12px}
.ph h1 span{font-size:13px;font-weight:500;color:#4A5562}
.dots{width:40px;height:40px;border:1px solid #C9CED5;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#4A5562;background:#fff}
.filtros{display:flex;gap:16px}
.campo{display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600;color:#4A5562}
.sel{width:220px;height:44px;border:1px solid #C9CED5;border-radius:10px;background:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 12px;font-size:15px;font-weight:500;color:#16202A}
.painel{background:#fff;border:1px solid #DFE2E6;border-radius:16px;padding:8px 16px}
table{width:100%;border-collapse:collapse;font-size:15px}
th{text-align:left;font-size:12px;font-weight:600;color:#4A5562;padding:10px;border-bottom:1px solid #DFE2E6}
td{padding:0 10px;height:48px;border-bottom:1px solid #ECEEF1}
tr:last-child td{border-bottom:0}
.n{text-align:right;font-variant-numeric:tabular-nums}`;

function rankingBko(fase, cen) {
  const x = C[cen][fase];
  const muda = fase === 'depois';
  const ant = C[cen].antes;
  const linhas = [['Vendedor A', brl0(x.a), muda && x.a !== ant.a], ['Vendedor B', brl0(x.b), muda && x.b !== ant.b]];
  const base = v(BASE[x.base], muda && x.base !== ant.base).replace('<b', '<span').replace('</b>', '</span>');
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><style>${CSS_COMUM}${CSS_BKO}</style><body>
${faixaSim(fase, C[cen].titulo)}
<div class="bko"><nav class="menu"><div class="brand"><img src="../../marca/ativos/2026-11-12-v1/macuxi-logo-negativo-grafite.svg" alt="Macuxi Força de Vendas"><span>Distribuidora Exemplo</span></div>
<div class="t">Análise</div><div class="i">Painel da equipe</div><div class="i">Trajeto do dia</div><div class="i on">Ranking</div>
<div class="t">Operação</div><div class="i">Aprovações</div><div class="i">Alertas</div></nav>
<main><div class="ph"><h1>Ranking da equipe · 2<span>2026-11-01 a 2026-11-30 · ${base}</span></h1><span class="dots">⋯</span></div>
<div class="filtros"><label class="campo">Indicador<span class="sel">Vendas<i>▾</i></span></label><label class="campo">Período<span class="sel">Mês<i>▾</i></span></label></div>
<section class="painel"><table><thead><tr><th style="width:64px" class="n">#</th><th>Nome</th><th style="width:140px">Perfil</th><th style="width:180px" class="n">Vendas</th></tr></thead><tbody>
${linhas.map(([n, val, m], i) => `<tr><td class="n">${i + 1}</td><td>${n}</td><td>Vendedor</td><td class="n">${v(val, m)}</td></tr>`).join('')}
</tbody></table></section></main></div></body></html>`;
}

// --- pranchas --------------------------------------------------------------------------------------------------------
const telas = {};
for (const fase of ['antes', 'depois']) {
  telas[`s5-gestao-ficha-${fase}-390`] = [fichaA(fase, 's5'), 390];
  telas[`s5-gestao-ranking-vendas-${fase}-390`] = [rankingApp(fase, 's5', 'Vendas'), 390];
  telas[`s5-gestao-ranking-positivados-${fase}-390`] = [rankingApp(fase, 's5', 'Positivados'), 390];
  telas[`s5-bko-ranking-vendas-${fase}-1366`] = [rankingBko(fase, 's5'), 1366];
  telas[`s2-gestao-ficha-${fase}-390`] = [fichaA(fase, 's2'), 390];
  telas[`s2-bko-ranking-vendas-${fase}-1366`] = [rankingBko(fase, 's2'), 1366];
}

const browser = await require('playwright').chromium.launch();
for (const [nome, [html, w]] of Object.entries(telas)) {
  const arq = join(AQUI, `${nome}.html`);
  writeFileSync(arq, html);
  const page = await browser.newPage({ viewport: { width: w, height: 400 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(arq).href);
  await page.screenshot({ path: join(AQUI, `${nome}.png`), fullPage: true });
  await page.close();
  console.log(nome);
}
await browser.close();
