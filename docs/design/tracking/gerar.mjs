// Simulação da T-0156 (rastreamento no expediente) como ficou na v1.0.15: o trajeto do dia na Ficha do Gestão
// (modules/gestor/app/components/trajeto-do-dia.tsx), a página Análise › Trajeto do dia do BKO
// (modules/gestor/web/pages/trajeto-do-dia.tsx) e a notificação fixa do Android no Campo (apps/mobile/src/lib/trajeto.ts e
// apps/mobile/plugins/notificacao-trajeto.ts). Gera os HTMLs e os PNGs.
// Uso, a partir da raiz do repositório: node docs/design/tracking/gerar.mjs
// Aparelho 360×760 (como docs/design/pedido-aprovacao/gerar.mjs) e BKO 1366×768 (base de docs/design/menu-parametros/gerar.mjs).
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gerarPranchas } from '../_comum/navegador.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const LOGO = '../../marca/ativos/2026-11-12-v1/macuxi-logo-negativo-grafite.svg';
const ICONE_NOT = '../../marca/ativos/2026-11-12-v1/icone-notificacao-96.png';

// Cores só do kit: packages/ui/src/comum/contraste.ts (MARCA, DESTAQUE, FUNDOS) e apps/web/app/globals.css (MC-1781).
// Fonte do sistema; escala 12 · 14 · 16 · 18 · 22 · 28.
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
.corpo{flex:1;min-height:0;padding:14px 20px;display:flex;flex-direction:column;justify-content:flex-end;gap:14px;overflow:hidden;position:relative}
.corpo.rola::before{content:'';position:absolute;left:0;right:0;top:0;height:28px;z-index:1;background:linear-gradient(#F8F6F1,rgba(248,246,241,0))}
.rolagem{position:absolute;right:3px;bottom:6px;width:4px;height:120px;border-radius:2px;background:#C9CED5}
.cx{background:#fff;border:1px solid #DFE2E6;border-radius:14px;flex:none}
.cxp{padding:14px;display:flex;flex-direction:column;gap:6px}
.cxp.t{gap:8px}
.cxp h2{font-size:18px;font-weight:700;line-height:24px}
.ln{display:flex;justify-content:space-between;min-height:24px;font-size:16px}.ln b{font-weight:600;font-variant-numeric:tabular-nums}
.cxp p{font-size:16px;line-height:22px}
.bt{height:52px;flex:none;border-radius:14px;background:#1E3350;color:#fff;font-size:16px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:8px}
.mapa{flex:none;height:200px;border-radius:18px;overflow:hidden;background:#ECEEF1;border:1px solid #C9CED5}
.mapa svg{display:block}
/* Android: aba de notificações (interface do sistema, desenhada com as cores do kit). */
.and{background:#ECEEF1;flex:1;display:flex;flex-direction:column}
.and .sb{height:28px;flex:none;display:flex;justify-content:space-between;align-items:center;padding:0 16px;font-size:13px;font-weight:600;color:#16202A}
.and .rel{padding:12px 20px 8px;font-size:28px;font-weight:400;color:#16202A}
.and .rapidos{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 12px 14px}
.and .rapidos i{height:56px;border-radius:28px;background:#DFE2E6}
.and .grupo{font-size:13px;font-weight:600;color:#4A5562;padding:6px 24px}
.not{margin:0 12px;background:#fff;border-radius:20px;padding:14px 16px;display:flex;gap:12px;align-items:flex-start}
.not .pi{width:32px;height:32px;flex:none;border-radius:16px;background:#1E3350;display:flex;align-items:center;justify-content:center}
.not .pi img{width:22px;height:22px}
.not .txt{flex:1;display:flex;flex-direction:column;gap:2px;min-width:0}
.not .ap{font-size:12px;color:#4A5562}
.not b{font-size:15px;font-weight:600;color:#16202A}
.not .chev{color:#4A5562;flex:none}
.and .gerir{display:flex;justify-content:flex-end;padding:12px 20px;font-size:14px;font-weight:600;color:#4A5562}
.and .nada{text-align:center;font-size:14px;color:#4A5562;padding:24px}
.nota{font-size:12px;line-height:1.5;color:#34404D;background:#fff;border:1px solid #DFE2E6;border-left:4px solid #C9CED5;border-radius:8px;padding:8px 12px}
/* BKO 1366×768: base visual de docs/design/menu-parametros (menu lateral); campos, Panel e EstadoVazio de packages/ui/src/web/ui.tsx. */
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
.topo h1{font-weight:700;font-size:24px;line-height:1.2;min-height:42px;display:flex;align-items:center}
.filtros{display:flex;gap:10px;align-items:flex-end}
.campo{display:flex;flex-direction:column;gap:3px;font-size:12px;font-weight:600;color:#4A5562}
.input{height:38px;min-width:180px;border:1px solid #C9CED5;border-radius:10px;background:#fff;font-size:15px;font-weight:500;color:#16202A;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 10px;font-variant-numeric:tabular-nums}
.painel{background:#fff;border:1px solid #DFE2E6;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:12px;min-width:0}
.mapaw{border-radius:18px;overflow:hidden;background:#ECEEF1;border:1px solid #C9CED5}
.mapaw svg{display:block;width:100%;height:auto}
.painel p{font-size:14px;font-variant-numeric:tabular-nums}
.vaziow{display:flex;flex-direction:column;align-items:center;gap:12px;padding:40px 24px;text-align:center;border:1px dashed #C9CED5;border-radius:16px}
.vaziow span{font-size:15px;font-weight:600;color:#4A5562}
</style>`;

const svg = (d, t = 20, extra = '') => `<svg width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${extra}>${d}</svg>`;
const I = {
  mais: svg('<path d="M12 5v14M5 12h14"/>', 20),
  cal: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>', 18, ' style="color:#4A5562"'),
  baixo: svg('<path d="M6 9l6 6 6-6"/>', 18, ' style="color:#4A5562"'),
};

// ---------- Desenho do trajeto (desenharTrajeto do modules/gestor/domain/trajeto.ts) ----------
// Sem ruas e sem provedor de mapa: fundo Névoa, uma linha sólida em Azul noite pelos pontos em ordem de hora, o primeiro ponto
// vazado e o último cheio. Pontos de exemplo em [0,1], levados à caixa com a margem do código (16 no app, 24 no BKO).
const PONTOS = [
  [0.02, 0.98], [0.1, 0.78], [0.08, 0.58], [0.22, 0.48], [0.38, 0.4], [0.52, 0.47], [0.66, 0.3], [0.76, 0.06], [0.86, 0.2], [0.98, 0.42],
];
const desenho = (w, h, m) => {
  const xy = PONTOS.map(([x, y]) => [Math.round(m + x * (w - 2 * m)), Math.round(m + y * (h - 2 * m))]);
  const [x0, y0] = xy[0];
  const [x1, y1] = xy[xy.length - 1];
  return `<svg viewBox="0 0 ${w} ${h}" width="100%"${h === 200 ? ' height="200"' : ''} role="img" aria-label="Trajeto do dia com 10 pontos, de 08:04 a 10:12">
<polyline points="${xy.map((p) => p.join(',')).join(' ')}" stroke="#1E3350" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
<circle cx="${x0}" cy="${y0}" r="7" fill="#fff" stroke="#1E3350" stroke-width="3"/><circle cx="${x1}" cy="${y1}" r="8" fill="#1E3350"/></svg>`;
};

// ---------- 01 · Gestão: Ficha da pessoa, rolada até o fim ----------
const st = (hora) => `<div class="st"><span>${hora}</span><span>4G</span></div>`;
const fx = (titulo, voltar, sub) => `<div class="fx"><span class="v">‹ ${voltar}</span><h1>${titulo}</h1><span class="s">${sub}</span></div>`;
const ln = (r, v) => `<div class="ln"><span>${r}</span><b>${v}</b></div>`;
const VISITAS = `<div class="cx cxp"><h2>Visitas</h2>${ln('Realizadas', '2 de 8')}${ln('Cobertura', '25%')}${ln('Tempo em cliente', '55 min')}</div>`;
const VENDAS = `<div class="cx cxp"><h2>Vendas do dia</h2>${ln('Vendido', 'R$ 2.480')}${ln('Pedidos', '2')}${ln('Positivados', '2')}${ln('Desconto médio', '3%')}</div>`;
const MES = `<div class="cx cxp"><h2>Mês</h2>${ln('Vendido no mês', 'R$ 38.900')}${ln('Meta', 'R$ 84.000')}${ln('Atingido', '46%')}${ln('Precisa por dia', 'R$ 3.785')}</div>`;
const PEDIDO = `<span class="bt">${I.mais}Fazer pedido em nome de Carla</span>`;
const ficha = (hora, trajeto) =>
  `<div class="tel">${st(hora)}${fx('Carla Lima', 'Equipe', 'Vendedor')}<div class="corpo rola">${VISITAS}${VENDAS}${MES}${trajeto}${PEDIDO}<i class="rolagem"></i></div></div>`;

const T_COM = `<div class="cx cxp t"><h2>Trajeto do dia</h2><div class="mapa">${desenho(320, 200, 16)}</div>${ln('Primeiro ponto', '08:04')}${ln('Último ponto', '10:12')}${ln('Percorrido', '18,6 km')}</div>`;
const T_SEM = `<div class="cx cxp t"><h2>Trajeto do dia</h2><p>Sem trajeto</p></div>`;
const G_COM = ficha('10:14', T_COM);
const G_SEM = ficha('10:15', T_SEM);

// ---------- 01 · BKO: Análise › Trajeto do dia ----------
// Menu em ordem alfabética (apps/web/lib/menu-bko.ts); a página só entra no menu de quem tem core.trajeto.ver_equipe.
const MENU = [
  { g: 'Acesso' },
  { g: 'Análise', itens: ['Indicadores', 'Metas', 'Painel da equipe', 'Ranking', 'Trajeto do dia'] },
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
      ? `<div class="titulo" aria-expanded="true"><span>${e.g}</span>${seta(true)}</div>${e.itens.map((i) => `<a class="item${i === 'Trajeto do dia' ? ' ativo" aria-current="page' : ''}">${i}</a>`).join('')}`
      : `<div class="titulo" aria-expanded="false"><span>${e.g}</span>${e.g === 'Parâmetros' ? '' : seta(false)}</div>`,
  ).join('')}</div><div class="rodape"><b>Rui Matos</b><span>Supervisor</span></div></nav>`;
const campoW = (rot, valor, icone) => `<label class="campo">${rot}<span class="input">${valor}${icone}</span></label>`;
const web = (painel) =>
  `<div class="web">${menu()}<main><div class="topo"><h1>Trajeto do dia</h1></div><div class="filtros">${campoW('Dia', '19/11/2026', I.cal)}${campoW('Pessoa', 'Carla Lima', I.baixo)}</div>${painel}</main></div>`;

const W_COM = web(`<section class="painel"><div class="mapaw">${desenho(640, 320, 24)}</div><p>Primeiro ponto 08:04 · último 10:12 · 18,6 km</p></section>`);
const W_SEM = web(`<section class="painel"><div class="vaziow"><span>Sem trajeto</span></div></section>`);

// ---------- 02 · Notificação fixa (Campo) ----------
const android = (hora, notif) => `<div class="tel"><div class="and"><div class="sb"><span>${hora}</span><span>4G</span></div>
<div class="rel">${hora}</div><div class="rapidos" aria-hidden="true"><i></i><i></i><i></i><i></i></div>${notif}</div></div>`;
const N_ATIVA = android(
  '09:41',
  `<span class="grupo">Silenciosas</span><div class="not" role="listitem"><span class="pi"><img src="${ICONE_NOT}" alt=""></span><span class="txt"><span class="ap">Macuxi Campo · agora</span><b>Macuxi Campo ativo</b></span><span class="chev">${svg('<path d="M6 9l6 6 6-6"/>', 18)}</span></div><span class="gerir">Gerenciar</span>`,
);
const N_FORA = android('18:05', '<div class="nada">Nenhuma notificação</div>');

// Conferência (padrão de docs/design/pedido-aprovacao/gerar.mjs): a legenda e a nota não cobrem a tela, nada sai do aparelho ou
// da página do BKO, nada fica cortado na largura e, fora das áreas com rolagem simulada (.rola), nada passa do corpo.
const CONFERIR = `<script>window.addEventListener('load',()=>{const conflitos=[];
for(const col of document.querySelectorAll('.col')){const tel=col.querySelector('.tel,.web').getBoundingClientRect();
const sobre=[...col.querySelectorAll('.leg,.nota')].map(e=>[e.className,e.getBoundingClientRect()]);
for(const el of col.querySelectorAll('.tel *,.web *')){if(el.closest('svg')&&el.tagName!=='svg')continue;
if(el.children.length&&!el.matches('.bt,.input,.ln,h1,h2,b,small,.ap,em,a,p'))continue;
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
      ['Gestão · Ficha da pessoa, no fim: dia com pontos', G_COM],
      ['Gestão · Ficha da pessoa, no fim: dia sem pontos', G_SEM],
    ],
    [['BKO · Análise › Trajeto do dia: dia e pessoa escolhidos, com pontos', W_COM]],
    [['BKO · Análise › Trajeto do dia: dia sem pontos', W_SEM]],
  ]),
  '02-notificacao': prancha('notificação fixa', [
    [
      ['Campo · Android, no expediente', N_ATIVA],
      ['Campo · Android, fora do expediente', N_FORA],
    ],
  ]),
};

await gerarPranchas(AQUI, Object.fromEntries(Object.entries(PRANCHAS).map(([nome, html]) => [nome, [html]])));
