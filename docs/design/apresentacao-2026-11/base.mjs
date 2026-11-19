// Base dos prints da apresentação (R-20261118-2250): aparelho Android de 360 × 760 dp, só a tela, com a barra de status.
// Cada peça imita um componente de hoje do código (packages/ui/src/mobile e modules/*/app), com o mesmo tamanho, peso e cor.
// Ícones: lidos de packages/ui/src/mobile/icon.tsx (o mesmo desenho do app, sem cópia). Cores: tokens.ts e contraste.ts.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '../../..');

// ---------- ícones do kit (icon.tsx): cada `case 'nome':` vira o miolo do <svg> ----------
const FONTE_ICONES = readFileSync(join(RAIZ, 'packages/ui/src/mobile/icon.tsx'), 'utf8');
const ICONES = (() => {
  const corpo = FONTE_ICONES.slice(FONTE_ICONES.indexOf('switch (name)'));
  const mapa = {};
  const partes = corpo.split(/\n\s*case '/).slice(1);
  let pendentes = [];
  for (const p of partes) {
    const nome = p.slice(0, p.indexOf("'"));
    const resto = p.slice(p.indexOf(':') + 1);
    const elementos = [...resto.matchAll(/<(Path|Circle|Rect)\s([^>]*?)\{\.\.\.c\}\s*\/>/g)].map(([, tag, attrs]) =>
      `<${tag.toLowerCase()} ${attrs.replace(/(\w+)=\{([\d.]+)\}/g, '$1="$2"').trim()}/>`,
    );
    pendentes.push(nome);
    if (elementos.length) {
      for (const n of pendentes) mapa[n] = elementos.join('');
      pendentes = [];
    }
  }
  return mapa;
})();

export function ic(nome, tam = 18, cor = 'currentColor', traco = 2) {
  if (!ICONES[nome]) throw new Error(`ícone sem desenho no kit: ${nome}`);
  return `<svg class="ic" width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="${cor}" stroke-width="${traco}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[nome]}</svg>`;
}

// ---------- cores (packages/ui/src/mobile/tokens.ts; inkDisabled #5B6673, MC-1503 B) ----------
export const COR = {
  ground: '#F8F6F1', surface: '#FFFFFF', ink: '#16202A', ink2: '#4A5562', ink3: '#5B6673', inkDisabled: '#5B6673',
  line: '#DFE2E6', lineSoft: '#ECEEF1', lineStrong: '#C9CED5', accent: '#1E3350', accentInk: '#1E3350', accentSoft: '#DFE2E6',
  grafico: '#C2540A', graficoEscuro: '#F59A52', faixa: '#1E3350', faixaSub: '#C9CED5', faixaTrilho: '#3A4D68',
  success: '#1D6B4F', successBg: '#E2F1EA', warning: '#7A4F00', warningInk: '#5C3B00', warningBg: '#FFF1D6',
  danger: '#A8261B', dangerBg: '#FDE8E6', neutralBg: '#ECEEF1', neutralInk: '#34404D',
};

// Roboto (a fonte do sistema no Android; OFL, fontes/LICENSE-roboto), embutida para o PNG não depender do que a máquina tem.
const FONTES = [[400, 'roboto-latin-400'], [500, 'roboto-latin-500'], [600, 'roboto-latin-600'], [700, 'roboto-latin-700']]
  .map(([peso, arq]) => `@font-face{font-family:Roboto;font-weight:${peso};src:url(data:font/woff2;base64,${readFileSync(join(AQUI, 'fontes', `${arq}-normal.woff2`)).toString('base64')}) format('woff2')}`)
  .join('') + `@font-face{font-family:'Roboto Mono';src:url(data:font/woff2;base64,${readFileSync(join(AQUI, 'fontes/roboto-mono-latin-400-normal.woff2')).toString('base64')}) format('woff2')}`;

const CSS = `${FONTES}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:360px;height:760px;overflow:hidden;background:${COR.ground}}
body{font-family:Roboto,system-ui,'Segoe UI',-apple-system,sans-serif;color:${COR.ink};-webkit-font-smoothing:antialiased}
.ic{flex:none;display:block}
.tn{font-variant-numeric:tabular-nums}
.mono{font-family:'Roboto Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}
.tel{width:360px;height:760px;background:${COR.ground};display:flex;flex-direction:column;overflow:hidden;position:relative}
/* barra de status do Android (24 dp), ícones claros sobre a faixa e escuros sobre o Pérola (estiloBarraDeStatus) */
.sb{height:24px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 16px 0 18px;font-size:13px;font-weight:500;background:${COR.faixa};color:#fff}
.sb.claro{background:${COR.ground};color:${COR.ink}}
.sb .dir{display:flex;align-items:center;gap:6px}
/* CabecalhoTela (ui.tsx + cabecalho.ts): 12 em cima, 16 embaixo, 20 dos lados; título 22/28 700; subtítulo 14 */
.cab{background:${COR.faixa};padding:12px 20px 16px;flex:none}
.cab .vt{display:flex;align-items:center;gap:4px;height:48px;margin:-12px 0 -6px;color:${COR.faixaSub};font-size:14px;font-weight:500}
.cab .ln{display:flex;align-items:center;gap:8px}
.cab .ln>div:first-child{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.cab h1{font-size:22px;line-height:28px;font-weight:700;letter-spacing:-.2px;color:#fff}
.cab .sub{font-size:14px;color:${COR.faixaSub};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sino{width:48px;height:48px;border-radius:12px;border:1px solid ${COR.faixaTrilho};display:flex;align-items:center;justify-content:center;position:relative;flex:none}
.sino i{position:absolute;top:10px;right:10px;width:12px;height:12px;border-radius:6px;background:${COR.graficoEscuro};border:2px solid ${COR.faixa}}
.selo-sync{height:32px;padding:0 12px;border-radius:999px;border:1px solid ${COR.faixaTrilho};color:${COR.faixaSub};font-size:12px;display:flex;align-items:center;gap:6px;flex:none}
/* Abas (formulario.tsx): fundo Pérola, 48 dp, 14/500 ink2; ativa 600 ink com traço de 3 Azul noite */
.abas{display:flex;background:${COR.ground};border-bottom:1px solid ${COR.line};flex:none}
.abas div{flex:1;min-height:48px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:500;color:${COR.ink2};border-bottom:3px solid transparent;margin-bottom:-1px}
.abas div.on{font-weight:600;color:${COR.ink};border-bottom-color:${COR.accent}}
.corpo{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;gap:14px;padding:16px 20px 20px}
.corpo>*{flex:none}
.g12{gap:12px}.g10{gap:10px}.g8{gap:8px}.g6{gap:6px}
.p12{padding:12px 12px 16px}
.bloco{display:flex;flex-direction:column;gap:8px}
.bloco.g6{gap:6px}
/* RotuloSecao: 12/600 maiúsculas ink2 */
.rs{display:flex;align-items:center;justify-content:space-between;min-height:20px}
.rs span{font-size:12px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:${COR.ink2}}
.rs a{font-size:14px;font-weight:600;color:${COR.accentInk}}
.rs.al span{color:${COR.danger}}
.cartao{background:#fff;border:1px solid ${COR.line};border-radius:12px;overflow:hidden}
.cartao.r14{border-radius:14px}
/* AreaAlertas */
.alin{display:flex;align-items:center;gap:10px;min-height:44px;padding:8px 12px;font-size:14px;line-height:19px}
.alin+.alin{border-top:1px solid ${COR.lineSoft}}
.alin span{flex:1}
/* TabelaRotuloValor */
.rv{display:flex;gap:12px;padding:10px 12px;min-height:44px}
.rv+.rv{border-top:1px solid ${COR.lineSoft}}
.rv .r{width:92px;flex:none;font-size:14px;line-height:19px;color:${COR.ink2}}
.rv .v{flex:1;font-size:14px;line-height:19px}
/* TabelaValores */
.tv{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;padding:8px 14px}
.tv+.tv{border-top:1px solid ${COR.lineSoft}}
.tv .r{font-size:14px;color:${COR.ink2}}
.tv .v{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
.tv-rod{display:flex;align-items:center;gap:6px;font-size:12px;color:${COR.ink2}}
/* ListaSuspensa */
.campo-b{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
.campo-b .rot{font-size:12px;font-weight:600;color:${COR.ink2}}
.sel{min-height:48px;display:flex;align-items:center;justify-content:space-between;gap:6px;padding:0 12px;border-radius:10px;border:1px solid ${COR.lineStrong};background:#fff;font-size:16px;font-weight:600}
.sel.vazio{font-weight:400;color:${COR.ink3}}
.linha2{display:flex;gap:8px;align-items:flex-start}
/* Botao */
.bt{display:flex;align-items:center;justify-content:center;gap:8px;padding:0 16px;font-weight:600;text-align:center}
.bt.pri{height:52px;border-radius:14px;background:${COR.accent};color:#fff;font-size:16px}
.bt.sec{min-height:44px;border-radius:12px;background:#fff;color:${COR.ink};border:1.5px solid ${COR.ink};font-size:14px}
.bt.sec.alto{min-height:52px;line-height:18px}
.bt.neu{height:44px;border-radius:12px;background:${COR.lineSoft};color:${COR.ink};font-size:14px}
.bt.txt{min-height:48px;color:${COR.ink2};font-size:14px}
.bt.off{background:${COR.neutralBg};color:${COR.ink3};border-color:${COR.neutralBg}}
.dupla{display:flex;gap:8px}.dupla>*{flex:1}
/* CampoBusca */
.busca{display:flex;align-items:center;gap:8px;min-height:48px;padding-left:10px;border-radius:10px;border:1px solid ${COR.line};background:#fff;font-size:14px;color:${COR.ink3};flex:1;min-width:0}
.fbtn{width:48px;height:48px;border-radius:10px;border:1px solid ${COR.line};background:#fff;display:flex;align-items:center;justify-content:center;flex:none;position:relative}
.fbtn b{position:absolute;top:-6px;right:-6px;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:${COR.grafico};border:2px solid ${COR.ground};color:#fff;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center}
/* Chip e Badge */
.chips{display:flex;gap:6px;margin:0 -20px;padding:0 20px;overflow:hidden}
.chip{height:36px;padding:0 12px;border-radius:18px;border:1px solid ${COR.lineStrong};background:#fff;display:flex;align-items:center;font-size:14px;font-weight:600;white-space:nowrap;flex:none}
.chip.on{background:${COR.accentSoft};border-color:${COR.accentSoft};color:${COR.accentInk}}
.badge{display:inline-flex;align-items:center;min-height:24px;padding:0 10px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;flex:none}
.t-suc{color:${COR.success};background:${COR.successBg}}.t-av{color:${COR.warning};background:${COR.warningBg}}
.t-err{color:${COR.danger};background:${COR.dangerBg}}.t-neu{color:${COR.neutralInk};background:${COR.neutralBg}}
.t-des{color:${COR.accentInk};background:${COR.accentSoft}}
/* Segmentado */
.seg{display:flex;gap:8px}
.seg div{flex:1;height:48px;border-radius:9px;border:1px solid ${COR.line};background:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600}
.seg div.on{background:${COR.ink};border-color:${COR.ink};color:#fff}
.texto{min-height:72px;border-radius:12px;border:1px solid ${COR.lineStrong};background:#fff;padding:10px 12px;font-size:16px;line-height:21px}
/* Selo do kit (valores.tsx) */
.selo{align-self:flex-start;display:inline-flex;align-items:center;border-radius:5px;padding:2px 6px;font-size:12px;font-weight:600}
/* BarraAbas (base.tsx): 64 dp, rótulo 12/600 */
.barra{height:64px;flex:none;display:flex;background:#fff;border-top:1px solid ${COR.line}}
.barra div{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:12px;font-weight:600;color:${COR.ink2};white-space:nowrap;position:relative}
.barra div.on{color:${COR.accentInk}}
.barra .cont{position:absolute;top:8px;left:calc(50% + 6px);min-width:16px;height:16px;border-radius:8px;padding:0 4px;background:${COR.grafico};color:#fff;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center;border:1px solid #fff}
/* Dialogo e Folha (folha.tsx) */
.scrim{position:absolute;inset:0;background:rgba(15,20,25,.45);z-index:10}
.dlg{position:absolute;left:24px;right:24px;top:50%;transform:translateY(-50%);background:#fff;border-radius:20px;padding:24px 20px 16px;display:flex;flex-direction:column;gap:12px;z-index:11;box-shadow:0 4px 10px rgba(15,20,25,.2)}
.dlg h2{font-size:22px;line-height:28px;font-weight:700}
.dlg p{font-size:16px;line-height:22px;color:${COR.ink2}}
.dlg .bts{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
.dlg .bts .bt{height:44px;border-radius:12px;padding:0 20px;font-size:14px}
.folha{position:absolute;left:0;right:0;bottom:0;background:#fff;border-radius:22px 22px 0 0;padding:10px 20px 16px;z-index:11;display:flex;flex-direction:column;gap:12px;box-shadow:0 -4px 16px rgba(15,20,25,.18)}
.folha .pega{width:40px;height:4px;border-radius:2px;background:${COR.lineStrong};align-self:center}
.folha h2{font-size:22px;line-height:28px;font-weight:700}
`;

const SINAL = `<svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true"><path d="M1 13h2v-3H1zM5 13h2V7H5zM9 13h2V4H9zM13 13h2V1h-2z" fill="currentColor"/></svg>`;
const WIFI = `<svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true"><path d="M8 13 0.6 4.4A11 11 0 0 1 15.4 4.4z" fill="currentColor"/></svg>`;
const BATERIA = (p) => `<svg width="22" height="12" viewBox="0 0 22 12" aria-hidden="true"><rect x=".5" y=".5" width="18" height="11" rx="2.5" fill="none" stroke="currentColor" opacity=".55"/><rect x="2" y="2" width="${Math.round(15 * p / 100)}" height="8" rx="1.2" fill="currentColor"/><rect x="19.5" y="4" width="1.8" height="4" rx=".8" fill="currentColor" opacity=".55"/></svg>`;

export const barraDeStatus = (hora, { claro = false, bateria = 82 } = {}) =>
  `<div class="sb${claro ? ' claro' : ''}"><span class="tn">${hora}</span><span class="dir">${WIFI}${SINAL}${BATERIA(bateria)}</span></div>`;

export const sino = (novo = true) => `<span class="sino">${ic('bell', 22, '#fff')}${novo ? '<i></i>' : ''}</span>`;
export const seloSync = (hora) => `<span class="selo-sync">${ic('sync', 14, COR.faixaSub)}<span class="tn">${hora}</span></span>`;

export function cabecalho({ titulo, subtitulo, voltar, direita = '', semSino = false, subAcima = false }) {
  const sub = subtitulo ? `<span class="sub">${subtitulo}</span>` : '';
  return `<div class="cab">${voltar ? `<div class="vt">${ic('back', 18, COR.faixaSub)}<span>${voltar}</span></div>` : ''}<div class="ln"><div>${subAcima ? sub : ''}<h1>${titulo}</h1>${subAcima ? '' : sub}</div>${direita}${semSino ? '' : sino()}</div></div>`;
}

export const rotulo = (texto, acao = '', classe = '') => `<div class="rs ${classe}"><span>${texto}</span>${acao ? `<a>${acao}</a>` : ''}</div>`;

export const alertas = (linhas) =>
  `<div class="bloco g6">${rotulo('Alertas', '', 'al')}<div class="cartao">${linhas.map((t) => `<div class="alin">${ic('alert', 18, COR.danger)}<span>${t}</span></div>`).join('')}</div></div>`;

export const tabelaRotuloValor = (linhas) => `<div class="cartao">${linhas.map(([r, v]) => `<div class="rv"><span class="r">${r}</span><span class="v">${v}</span></div>`).join('')}</div>`;

export const tabelaValores = (linhas) => `<div class="cartao r14">${linhas.map(([r, v, cls = '']) => `<div class="tv"><span class="r">${r}</span><span class="v ${cls}">${v}</span></div>`).join('')}</div>`;

export const suspensa = (rot, valor, vazio = false) =>
  `<div class="campo-b"><span class="rot">${rot}</span><div class="sel${vazio ? ' vazio' : ''}"><span>${valor}</span>${ic('abaixo', 18, COR.ink2)}</div></div>`;

export const busca = (ph, valor = '') =>
  `<div class="busca">${ic('search', 18, COR.ink2)}<span${valor ? ` style="color:${COR.ink}"` : ''}>${valor || ph}</span></div>`;

export const badge = (texto, tom) => `<span class="badge t-${tom}">${texto}</span>`;

// Barra de abas do shell: Campo (6 posições: Início, Rota, Clientes, Pedidos, Performance, Mais) e Gestão (5: Início, Equipe,
// Aprovações, Clientes, Mais), na ordem das páginas dos módulos (apps/mobile/src/lib/abas.ts, MAX_ABAS_POR_VARIANTE).
const ABAS = {
  campo: [['inicio', 'home', 'Início'], ['rota', 'pin', 'Rota'], ['clientes', 'users', 'Clientes'], ['pedidos', 'clipboard', 'Pedidos'], ['performance', 'target', 'Performance'], ['mais', 'menu', 'Mais']],
  gestao: [['inicio', 'home', 'Início'], ['equipe', 'users', 'Equipe'], ['aprovacoes', 'check', 'Aprovações'], ['clientes', 'users', 'Clientes'], ['mais', 'menu', 'Mais']],
};
export const barraAbas = (variante, ativa, contadores = {}) =>
  `<div class="barra">${ABAS[variante]
    .map(([id, icone, rot]) => `<div${id === ativa ? ' class="on"' : ''}>${ic(icone, 22, id === ativa ? COR.accent : COR.ink2, id === ativa ? 2.2 : 1.8)}${contadores[id] ? `<span class="cont">${contadores[id]}</span>` : ''}${rot}</div>`)
    .join('')}</div>`;

/** Uma tela inteira: barra de status, o miolo e (opcional) a barra de abas. `extra` vai por cima (folha, diálogo). */
export const pagina = (miolo, estilo = '') => `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><style>${CSS}${estilo}</style><body>${miolo}</body></html>`;

export function tela({ hora, cab = '', corpo = '', classeCorpo = '', barra = '', extra = '', statusClaro = false, estilo = '' }) {
  return pagina(`<div class="tel">${barraDeStatus(hora, { claro: statusClaro })}${cab}<div class="corpo ${classeCorpo}">${corpo}</div>${barra}${extra}</div>`, estilo);
}

/** Grava cada tela como PNG de 720 × 1520 (360 × 760 dp em escala 2). */
export async function fotografar(telas, pasta, filtro = null) {
  // Playwright do repositório ou o global da sessão (NODE_PATH="$(npm root -g)"), sem instalar nada.
  const { chromium } = createRequire(import.meta.url)('playwright');
  const navegador = await chromium.launch();
  const contexto = await navegador.newContext({ viewport: { width: 360, height: 760 }, deviceScaleFactor: 2 });
  const pagina = await contexto.newPage();
  for (const [nome, html] of Object.entries(telas)) {
    if (filtro && !filtro.some((f) => nome.startsWith(f))) continue;
    await pagina.setContent(html, { waitUntil: 'load' });
    await pagina.evaluate(() => document.fonts.ready);
    const vazou = await pagina.evaluate(() => [...document.querySelectorAll('.corpo *')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow === 'hidden' && !e.closest('.chips')).map((e) => e.className).slice(0, 3));
    await pagina.screenshot({ path: join(pasta, `${nome}.png`) });
    console.log(nome, vazou.length ? `cortado: ${vazou.join(', ')}` : 'ok');
  }
  await navegador.close();
}
