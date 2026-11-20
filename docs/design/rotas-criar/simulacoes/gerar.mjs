// Gera as simulações estáticas de docs/design/rotas-criar/simulacoes (HTML) e os PNG (Playwright, 2x).
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(process.env.PW_ROOT ?? '/opt/node22/lib/node_modules/'); // Playwright global da sessão
const DIR = '/home/user/macuxifdv/docs/design/rotas-criar/simulacoes';

// Casa: desenho único (24×24, traço 2, com porta) no cartão da base, na legenda e no marcador do mapa (design-de-marca, item 1).
const CASA_TRACO = '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>';
const CASA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${CASA_TRACO}</svg>`;
const LAPIS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>';
const MAIS = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const ROTA = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h8a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h8"/></svg>';

const nav = `<nav>
  <div class="marca"><img src="../../../marca/ativos/2026-11-12-v1/macuxi-logo-negativo-grafite.svg" alt="Macuxi Força de Vendas" height="28"><span class="empresa">Distribuidora Exemplo</span></div>
  <div class="g">Cadastros</div>
  <div class="i">Clientes</div><div class="i">Carteira</div><div class="i">Usuários</div>
  <div class="g">Operação</div>
  <div class="i">Aprovações</div><div class="i">Pedidos</div><div class="i on">Rotas</div><div class="i">Visitas</div>
  <div class="g">Sistema</div>
  <div class="i">Parâmetros</div>
</nav>`;

// Mapa estilizado (sem tiles): ruas, rio e, quando houver, as rotas por dia da semana saindo da base.
function fundoMapa() {
  return `<rect width="760" height="600" fill="#f2efe9"/>
  <path d="M-10 470 C120 430 220 520 360 480 S600 420 780 470 L780 610 L-10 610 Z" fill="#c9dbe8"/>
  <g stroke="#d6d2c8" stroke-width="11" fill="none" stroke-linecap="round"><path d="M0 120 L760 170"/><path d="M60 0 L180 600"/><path d="M0 330 L760 290"/><path d="M420 0 L470 470"/><path d="M640 0 L560 460"/><path d="M0 230 C200 260 300 200 760 230"/></g>
  <g stroke="#ffffff" stroke-width="8" fill="none" stroke-linecap="round"><path d="M0 120 L760 170"/><path d="M60 0 L180 600"/><path d="M0 330 L760 290"/><path d="M420 0 L470 470"/><path d="M640 0 L560 460"/><path d="M0 230 C200 260 300 200 760 230"/></g>
  <g stroke="#ffffff" stroke-width="3" fill="none"><path d="M260 0 L300 460"/><path d="M0 60 L760 80"/><path d="M0 400 L760 380"/><path d="M520 0 L520 440"/><path d="M120 0 L700 430"/></g>`;
}
const BASE_XY = [330, 260];
function casaNoMapa([x, y]) {
  return `<g transform="translate(${x - 17} ${y - 17})"><rect width="34" height="34" rx="9" fill="#16202a" stroke="#fff" stroke-width="3"/><svg x="7" y="7" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${CASA_TRACO}</svg></g>`;
}
// Seg e Sex dividem o Azul noite (MC-0014 A: 4 cores de série, a 5ª repete); a Sex se distingue pelo traço tracejado, na linha e na legenda.
const DIAS = [
  { cor: '#1e3350', pts: [[300, 200], [250, 150], [190, 120], [140, 90], [110, 60], [170, 50]] },
  { cor: '#c2540a', pts: [[390, 240], [450, 200], [520, 160], [590, 120], [650, 90], [700, 140]] },
  { cor: '#4a5562', pts: [[360, 310], [420, 350], [500, 380], [580, 360], [640, 320], [700, 300]] },
  { cor: '#5b7fa6', pts: [[290, 300], [230, 340], [160, 380], [100, 350], [60, 300], [40, 240]] },
  { cor: '#1e3350', tracejado: true, pts: [[350, 190], [370, 130], [410, 80], [470, 50], [540, 40], [600, 30]] },
];
function rotas(destaque = -1) {
  return DIAS.map((d, i) => {
    const op = destaque === -1 || destaque === i ? 1 : 0.3;
    const linha = [BASE_XY, ...d.pts].map((p) => p.join(',')).join(' ');
    const pontos = d.pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9" fill="#fff" stroke="${d.cor}" stroke-width="3"/>`).join('');
    const traco = d.tracejado ? ' stroke-dasharray="10 7"' : '';
    return `<g opacity="${op}"><polyline points="${linha}" fill="none" stroke="${d.cor}" stroke-width="4"${traco} stroke-linejoin="round" stroke-linecap="round"/>${pontos}</g>`;
  }).join('');
}
const mapa = (conteudo = '') => `<div class="mapa"><svg viewBox="0 0 760 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${fundoMapa()}${conteudo}</svg><span class="osm">© OpenStreetMap</span></div>`;

const legBase = `<span class="it"><span class="casa" style="width:18px;height:18px;border-radius:5px;border-width:1px;box-shadow:none">${CASA.replace('<svg ', '<svg style="width:12px;height:12px" ')}</span>Base</span>`;
const legStatus = `<span><span class="it"><span class="dot" style="background:var(--success)"></span>Visitada</span><span class="it"><span class="dot" style="background:var(--grafico)"></span>Em atendimento</span><span class="it"><span class="dot" style="border:2px solid var(--ink2);background:#fff"></span>Pendente</span>${legBase}</span>`;
const legDias = `<span><span class="it"><span class="bar" style="background:var(--seg)"></span><b>Seg</b></span><span class="it"><span class="bar" style="background:var(--ter)"></span><b>Ter</b></span><span class="it"><span class="bar" style="background:var(--qua)"></span><b>Qua</b></span><span class="it"><span class="bar" style="background:var(--qui)"></span><b>Qui</b></span><span class="it"><span class="bar tracejada" style="--c:var(--sex)"></span><b>Sex</b></span></span>`;
// Na prévia, a legenda mostra só os dias e a Base (RD-d): a prévia não tem visita feita nem em atendimento.
const legPrevia = `${legDias}<span>${legBase}</span>`;

const filtro = (vend = 'Todos') => `<div class="fb">
    <label class="sf">Período<span class="seg"><span>Dia</span><span>Semana</span><span class="on">Mês</span></span></label>
    <div class="nav-p"><span class="sq">‹</span><span class="rot">novembro de 2026</span><span class="sq">›</span><span class="btn sm sec-dis">Hoje</span></div>
    <label class="sf">Equipe<span class="ctl">Todas <span class="ch">▼</span></span></label>
    <label class="sf">Vendedor<span class="ctl">${vend} <span class="ch">▼</span></span></label>
  </div>`;
// PageHeader sem subtítulo: período e vendedor já estão na FilterBar (RD-g).
const cabecalho = (previa = false) => `<div class="ph"><div><h1>Rotas</h1></div>
    <div class="acoes"><span class="btn">Atualizar</span>${previa ? '' : `<span class="btn pri">${MAIS}Criar rota</span>`}</div></div>`;
// Sem rota no período o KpiGrid não aparece; o vazio fica só na lista (RD-e, RD-f).
const telaRotasVazia = `${nav}
<main>
  ${cabecalho()}
  ${filtro()}
  <div class="grade">
    <section class="quadro" aria-label="Mapa das rotas"><div class="leg"><span></span>${legStatus}</div>${mapa()}</section>
    <section class="painel" aria-label="Rotas do período"><h2>Rotas do período</h2><span class="mut" style="font-size:15px">Nenhuma rota no período.</span></section>
  </div>
</main>`;

// Exemplo de novembro de 2026 num tenant com semana útil seg–sex (metas.dias_uteis_semana): 21 dias úteis − 02/11 (Finados)
// − 20/11 (Consciência Negra) = 19 rotas; 19 × 11 visitas (meta visitas_dia) = 209 visitas. Com seg–sáb seriam 23 rotas.
const pagina = (titulo, corpo) => `<!doctype html>
<html lang="pt-BR">
<!-- Exemplo: tenant com semana útil seg–sex; novembro de 2026 = 21 dias úteis − 02/11 e 20/11 (feriados) = 19 rotas. -->
<head>
<meta charset="utf-8">
<title>Rotas · ${titulo} (simulação)</title>
<link rel="stylesheet" href="base.css">
</head>
<body>
${corpo}
</body>
</html>
`;

const seletorPeriodo = `<label class="campo">Período
    <span style="display:flex;gap:8px;align-items:center"><span class="seg" style="height:44px"><span>Dia</span><span>Semana</span><span class="on">Mês</span></span>
    <span class="nav-p" style="align-items:center"><span class="sq" style="height:44px;width:44px">‹</span><span class="rot" style="min-width:150px;height:44px">novembro de 2026</span><span class="sq" style="height:44px;width:44px">›</span></span></span>
  </label>`;
const campoVendedor = `<label class="campo">Vendedor<span class="ctl foco">Maria Silva <span class="ch">▼</span></span></label>`;

const dlgCriar = (meio, primario = `<span class="btn pri">${ROTA}Criar por proximidade</span>`) => `<div class="veu"></div>
<div class="dlg" role="dialog" aria-label="Criar rota" style="width:540px">
  <h2>Criar rota</h2>
  ${campoVendedor}
  ${seletorPeriodo}
  ${meio}
  <div class="acoes"><span class="btn">Cancelar</span>${primario}</div>
</div>`;

// Exemplo: 6 dias com rota, 2 deles protegidos (visita feita ou origem ERP) → Substituir 4 rotas (RD-i).
const conflito = `<div class="ntc warning" style="margin-top:16px">Já tem rota em 6 dias.</div>
  <div class="radio on"><span class="r"></span><span class="t"><b>Criar só nos dias sem rota</b></span></div>
  <div class="radio"><span class="r"></span><span class="t"><b>Substituir 4 rotas</b><span>2 com visita feita ou do ERP ficam.</span></span></div>`;
const semBase = `<div class="ntc warning" style="margin-top:16px;justify-content:space-between;align-items:center"><span>Sem endereço base.</span><span class="lnk" style="color:var(--warning)">Cadastrar</span></div>`;

const linhasDias = [
  ['Seg 02/11', null, '#8b96a3'],
  ['Ter 03/11', '11 visitas · 54 km', '#c2540a'],
  ['Qua 04/11', '11 visitas · 49 km', '#4a5562'],
  ['Qui 05/11', '11 visitas · 61 km', '#5b7fa6'],
  ['Sex 06/11', '11 visitas · 47 km', '#1e3350'],
  ['Seg 09/11', '11 visitas · 52 km', '#1e3350'],
  ['Ter 10/11', '11 visitas · 55 km', '#c2540a'],
  ['Qua 11/11', '11 visitas · 50 km', '#4a5562'],
];
const listaDias = `<ul class="dias" aria-label="Dias da prévia">${linhasDias
  .map(([d, s, c]) => s
    ? `<li><span class="cor" style="background:${d.startsWith('Sex') ? `repeating-linear-gradient(180deg,${c} 0 6px,transparent 6px 9px)` : c}"></span><span class="tx"><b>${d}</b><span class="num">${s}</span></span><span class="chev">›</span></li>`
    : `<li class="off"><span class="cor" style="background:var(--line)"></span><span class="tx"><b>${d}</b><span>Feriado</span></span></li>`)
  .join('')}</ul>`;

const telaPrevia = (enderecoBase) => `${nav}
<main>
  ${cabecalho(true)}
  ${filtro('Maria Silva')}
  <div class="grade">
    <section class="quadro" aria-label="Mapa da prévia"><div class="leg">${legPrevia}</div>${mapa(rotas() + casaNoMapa(BASE_XY))}</section>
    <section class="painel" aria-label="Prévia da rota">
      <div style="display:flex;flex-direction:column;gap:2px"><h2 style="font-size:20px">Prévia</h2><span class="mut num" style="font-size:13px">19 rotas · 209 visitas · 988 km</span></div>
      <div class="base"><span class="casa">${CASA}</span><span class="t"><b>${enderecoBase[0]}</b><span>${enderecoBase[1]}</span></span><span class="ico" aria-label="Trocar o endereço base">${LAPIS}</span></div>
      <div class="alertas" aria-label="Alertas"><h3>Alertas</h3><div class="al"><span>3 clientes ficaram fora: endereço não localizado.</span><span class="lnk" style="white-space:nowrap">Ver clientes</span></div></div>
      ${listaDias}
      <div class="rodape"><span class="btn pri">Salvar rotas</span><span class="btn">Descartar</span></div>
    </section>
  </div>
</main>`;

const CASA_END = ['Casa', 'Rua das Palmeiras, 100 · Centro'];

const dlgLapis = `<div class="veu"></div>
<div class="dlg" role="dialog" aria-label="Endereço base" style="width:560px">
  <h2>Endereço base</h2>
  <div class="radio" style="margin-top:14px"><span class="r"></span><span class="t"><b>Casa</b><span>Rua das Palmeiras, 100 · Centro, Boa Vista/RR</span></span></div>
  <div class="radio on"><span class="r"></span><span class="t"><b>Outro endereço</b></span></div>
  <div class="linha"><label class="campo" style="flex:0 0 130px">CEP<span class="ctl">69305-060</span></label><label class="campo">Logradouro<span class="ctl">Av. Brasil</span></label><label class="campo" style="flex:0 0 90px">Número<span class="ctl">1500</span></label></div>
  <div class="linha"><label class="campo">Bairro<span class="ctl">Mecejana</span></label><label class="campo">Cidade<span class="ctl">Boa Vista</span></label><label class="campo" style="flex:0 0 80px">UF<span class="ctl">RR</span></label></div>
  <label class="campo">Ponto no mapa<span class="mini-mapa"><svg viewBox="0 0 520 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="520" height="150" fill="#f2efe9"/><g stroke="#ffffff" stroke-width="8" fill="none"><path d="M0 60 L520 80"/><path d="M200 0 L240 150"/><path d="M0 120 C150 100 300 140 520 110"/></g><g stroke="#ffffff" stroke-width="3" fill="none"><path d="M380 0 L360 150"/><path d="M0 20 L520 30"/></g><g transform="translate(232 40)"><path d="M14 0C6.3 0 0 6.2 0 13.9 0 24.3 14 40 14 40s14-15.7 14-26.1C28 6.2 21.7 0 14 0z" fill="#16202a" stroke="#fff" stroke-width="2.5"/><circle cx="14" cy="14" r="5" fill="#fff"/></g></svg></span><span style="font-weight:400">Arraste o marcador até a porta.</span></label>
  <div class="acoes"><span class="btn">Cancelar</span><span class="btn pri">Salvar</span></div>
</div>`;

const telas = {
  'rotas': ['tela Rotas com o botão Criar rota', telaRotasVazia],
  'criar': ['diálogo Criar rota', telaRotasVazia + dlgCriar('')],
  'criar-conflito': ['diálogo Criar rota com rota no período', telaRotasVazia + dlgCriar(conflito)],
  'criar-sem-base': ['diálogo Criar rota sem endereço base', telaRotasVazia + dlgCriar(semBase, `<span class="btn dis" aria-disabled="true">${ROTA}Criar por proximidade</span>`)],
  'previa': ['prévia da rota gerada com o endereço base', telaPrevia(CASA_END)],
  'lapis': ['diálogo do lápis (endereço base)', telaPrevia(CASA_END) + dlgLapis],
};

for (const [nome, [titulo, corpo]] of Object.entries(telas)) writeFileSync(`${DIR}/${nome}.html`, pagina(titulo, corpo));

const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2 });
for (const nome of Object.keys(telas)) {
  await page.goto(`file://${DIR}/${nome}.html`);
  await page.waitForLoadState('load');
  await page.screenshot({ path: `${DIR}/${nome}.png` });
}
await browser.close();
console.log('ok', Object.keys(telas).join(', '));
