// Simulação da T-0156 (rastreamento no expediente, desenho docs/desenho/tracking.md §5.2 e §7), escopo da decisão do dono do
// produto de 19/11/2026, 05h46: o rastreamento é interno e o vendedor não vê tela dele. Ficam o mapa da equipe (trajeto do dia de
// uma pessoa, Gestão e BKO, contrato core.trajeto_do_dia@1) e a notificação fixa do Android no Campo. Gera os HTMLs e os PNGs.
// Uso, a partir da raiz do repositório: node docs/design/tracking/gerar.mjs
// Aparelho 360×760 (como docs/design/pedido-aprovacao/gerar.mjs) e BKO 1366×768 (base de docs/design/menu-parametros/gerar.mjs).
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gerarPranchas } from '../_comum/navegador.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const LOGO = '../../marca/ativos/2026-11-12-v1/macuxi-logo-negativo-grafite.svg';
const ICONE_NOT = '../../marca/ativos/2026-11-12-v1/icone-notificacao-96.png';

// Cores: packages/ui/src/mobile/tokens.ts (marca v1). Fonte do sistema; escala 12 · 14 · 16 · 18 · 22 · 28.
const CSS = `<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,'Segoe UI',Roboto,-apple-system,sans-serif;background:#ECEEF1;color:#16202A;display:flex;flex-direction:column;gap:36px;padding:28px;width:max-content}
.fila{display:flex;gap:28px;align-items:flex-start}
.col{display:flex;flex-direction:column;gap:10px;width:360px}
.col.w{width:1366px}
.leg{font-size:14px;font-weight:600;min-height:40px}
.col.w .leg{min-height:20px}
.tel{width:360px;height:760px;background:#F8F6F1;border-radius:24px;overflow:hidden;display:flex;flex-direction:column;position:relative;box-shadow:0 0 0 1px #C9CED5}
.st{height:24px;flex:none;background:#1E3350;color:#fff;font-size:12px;font-weight:600;display:flex;justify-content:space-between;align-items:center;padding:0 16px}
.fx{flex:none;background:#1E3350;padding:6px 20px 14px;display:flex;flex-direction:column;gap:2px}
.fx .v{color:#C9CED5;font-size:14px;min-height:20px}.fx h1{color:#fff;font-size:22px;font-weight:700;line-height:28px}.fx .s{color:#C9CED5;font-size:14px}
.corpo{flex:1;min-height:0;padding:14px 20px;display:flex;flex-direction:column;gap:14px;overflow:hidden;position:relative}
.corpo.rola::after{content:'';position:absolute;left:0;right:0;bottom:0;height:28px;background:linear-gradient(rgba(248,246,241,0),#F8F6F1)}
.rolagem{position:absolute;right:3px;top:6px;width:4px;height:120px;border-radius:2px;background:#C9CED5}
.cx{background:#fff;border:1px solid #DFE2E6;border-radius:14px;flex:none}
.cxp{padding:14px;display:flex;flex-direction:column;gap:6px}
.cxp h2{font-size:18px;font-weight:700;line-height:24px}
.ln{display:flex;justify-content:space-between;min-height:24px;font-size:16px}.ln b{font-weight:600;font-variant-numeric:tabular-nums}
.chips{display:flex}
.ce{height:28px;flex:none;border-radius:999px;padding:0 10px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;white-space:nowrap}
.ce.ok{background:#E2F1EA;color:#1D6B4F}
.b2{height:44px;flex:none;border-radius:12px;border:1.5px solid #16202A;background:#fff;color:#16202A;font-size:14px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:8px;margin-top:6px}
.bt{height:52px;flex:none;border-radius:14px;background:#1E3350;color:#fff;font-size:16px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:8px}
.dia{display:flex;align-items:center;justify-content:space-between;gap:8px;flex:none}
.dia .seta{width:48px;height:48px;border-radius:12px;background:#fff;border:1px solid #DFE2E6;display:flex;align-items:center;justify-content:center;color:#1E3350}
.dia .seta.off{color:#C9CED5;background:#F8F6F1}
.dia b{font-size:16px;font-weight:600;text-align:center;flex:1}
.mapa{flex:none;border-radius:18px;overflow:hidden;background:#ECEEF1;border:1px solid #C9CED5;position:relative}
.mapa svg{position:absolute;inset:0}
.km{display:flex;justify-content:space-between;align-items:baseline;padding:12px;border-bottom:1px solid #ECEEF1}
.km span{font-size:14px;color:#4A5562}.km b{font-size:28px;font-weight:700;font-variant-numeric:tabular-nums}
.ev{display:flex;align-items:center;gap:10px;min-height:44px;padding:0 12px;font-size:16px;border-bottom:1px solid #ECEEF1}
.ev:last-child{border-bottom:0}
.ev span{flex:1;min-width:0;line-height:20px;padding:4px 0}.ev em{font-style:normal;font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
.ev.sr span,.ev.sr em{color:#4A5562;font-weight:400}
.ev svg{flex:none}
.vazio{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;color:#4A5562;font-size:14px;padding:0 24px}
.vazio b{font-size:18px;color:#16202A}
.vazio svg{color:#5B6673}
/* Android: barra de notificações (tema claro do sistema; não é tela do app). */
.and{background:#F1F3F8;flex:1;display:flex;flex-direction:column}
.and .sb{height:28px;flex:none;display:flex;justify-content:space-between;align-items:center;padding:0 16px;font-size:13px;font-weight:600;color:#1B1C1F}
.and .sb .ic{display:flex;gap:6px;align-items:center}
.and .rel{padding:12px 20px 8px;font-size:28px;font-weight:400;color:#1B1C1F}
.and .rapidos{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 12px 14px}
.and .rapidos i{height:56px;border-radius:28px;background:#DDE1EA}
.and .grupo{font-size:13px;font-weight:600;color:#44474F;padding:6px 24px}
.not{margin:0 12px;background:#fff;border-radius:20px;padding:14px 16px;display:flex;gap:12px;align-items:flex-start}
.not .pi{width:32px;height:32px;flex:none;border-radius:16px;background:#1E3350;display:flex;align-items:center;justify-content:center}
.not .pi img{width:22px;height:22px}
.not .txt{flex:1;display:flex;flex-direction:column;gap:2px;min-width:0}
.not .ap{font-size:12px;color:#44474F}
.not b{font-size:15px;font-weight:600;color:#1B1C1F}
.not .chev{color:#44474F;flex:none}
.and .gerir{display:flex;justify-content:flex-end;padding:12px 20px;font-size:14px;font-weight:600;color:#44474F}
.and .nada{text-align:center;font-size:14px;color:#44474F;padding:24px}
.sbi{width:14px;height:14px;display:inline-flex}
.nota{font-size:12px;line-height:1.5;color:#34404D;background:#fff;border:1px solid #DFE2E6;border-left:4px solid #C9CED5;border-radius:8px;padding:8px 12px}
/* BKO 1366×768: base visual de docs/design/menu-parametros (menu lateral, quadro, tabela, botões). */
.web{width:1366px;height:768px;background:#F8F6F1;display:flex;position:relative;overflow:hidden;box-shadow:0 0 0 1px #C9CED5}
.menu{width:240px;height:768px;background:#16202A;color:#fff;display:flex;flex-direction:column;padding:20px 12px 16px;flex-shrink:0}
.brand{display:flex;flex-direction:column;align-items:flex-start;padding:0 8px 16px}
.brand img{display:block;height:28px;width:auto}
.brand span{font-size:12px;line-height:16px;color:#C9CED5;margin-top:18px}
.lista{display:flex;flex-direction:column;gap:2px;flex:1;min-height:0;overflow:hidden}
.titulo{display:flex;justify-content:space-between;align-items:center;height:30px;padding:0 10px;border-radius:8px;color:#F59A52;font-size:12px;font-weight:600;letter-spacing:.07em;text-transform:uppercase}
.item{display:flex;align-items:center;min-height:32px;padding:6px 10px 6px 20px;line-height:20px;border-radius:8px;font-size:15px;color:#C9CED5;position:relative}
.item.ativo{background:#2B3743;color:#fff;font-weight:600}
.item.ativo:before{content:'';position:absolute;left:8px;top:8px;bottom:8px;width:3px;border-radius:2px;background:#F59A52}
.rodape{margin-top:12px;border-top:1px solid #2B3743;padding:12px 8px 0;display:flex;flex-direction:column}
.rodape b{font-size:15px}.rodape span{font-size:12px;color:#C9CED5}
main{flex:1;min-width:0;padding:24px 32px;display:flex;flex-direction:column;gap:16px}
.topo{display:flex;align-items:center;justify-content:space-between;gap:12px}
.topo h1{font-weight:700;font-size:24px;line-height:1.2;min-height:42px;display:flex;align-items:center}
.migalha{font-size:14px;font-weight:600;color:#1E3350;min-height:24px;display:flex;align-items:center;gap:4px}
.filtros{display:flex;gap:16px;align-items:flex-end}
.campo{display:flex;flex-direction:column;gap:4px;font-size:14px;font-weight:600;color:#34404D}
.input{height:44px;min-width:200px;border:1px solid #C9CED5;border-radius:10px;background:#fff;font-size:15px;font-weight:500;color:#16202A;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 12px;font-variant-numeric:tabular-nums}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.kpi{background:#fff;border:1px solid #DFE2E6;border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:2px}
.kpi span{font-size:13px;color:#4A5562}.kpi b{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums}.kpi small{font-size:13px;color:#4A5562}
.quadro{background:#fff;border:1px solid #DFE2E6;border-radius:16px;padding:8px 16px;min-width:0;position:relative}
table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:15px}
th{text-align:left;font-size:13px;font-weight:600;color:#4A5562;padding:8px 10px;border-bottom:1px solid #DFE2E6;white-space:nowrap}
td{padding:0 10px;height:44px;border-bottom:1px solid #ECEEF1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
tr:last-child td{border-bottom:0}
tr.sel td{background:#F3F5F8}
.n{text-align:right;font-variant-numeric:tabular-nums}
.selo{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.s-ok{color:#1D6B4F;background:#E2F1EA}.s-pe{color:#1E3350;background:#E6ECF4}.s-av{color:#5C3B00;background:#FFF1D6}
.ac{width:52px;text-align:center;padding:0}
.dots{display:inline-flex;width:36px;height:36px;align-items:center;justify-content:center;border-radius:10px;color:#4A5562}
.dots.on{background:#ECEEF1;color:#16202A}
.pop{position:absolute;right:22px;width:200px;background:#fff;border:1px solid #DFE2E6;border-radius:12px;box-shadow:0 8px 20px rgba(22,32,42,.16);padding:6px;display:flex;flex-direction:column;z-index:5}
.pop a{min-height:40px;display:flex;align-items:center;padding:0 12px;border-radius:8px;font-size:15px}
.pop a.foco{background:#F3F5F8;font-weight:600}
.btn{height:44px;border-radius:10px;padding:0 18px;font-size:15px;font-weight:600;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;border:1px solid #C9CED5;background:#fff;color:#16202A}
.grade{display:flex;gap:16px;flex:1;min-height:0}
.mapaw{flex:1;min-width:0;border-radius:16px;overflow:hidden;background:#ECEEF1;border:1px solid #C9CED5;position:relative}
.mapaw svg{position:absolute;inset:0}
.lado{width:340px;flex:none;background:#fff;border:1px solid #DFE2E6;border-radius:16px;display:flex;flex-direction:column;overflow:hidden;position:relative}
.lado .km{padding:14px 16px}
.lado .ev{padding:0 16px;font-size:15px}
.lado.rola::after{content:'';position:absolute;left:0;right:0;bottom:0;height:28px;background:linear-gradient(rgba(255,255,255,0),#fff)}
</style>`;

// Ícones no traço do kit (packages/ui/src/mobile/icon.tsx).
const svg = (d, t = 20, extra = '') => `<svg width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${extra}>${d}</svg>`;
const I = {
  esq: svg('<path d="M15 6l-6 6 6 6"/>', 22),
  dir: svg('<path d="M9 6l6 6-6 6"/>', 22),
  mapa: svg('<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>', 18),
  semSinal: svg('<path d="M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0M12 19h.01"/><path d="M3 3l18 18"/>', 40),
  pinG: svg('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>', 40),
  cal: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>', 18, ' style="color:#4A5562"'),
  baixo: svg('<path d="M6 9l6 6 6-6"/>', 18, ' style="color:#4A5562"'),
  pontos: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
};

// Marcadores: os mesmos desenhos no mapa e na lista (a lista é a legenda). Check-in = número da visita, como a Rota de hoje
// (modules/core/app/telas/rota.tsx): concluída em verde #1D6B4F, em andamento em Azul noite.
const M = {
  inicio: '<svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="6.5" fill="#fff" stroke="#1E3350" stroke-width="3"/></svg>',
  fim: '<svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="7" fill="#1E3350"/></svg>',
  agora: '<svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="10.5" fill="#DFE2E6"/><circle cx="11" cy="11" r="5.5" fill="#1E3350"/></svg>',
  semReg: '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M2 11h18" stroke="#5B6673" stroke-width="3" stroke-dasharray="3 3"/></svg>',
};
const num = (n, emCurso = false) =>
  `<svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="11" fill="${emCurso ? '#1E3350' : '#1D6B4F'}"/><text x="11" y="15" font-size="12" font-weight="600" fill="#fff" text-anchor="middle" font-family="system-ui,sans-serif">${n}</text></svg>`;

// ---------- Mapa em SVG (P1 A): ruas brancas no fundo Névoa, sem provedor de mapa, como a Rota de hoje ----------
const RUAS = `<path d="M-10 60 C80 40 140 90 220 70 S330 30 370 50" stroke="#fff" stroke-width="10" fill="none"/>
<path d="M40 -10 C60 70 30 140 70 230" stroke="#fff" stroke-width="8" fill="none"/>
<path d="M-10 170 C90 150 180 190 260 160 S340 140 370 150" stroke="#fff" stroke-width="8" fill="none"/>
<path d="M250 -10 C240 60 280 120 250 230" stroke="#fff" stroke-width="6" fill="none"/>
<path d="M150 -10 L170 230" stroke="#fff" stroke-width="5" fill="none"/>`;
// O trajeto é desenhado em coordenadas 320×220 e levado ao tamanho do mapa (T); os marcadores mantêm o tamanho em px.
let T = (x, y) => [x, y];
const P = (pts) => pts.split(' ').map((par) => T(...par.split(',').map(Number)).join(',')).join(' ');
const linha = (pts) => `<polyline points="${P(pts)}" stroke="#1E3350" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
const tracejado = (pts) => `<polyline points="${P(pts)}" stroke="#5B6673" stroke-width="3" stroke-dasharray="6 6" stroke-linecap="round" fill="none"/>`;
const mk = (tipo, x0, y0, n) => {
  const [x, y] = T(x0, y0);
  return {
    inicio: `<circle cx="${x}" cy="${y}" r="7" fill="#fff" stroke="#1E3350" stroke-width="3"/>`,
    fim: `<circle cx="${x}" cy="${y}" r="8" fill="#1E3350"/>`,
    agora: `<circle cx="${x}" cy="${y}" r="12" fill="#DFE2E6"/><circle cx="${x}" cy="${y}" r="6" fill="#1E3350"/>`,
    feito: `<circle cx="${x}" cy="${y}" r="12" fill="#1D6B4F" stroke="#fff" stroke-width="2"/><text x="${x}" y="${y + 4}" font-size="12" font-weight="600" fill="#fff" text-anchor="middle" font-family="system-ui,sans-serif">${n}</text>`,
    curso: `<circle cx="${x}" cy="${y}" r="14" fill="#1E3350" stroke="#fff" stroke-width="3"/><text x="${x}" y="${y + 5}" font-size="13" font-weight="600" fill="#fff" text-anchor="middle" font-family="system-ui,sans-serif">${n}</text>`,
  }[tipo];
};
const mapaSvg = (desenho, w, h) => {
  T = (x, y) => [Math.round((x * w) / 320), Math.round((y * h) / 220)];
  return `<svg width="${w}" height="${h}" viewBox="0 0 320 220" preserveAspectRatio="none">${RUAS}</svg><svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${desenho()}</svg>`;
};

// Dia de hoje (em visita no 3º cliente) e dia anterior (6 visitas, um trecho sem registro de 56 min).
const HOJE = {
  desenho: () =>
    linha('34,196 58,160 52,124 86,100 128,84 170,96 214,72 240,44 270,62 286,104') +
    mk('inicio', 34, 196) + mk('feito', 52, 124, 1) + mk('feito', 128, 84, 2) + mk('curso', 240, 44, 3) + mk('agora', 286, 104),
  rotulo: 'Trajeto de hoje de Carla Lima: 18,6 km até agora, início 08:04, 3 visitas, último ponto 10:12',
  km: ['Até agora', '18,6 km'],
  eventos: [
    ['inicio', 'Início', '08:04'],
    [1, 'Mercado Bom Preço', '08:22–08:51'],
    [2, 'Padaria Estrela', '09:05–09:31'],
    [-3, 'Atacadão Norte', 'desde 09:58'],
    ['agora', 'Último ponto', '10:12'],
  ],
};
const ONTEM = {
  desenho: () =>
    linha('30,52 70,36 112,60 146,108 120,160') + tracejado('120,160 170,184') + linha('170,184 222,162 256,120 288,146 298,196') +
    mk('inicio', 30, 52) + mk('feito', 70, 36, 1) + mk('feito', 112, 60, 2) + mk('feito', 146, 108, 3) + mk('feito', 120, 160, 4) +
    mk('feito', 222, 162, 5) + mk('feito', 288, 146, 6) + mk('fim', 298, 196),
  rotulo: 'Trajeto de 18/11 de Carla Lima: 42,3 km, início 08:01, 6 visitas, sem registro de 12:02 a 12:58, fim 17:52',
  km: ['Distância', '42,3 km'],
  eventos: [
    ['inicio', 'Início', '08:01'],
    [1, 'Mercado Bom Preço', '08:20–08:52'],
    [2, 'Padaria Estrela', '09:10–09:41'],
    [3, 'Atacadão Norte', '10:05–11:02'],
    [4, 'Mercearia Dois Irmãos', '11:30–11:55'],
    ['semReg', 'Sem registro', '12:02–12:58'],
    [5, 'Supermercado Rio Branco', '14:10–15:05'],
    [6, 'Empório Central', '16:20–17:31'],
    ['fim', 'Fim', '17:52'],
  ],
};
const marcador = (m) => (typeof m === 'number' ? num(Math.abs(m), m < 0) : M[m]);
const ev = ([m, txt, hora]) => `<div class="ev${m === 'semReg' ? ' sr' : ''}">${marcador(m)}<span>${txt}</span><em>${hora}</em></div>`;
const resumo = (d) => `<div class="km"><span>${d.km[0]}</span><b>${d.km[1]}</b></div>${d.eventos.map(ev).join('')}`;

// ---------- 01 · Mapa da equipe: Gestão (aparelho) ----------
const st = (hora) => `<div class="st"><span>${hora}</span><span>4G</span></div>`;
const fx = (titulo, voltar = '', sub = '') => `<div class="fx"><span class="v">${voltar ? `‹ ${voltar}` : ''}</span><h1>${titulo}</h1>${sub ? `<span class="s">${sub}</span>` : ''}</div>`;
const ln = (r, v) => `<div class="ln"><span>${r}</span><b>${v}</b></div>`;

// Ficha (modules/gestor/app/screens/ficha-screen.tsx) com o cartão novo "Trajeto", logo depois de Visitas.
const G_FICHA = `<div class="tel">${st('10:14')}${fx('Carla Lima', 'Equipe', 'Vendedor')}<div class="corpo rola">
<div class="chips"><span class="ce ok">Em visita</span></div>
<div class="cx cxp"><h2>Visitas</h2>${ln('Realizadas', '2 de 8')}${ln('Cobertura', '25%')}${ln('Tempo em cliente', '55 min')}</div>
<div class="cx cxp"><h2>Trajeto</h2>${ln('Km até agora', '18,6 km')}<span class="b2">${I.mapa}Ver no mapa</span></div>
<div class="cx cxp"><h2>Vendas do dia</h2>${ln('Vendido', 'R$ 2.480')}${ln('Pedidos', '2')}${ln('Positivados', '2')}${ln('Desconto médio', '3%')}</div>
<i class="rolagem"></i></div></div>`;

const dia = (txt, proximo = true) => `<div class="dia"><span class="seta" role="button" aria-label="Dia anterior">${I.esq}</span><b>${txt}</b><span class="seta${proximo ? '' : ' off'}" role="button" aria-label="Próximo dia">${I.dir}</span></div>`;
const mapaG = (d) => `<div class="mapa" style="height:236px" role="img" aria-label="${d.rotulo}">${mapaSvg(d.desenho, 318, 234)}</div>`;
const trajeto = (hora, meio, rola = false) => `<div class="tel">${st(hora)}${fx('Trajeto', 'Carla Lima')}<div class="corpo${rola ? ' rola' : ''}">${meio}${rola ? '<i class="rolagem" style="top:auto;bottom:40px"></i>' : ''}</div></div>`;

const G_HOJE = trajeto('10:15', dia('Hoje · qua 19/11', false) + mapaG(HOJE) + `<div class="cx">${resumo(HOJE)}</div>`);
const G_ONTEM = trajeto('10:16', dia('Ontem · ter 18/11') + mapaG(ONTEM) + `<div class="cx">${resumo(ONTEM)}</div>`, true);
const G_NADA = trajeto('10:17', dia('dom 16/11') + `<div class="vazio">${I.pinG}<b>Nada registrado neste dia</b></div>`);
const G_SEM_SINAL = trajeto('10:18', dia('Ontem · ter 18/11') + `<div class="vazio">${I.semSinal}<b>Sem sinal</b><span class="b2" style="align-self:stretch;margin-top:8px">Tentar de novo</span></div>`);

// ---------- 01 · Mapa da equipe: BKO (1366×768) ----------
const MENU = [
  { g: 'Acesso' },
  { g: 'Análise', itens: ['Indicadores', 'Metas', 'Painel da equipe', 'Ranking'] },
  { g: 'Cadastros' },
  { g: 'Comunicação' },
  { g: 'Operação' },
  { g: 'Produtos' },
  { g: 'Trade' },
  { g: 'Parâmetros' },
  { g: 'Sistema' },
];
const seta = (aberto) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${aberto ? 90 : 0}deg)"><path d="M9 6l6 6-6 6"/></svg>`;
const menu = () =>
  `<nav class="menu"><div class="brand"><img src="${LOGO}" height="28" alt="Macuxi Força de Vendas"><span>Distribuidora Norte</span></div><div class="lista">${MENU.map((e) =>
    e.itens
      ? `<div class="titulo" aria-expanded="true"><span>${e.g}</span>${seta(true)}</div>${e.itens.map((i) => `<a class="item${i === 'Painel da equipe' ? ' ativo" aria-current="page' : ''}">${i}</a>`).join('')}`
      : `<div class="titulo" aria-expanded="false"><span>${e.g}</span>${e.g === 'Parâmetros' ? '' : seta(false)}</div>`,
  ).join('')}</div><div class="rodape"><b>Rui Matos</b><span>Supervisor</span></div></nav>`;
const web = (corpo) => `<div class="web">${menu()}<main>${corpo}</main></div>`;
const campoW = (rot, valor, icone) => `<label class="campo">${rot}<span class="input">${valor}${icone}</span></label>`;

const PESSOAS = [
  ['Carla Lima', 'Vendedor', ['s-ok', 'Em visita'], '2/8', '18,6 km', 'R$ 2.480'],
  ['Diego Alves', 'Vendedor', ['s-pe', 'Em rota'], '3/7', '24,1 km', 'R$ 3.150'],
  ['Elisa Torres', 'Promotor', ['s-ok', 'Em visita'], '4/6', '12,9 km', '—'],
  ['Fábio Nunes', 'Vendedor', ['s-av', 'Sem check-in'], '0/8', '—', 'R$ 0'],
  ['Joana Prado', 'Vendedor', ['s-pe', 'Em rota'], '1/6', '9,4 km', 'R$ 860'],
];
const W_PAINEL = web(`<div class="topo"><h1>Painel da equipe (5)</h1><span class="btn" aria-label="Mais ações">${I.pontos}</span></div>
<div class="filtros">${campoW('Dia', '19/11/2026', I.cal)}</div>
<div class="kpis"><div class="kpi"><span>Em visita</span><b>2</b><small>2 em rota · 1 sem check-in</small></div><div class="kpi"><span>Vendas do dia</span><b>R$ 6.490</b><small>6 pedidos</small></div><div class="kpi"><span>Cobertura</span><b>29%</b><small>10 de 35 planejadas</small></div><div class="kpi"><span>Meta do mês</span><b>58%</b><small>meta R$ 420.000</small></div></div>
<div class="quadro"><table><colgroup><col><col style="width:110px"><col style="width:140px"><col style="width:90px"><col style="width:110px"><col style="width:120px"><col style="width:52px"></colgroup>
<thead><tr><th>Nome</th><th>Perfil</th><th>Situação</th><th class="n">Visitas</th><th class="n">Km</th><th class="n">Vendas</th><th><span hidden>Ações</span></th></tr></thead><tbody>
${PESSOAS.map(([n, p, [tom, s], v, km, r], i) => `<tr${i === 0 ? ' class="sel"' : ''}><td>${n}</td><td>${p}</td><td><span class="selo ${tom}">${s}</span></td><td class="n">${v}</td><td class="n">${km}</td><td class="n">${r}</td><td class="ac"><span class="dots${i === 0 ? ' on' : ''}" role="button" aria-label="Ações de ${n}">${I.pontos}</span></td></tr>`).join('')}
</tbody></table><div class="pop" role="menu" style="top:92px"><a class="foco" role="menuitem">Ver trajeto</a></div></div>`);

const W_TRAJETO = web(`<div><a class="migalha">‹ Painel da equipe</a><div class="topo"><h1>Trajeto de Carla Lima</h1></div></div>
<div class="filtros">${campoW('Pessoa', 'Carla Lima', I.baixo)}${campoW('Dia', '18/11/2026', I.cal)}</div>
<div class="grade"><div class="mapaw" role="img" aria-label="${ONTEM.rotulo}">${mapaSvg(ONTEM.desenho, 708, 478)}</div>
<div class="lado">${resumo(ONTEM)}</div></div>`);

// ---------- 02 · Notificação fixa (Campo) ----------
const sbIcone = `<img class="sbi" src="${ICONE_NOT}" alt="" style="filter:brightness(0)">`;
const android = (hora, icones, notif) => `<div class="tel"><div class="and"><div class="sb"><span>${hora}</span><span class="ic">${icones}<span>4G</span></span></div>
<div class="rel">${hora}</div><div class="rapidos" aria-hidden="true"><i></i><i></i><i></i><i></i></div>${notif}</div></div>`;
const N_ATIVA = android(
  '09:41',
  sbIcone,
  `<span class="grupo">Silenciosas</span><div class="not" role="listitem"><span class="pi"><img src="${ICONE_NOT}" alt=""></span><span class="txt"><span class="ap">Macuxi Campo · agora</span><b>Macuxi Campo ativo</b></span><span class="chev">${svg('<path d="M6 9l6 6 6-6"/>', 18)}</span></div><span class="gerir">Gerenciar</span>`,
);
const N_FORA = android('18:05', '', '<div class="nada">Nenhuma notificação</div>');

// Conferência (padrão de docs/design/pedido-aprovacao/gerar.mjs): a legenda e a nota não cobrem a tela, nada sai do aparelho ou
// da página do BKO, nada fica cortado na largura e, fora das áreas com rolagem simulada (.rola), nada passa do corpo.
const CONFERIR = `<script>window.addEventListener('load',()=>{const conflitos=[];
for(const col of document.querySelectorAll('.col')){const tel=col.querySelector('.tel,.web').getBoundingClientRect();
const sobre=[...col.querySelectorAll('.leg,.nota')].map(e=>[e.className,e.getBoundingClientRect()]);
for(const el of col.querySelectorAll('.tel *,.web *')){if(el.closest('svg')&&el.tagName!=='svg')continue;
if(el.children.length&&!el.matches('.ce,.b2,.bt,.btn,.input,.ev,.km,.ln,.kpi,.selo,td,th,h1,h2,b,small,.ap,em,a'))continue;
const rola=el.closest('.rola');let r=el.getBoundingClientRect();
if(rola){const c=rola.getBoundingClientRect();const top=Math.max(r.top,c.top),bottom=Math.min(r.bottom,c.bottom);if(bottom<=top)continue;r={left:r.left,right:r.right,top,bottom,width:r.width,height:bottom-top};}
if(!r.width||!r.height)continue;const t=el.className.baseVal??el.className;const nome=t+': '+el.textContent.trim().slice(0,30);
for(const [n,s] of sobre){if(r.left<s.right&&r.right>s.left&&r.top<s.bottom&&r.bottom>s.top)conflitos.push(n+' cobre '+nome);}
if((r.left<tel.left-1||r.right>tel.right+1||r.top<tel.top-1||r.bottom>tel.bottom+1))conflitos.push('fora da tela: '+nome);
const corpo=el.closest('.corpo,main');if(corpo&&!rola){const c=corpo.getBoundingClientRect();if(r.bottom>c.bottom+1||r.right>c.right+1)conflitos.push('cortado no corpo: '+nome);}
if(el.scrollWidth>el.clientWidth+1&&getComputedStyle(el).overflow!=='visible')conflitos.push('cortado: '+nome);}}
document.body.dataset.info=JSON.stringify({conflitos});document.body.dataset.pronto='1';})</script>`;

const coluna = ([leg, tela, nota]) => `<div class="col${tela.startsWith('<div class="web"') ? ' w' : ''}"><span class="leg">${leg}</span>${tela}${nota ? `<div class="nota">${nota}</div>` : ''}</div>`;
// filas: cada fila é uma linha de colunas (aparelhos lado a lado; o BKO numa fila própria).
const prancha = (titulo, filas) =>
  `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>T-0156 · ${titulo}</title>${CSS}<body>${filas.map((f) => `<div class="fila">${f.map(coluna).join('')}</div>`).join('')}${CONFERIR}</body></html>`;

const PRANCHAS = {
  '01-mapa-equipe': prancha('mapa da equipe', [
    [
      ['Gestão · Ficha da pessoa: cartão "Trajeto" com o km de hoje e "Ver no mapa"', G_FICHA, 'O cartão só aparece com o rastreamento ligado pela empresa e a permissão core.trajeto.ver_equipe.'],
      ['Gestão · Trajeto de hoje: km até agora, início, check-ins e último ponto', G_HOJE],
      ['Gestão · Dia anterior: distância, check-ins, trecho sem registro e fim', G_ONTEM],
      ['Gestão · Dia sem registro (fim de semana, feriado, ausência)', G_NADA],
      ['Gestão · Sem sinal: o trajeto não fica guardado no aparelho (P3 A)', G_SEM_SINAL],
    ],
    [['BKO · Análise › Painel da equipe: coluna Km e "Ver trajeto" no menu da linha', W_PAINEL]],
    [['BKO · Trajeto de Carla Lima: pessoa e dia nos filtros, mapa e resumo do dia ao lado', W_TRAJETO]],
  ]),
  '02-notificacao': prancha('notificação fixa', [
    [
      ['Campo · Android, no expediente: a notificação fixa em "Silenciosas"', N_ATIVA, 'Canal "Serviço do app", importância baixa, sem som e sem ação. Ícone monocromático da marca; o sistema pinta.'],
      ['Campo · Android, fora do expediente: a notificação some', N_FORA],
    ],
  ]),
};

await gerarPranchas(AQUI, Object.fromEntries(Object.entries(PRANCHAS).map(([nome, html]) => [nome, [html]])));
