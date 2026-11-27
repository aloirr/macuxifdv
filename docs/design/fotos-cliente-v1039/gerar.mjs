// Simulações da v1.0.39 (R-20261126-204135 e R-20261126-204214-alexandre): fotos do cliente por item (fachada e cada documento).
// BKO: até 3 fotos por item, a mais recente destacada; app (Campo e Gestão): só a última.
// Uso, a partir da raiz do repositório: node docs/design/fotos-cliente-v1039/gerar.mjs
// Escreve os .html e .png desta pasta (1366 de largura no BKO, escala 2).
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gerarPranchas } from '../_comum/navegador.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const LOGO = '../../marca/ativos/2026-11-12-v1/macuxi-logo-negativo-grafite.svg';

const MENU = [
  { g: 'Acesso' },
  { g: 'Análise' },
  { g: 'Cadastros', itens: ['Carteira', 'Clientes', 'Coordenadas sugeridas', 'Filiais', 'Formas de pagamento e prazos', 'Transportadoras'] },
  { g: 'Comunicação' },
  { g: 'Operação' },
  { g: 'Produtos' },
  { i: 'Parâmetros' },
  { g: 'Sistema' },
];
const seta = (aberto) =>
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${aberto ? 90 : 0}deg)"><path d="M9 6l6 6-6 6"/></svg>`;
const xis = (cor = 'currentColor') =>
  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${cor}" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
const ampliarIco = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16202A" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`;
const fotoIco = (cor) =>
  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${cor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-9 8"/></svg>`;
const setaLado = (dir) =>
  `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${dir === 'e' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'}"/></svg>`;

// "Fotos" desenhadas: fachada (3 variações de luz e letreiro) e documentos (papel com linhas).
function fachada(v) {
  const ceu = ['#BFD7EA', '#D9E4EC', '#F2D7B6'][v];
  const placa = ['#A8261B', '#1E3350', '#1D6B4F'][v];
  const porta = ['#4A5562', '#34404D', '#5B6673'][v];
  return `<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg"><rect width="400" height="300" fill="${ceu}"/><rect y="230" width="400" height="70" fill="#8B96A3"/><rect x="60" y="70" width="280" height="165" fill="#EDE6D6"/><rect x="60" y="70" width="280" height="44" fill="${placa}"/><text x="200" y="99" font-family="system-ui,sans-serif" font-size="20" font-weight="700" fill="#fff" text-anchor="middle">SÃO JORGE</text><rect x="88" y="132" width="82" height="103" fill="${porta}"/><rect x="230" y="132" width="82" height="103" fill="${porta}"/>${v === 1 ? '<rect x="40" y="250" width="70" height="28" rx="4" fill="#16202A" opacity=".55"/>' : ''}</svg>`;
}
function documento(tipo) {
  const linhas = Array.from({ length: 7 }, (_, i) => `<rect x="${tipo === 'cnh' ? 150 : 90}" y="${tipo === 'cnh' ? 112 + i * 16 : 70 + i * 24}" width="${tipo === 'cnh' ? 150 - (i % 3) * 30 : 220 - (i % 3) * 40}" height="7" rx="3" fill="#C9CED5"/>`).join('');
  if (tipo === 'cnh')
    return `<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg"><rect width="400" height="300" fill="#6B5A48"/><rect x="60" y="70" width="280" height="170" rx="10" fill="#E5EBDD"/><rect x="60" y="70" width="280" height="26" rx="10" fill="#1D6B4F"/><rect x="78" y="112" width="58" height="76" rx="4" fill="#B8C0B0"/>${linhas.slice(0, 5)}</svg>`;
  return `<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg"><rect width="400" height="300" fill="#7A6E62"/><rect x="70" y="30" width="260" height="250" fill="#FBFAF7" transform="rotate(-2 200 150)"/><rect x="90" y="46" width="130" height="10" rx="3" fill="#4A5562"/>${linhas}</svg>`;
}

function menu() {
  const linhas = MENU.map((e) => {
    if (e.i) return `<a class="titulo direto"><span>${e.i}</span></a>`;
    const abre = Boolean(e.itens);
    const lista = abre ? e.itens.map((i) => `<a class="item${i === 'Clientes' ? ' ativo" aria-current="page' : ''}">${i}</a>`).join('') : '';
    return `<div class="grupo"><div class="titulo" aria-expanded="${abre}"><span>${e.g}</span>${seta(abre)}</div>${lista}</div>`;
  }).join('');
  return `<nav class="menu"><div class="brand"><img src="${LOGO}" height="28" alt="Macuxi Força de Vendas"><span>Distribuidora Exemplo</span></div><div class="lista">${linhas}</div><div class="rodape"><b>Ana Souza</b><span>Administrador</span><div class="sair">↪ Trocar perfil</div></div></nav>`;
}

const CSS = `*{box-sizing:border-box;margin:0}
body{font-family:system-ui,'Segoe UI',Roboto,-apple-system,sans-serif;background:#F8F6F1;color:#16202A;width:1366px;min-height:768px;display:flex;position:relative;font-variant-numeric:tabular-nums}
.menu{width:240px;min-height:768px;background:#16202A;color:#fff;display:flex;flex-direction:column;padding:20px 12px 16px;flex-shrink:0}
.brand{display:flex;flex-direction:column;align-items:flex-start;padding:0 8px 16px}
.brand img{display:block;height:28px;width:auto}
.brand span{font-size:12px;line-height:16px;color:#C9CED5;margin-top:18px}
.lista{display:flex;flex-direction:column;gap:2px;flex:1}
.titulo{display:flex;justify-content:space-between;align-items:center;height:30px;padding:0 10px;border-radius:8px;color:#F59A52;font-size:12px;font-weight:600;letter-spacing:.07em;text-transform:uppercase}
.item{display:flex;align-items:center;min-height:32px;padding:6px 10px 6px 20px;line-height:20px;border-radius:8px;font-size:15px;color:#C9CED5;position:relative}
.item.ativo{background:#2B3743;color:#fff;font-weight:600}
.item.ativo:before{content:'';position:absolute;left:8px;top:8px;bottom:8px;width:3px;border-radius:2px;background:#F59A52}
.rodape{margin-top:12px;border-top:1px solid #2B3743;padding:12px 8px 0;display:flex;flex-direction:column}
.rodape b{font-size:15px}.rodape span{font-size:12px;color:#C9CED5}.sair{font-size:13px;font-weight:600;color:#C9CED5;margin-top:8px}
main{flex:1;min-width:0;padding:28px 32px;display:flex;flex-direction:column;gap:20px}
.cab h1{font-weight:700;font-size:24px;line-height:1.2}
.cab p{font-size:14px;color:#4A5562;margin-top:6px}
.cab code{font-family:ui-monospace,"Cascadia Mono","Roboto Mono",monospace;font-size:13px;color:#16202A}
.cab small{font-size:12px;font-weight:500;color:#4A5562;margin-right:4px}
.quadro{background:#fff;border:1px solid #DFE2E6;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:14px}
h2{font-weight:700;font-size:17px}
.grade{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
.foto-item{border:1px solid #DFE2E6;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px}
h3{font-size:16px;font-weight:600;line-height:22px}
.principal{position:relative;display:block;width:100%;aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:#ECEEF1}
.principal svg,.mini svg,.palco svg,.tela-foto svg{display:block;width:100%;height:100%}
.ampliar{position:absolute;top:10px;right:10px;width:40px;height:40px;border-radius:10px;background:#fff;border:1px solid #7A8593;display:flex;align-items:center;justify-content:center}
.legenda{display:flex;align-items:center;gap:8px;font-size:14px;color:#34404D;min-height:24px}
.selo{display:inline-flex;align-items:center;padding:3px 8px;line-height:16px;border-radius:8px;font-size:12px;font-weight:600;white-space:nowrap;color:#1E3350;background:#DFE2E6}
.antigas{display:flex;flex-direction:column;border-top:1px solid #ECEEF1}
.antiga{display:flex;align-items:center;gap:12px;min-height:60px;border-bottom:1px solid #ECEEF1;font-size:14px;color:#34404D}
.antiga:last-child{border-bottom:0}
.mini{width:64px;height:48px;border-radius:6px;overflow:hidden;flex-shrink:0;border:1px solid #DFE2E6}
.sem{border:1px dashed #C9CED5;border-radius:10px;height:120px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;font-size:15px;font-weight:600;color:#4A5562;background:#F8F6F1}
.proximo{opacity:.55}
.veu{position:absolute;inset:0;background:rgba(22,32,42,.94);z-index:5;display:flex;flex-direction:column}
.vcab{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;color:#fff}
.vcab b{font-size:17px;display:block}.vcab span{font-size:14px;color:#C9CED5}
.vdir{display:flex;align-items:center;gap:16px;font-size:15px;color:#C9CED5;font-weight:600}
.vfechar{width:44px;height:44px;border-radius:10px;border:1px solid #C9CED5;display:flex;align-items:center;justify-content:center}
.vmeio{flex:1;display:flex;align-items:center;justify-content:center;gap:24px}
.palco{width:880px;height:495px;border-radius:8px;overflow:hidden}
.lado{width:48px;height:48px;border-radius:24px;background:rgba(255,255,255,.14);border:1px solid #C9CED5;display:flex;align-items:center;justify-content:center}
.vrod{display:flex;justify-content:center;align-items:center;gap:10px;padding:16px 0 28px;color:#fff;font-size:15px}`;

const pronto = `<script>document.fonts.ready.then(()=>{document.body.dataset.info=JSON.stringify({conflitos:[]});document.body.dataset.pronto='1';});</script>`;

const CLIENTE = 'Mercadinho São Jorge';
const ITENS = [
  { nome: 'Fachada', fotos: [[fachada(0), '26/11/2026 14:32', 'Carlos Lima'], [fachada(1), '18/11/2026 09:12', 'Carlos Lima'], [fachada(2), '03/10/2026 16:47', 'Rita Alves']] },
  { nome: 'CNH do sócio', fotos: [[documento('cnh'), '23/11/2026 10:05', 'Carlos Lima'], [documento('cnh'), '12/08/2026 11:20', 'Rita Alves']] },
  { nome: 'Contrato social', fotos: [[documento('contrato'), '24/11/2026 16:05', '']] },
  { nome: 'Comprovante de endereço', fotos: [] },
];
const quando = (d, quem) => (quem ? `${d} · ${quem}` : d);

function cartao({ nome, fotos }) {
  if (!fotos.length)
    return `<article class="foto-item"><h3>${nome}</h3><div class="sem">${fotoIco('#4A5562')}Sem foto</div></article>`;
  const [[svg, d, quem], ...resto] = fotos;
  const antigas = resto.length
    ? `<div class="antigas">${resto.map(([s, dd, qq]) => `<a class="antiga" aria-label="Ampliar foto de ${dd}"><span class="mini">${s}</span>${quando(dd, qq)}</a>`).join('')}</div>`
    : '';
  return `<article class="foto-item"><h3>${nome}</h3><a class="principal" aria-label="Ampliar ${nome}">${svg}<span class="ampliar" title="Ampliar">${ampliarIco}</span></a><div class="legenda"><span class="selo">Mais recente</span>${quando(d, quem)}</div>${antigas}</article>`;
}

function ficha() {
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Cliente — fotos</title><style>${CSS}</style><body>${menu()}<main>
<div class="cab"><h1>${CLIENTE}</h1><p><small>ERP</small><code>004512</code> · <small>FDV</small><code>00031</code> · Mercadinho São Jorge Ltda · 45.723.174/0001-10 · Manaus / AM</p></div>
<section class="quadro" aria-labelledby="t-fotos"><h2 id="t-fotos">Fotos</h2><div class="grade">${ITENS.map(cartao).join('')}</div></section>
<section class="quadro proximo"><h2>Contatos</h2></section>
</main>${pronto}</body></html>`;
}

function ampliar() {
  const [svg, d, quem] = ITENS[0].fotos[1];
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Cliente — ampliar foto</title><style>${CSS}</style><body>${menu()}<main>
<div class="cab"><h1>${CLIENTE}</h1></div><section class="quadro"><h2>Fotos</h2><div class="grade">${ITENS.slice(0, 2).map(cartao).join('')}</div></section></main>
<div class="veu" role="dialog" aria-modal="true" aria-label="Fachada, foto 2 de 3"><div class="vcab"><div><b>Fachada</b><span>${CLIENTE}</span></div><div class="vdir">2 de 3<span class="vfechar" aria-label="Fechar">${xis('#fff')}</span></div></div>
<div class="vmeio"><span class="lado" aria-label="Foto anterior">${setaLado('e')}</span><div class="palco">${svg}</div><span class="lado" aria-label="Próxima foto">${setaLado('d')}</span></div>
<div class="vrod">${quando(d, quem)}</div></div>${pronto}</body></html>`;
}

// App (Campo e Gestão): a seção da ficha e o visualizador com só a última foto do item.
const CSS_APP = `*{box-sizing:border-box;margin:0}
body{font-family:system-ui,'Segoe UI',Roboto,-apple-system,sans-serif;background:#E4E6E2;color:#16202A;width:820px;padding:28px 32px 32px;display:flex;flex-direction:column;gap:14px}
.rot{font-size:13px;font-weight:600;color:#34404D}
.pares{display:flex;gap:36px}
.col{display:flex;flex-direction:column;gap:8px}
.cel{width:360px;height:720px;border-radius:28px;overflow:hidden;background:#F8F6F1;border:1px solid #C9CED5;display:flex;flex-direction:column}
.faixa{background:#1E3350;color:#fff;padding:14px 16px 18px}
.st{display:flex;justify-content:space-between;font-size:12px;font-weight:600;margin-bottom:14px}
.faixa b{font-size:22px;line-height:28px;display:block}.faixa span{font-size:14px;color:#C9CED5}
.corpo{padding:16px;display:flex;flex-direction:column;gap:10px}
.sec{font-size:12px;font-weight:600;letter-spacing:.08em;color:#4A5562}
.card{background:#fff;border:1px solid #DFE2E6;border-radius:12px}
.lin{display:flex;align-items:center;gap:12px;min-height:56px;padding:0 12px;border-bottom:1px solid #ECEEF1;font-size:16px}
.lin:last-child{border-bottom:0}
.lin .n{flex:1}
.mini{width:48px;height:36px;border-radius:6px;overflow:hidden;border:1px solid #DFE2E6}
.mini svg,.tela-foto svg{display:block;width:100%;height:100%}
.ok{font-size:14px;font-weight:600;color:#1D6B4F}.falta{font-size:14px;font-weight:600;color:#A8261B}
.btn{height:44px;border:1px solid #7A8593;border-radius:10px;padding:0 14px;font-size:15px;font-weight:600;display:flex;align-items:center;background:#fff}
.escura{background:#101418;color:#fff}
.vtopo{display:flex;align-items:center;gap:14px;padding:14px 16px}
.vtopo b{font-size:16px;display:block}.vtopo span{font-size:13px;color:#C9CED5}
.tela-foto{margin-top:150px;width:360px;height:270px}`;

function app() {
  const linhas = ITENS.map(({ nome, fotos }) =>
    fotos.length
      ? `<div class="lin"><span class="n">${nome}</span><span class="ok">✓ Tem</span></div>`
      : `<div class="lin"><span class="n">${nome}</span><span class="falta">Falta</span><span class="btn">Adicionar</span></div>`,
  ).join('');
  const [svg, d] = ITENS[0].fotos[0];
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>App — fotos do cliente</title><style>${CSS_APP}</style><body>
<div class="pares"><div class="col"><span class="rot">Ficha do cliente</span><div class="cel"><div class="faixa"><div class="st"><span>14:40</span><span>4G 86%</span></div><b>${CLIENTE}</b><span>Rua Rio Mar, 118 · Manaus/AM</span></div>
<div class="corpo"><span class="sec">FOTOS DO PDV</span><div class="card">${linhas}</div></div></div></div>
<div class="col"><span class="rot">Tocar em Fachada</span><div class="cel escura"><div class="st" style="padding:14px 16px 0;display:flex;justify-content:space-between;font-size:12px;font-weight:600"><span>14:40</span><span>4G 86%</span></div><div class="vtopo">${xis('#fff')}<div><b>${CLIENTE}</b><span>Fachada · ${d}</span></div><span style="margin-left:auto;font-size:22px;font-weight:700" aria-label="Mais opções">⋮</span></div><div class="tela-foto">${svg}</div></div></div></div>
${pronto}</body></html>`;
}

await gerarPranchas(AQUI, {
  '01-bko-fotos-cliente': [ficha(), 1366, 768],
  '02-bko-ampliar-foto': [ampliar(), 1366, 768],
  '03-app-so-a-ultima': [app(), 820, 800],
});
