// Simulado da marca aprovada (opção E · Monte Roraima, T-0169): logo alinhado, todas as telas e as cores de fundo.
// Uso (na raiz do repositório): node docs/marca/propostas/2026-11-12-marca-e-simulado/gerar.mjs
// Saída nesta pasta: alinhamento, fundos-comparativo, simulado-<fundo>, azuis, noite-fundos e noite-simulado-<fundo> (.html e .png) e contraste.json.
// Fontes do BKO (apps/web/app/fonts, OFL). Empresas, pessoas, produtos e números são fictícios.
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FONTES = relative(AQUI, join(process.cwd(), 'apps/web/app/fonts')).replaceAll('\\', '/');

// ---------- contraste (WCAG 2.x, a mesma conta de packages/ui/src/comum/contraste.ts) ----------
const canal = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (h) => { const n = h.replace('#', ''); const [r, g, b] = [0, 2, 4].map((i) => canal(parseInt(n.slice(i, i + 2), 16))); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contraste = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const fmt = (n) => n.toFixed(2).replace('.', ',');

// ---------- paleta aprovada (opção E) ----------
const C = {
  azul: '#24456B', azulClaro: '#9DB8E0', azulSuave: '#E3EAF4', sol: '#C2540A', solClaro: '#F59A52',
  grafite: '#16202A', ink2: '#4A5562', ink3: '#5B6673', linha: '#E1E4DE', linhaSuave: '#ECEEE9', branco: '#FFFFFF',
  sucesso: '#1D6B4F', sucessoBg: '#E2F1EA', aviso: '#7A4F00', avisoBg: '#FFF1D6', erro: '#A8261B', erroBg: '#FDE8E6',
  neutro: '#34404D', neutroBg: '#E6E9E2', claroNoAzul: '#C9D6E8',
};

// ---------- fundos simulados ----------
const FUNDOS = [
  { id: 'cinza', nome: 'Cinza de hoje', hex: '#F3F4F1', nota: 'O de hoje: neutro e frio. Fica só como referência.' },
  { id: 'branco', nome: 'Branco', hex: '#FFFFFF', nota: 'O mais legível ao sol. Os cartões precisam de borda, e a tela fica sem calor.' },
  { id: 'areia', nome: 'Areia', hex: '#F6F1E7', nota: 'Bege claro, do lavrado e da areia dos rios. Quente sem pesar; os cartões brancos se destacam.' },
  { id: 'palha', nome: 'Palha', hex: '#EFE8DA', nota: 'A areia um tom mais forte. Mais calor e mais contraste com os cartões, mas cansa mais em tela cheia.' },
  { id: 'nevoa', nome: 'Névoa', hex: '#EEF2F7', nota: 'Azul bem claro, a névoa do topo da serra. Combina com o azul serra, mas é frio como o cinza.' },
  { id: 'topo', nome: 'Topo azul + branco', hex: '#FFFFFF', topo: true, nota: 'O título de cada tela numa faixa azul serra e o resto branco. É o mais marcante, mas muda o layout.' },
];
const SIMULADOS = ['areia', 'nevoa', 'branco', 'topo'];

// ---------- símbolo e logo (lockup com medidas exatas) ----------
// Símbolo no quadro 64: sol (topo y=13, cortado em y=22,8), tepui e a linha do lavrado (base y=59,5); x de 2 a 62.
let seq = 0;
function simbolo(cor, sol) {
  const id = `c${++seq}`;
  return `<defs><clipPath id="${id}"><rect width="64" height="22.8"/></clipPath></defs><circle cx="40" cy="24" r="11" fill="${sol}" clip-path="url(#${id})"/><path d="M2 50 L10 42 L12.8 28 Q13.3 25.5 16 25.5 L48 25.5 Q50.7 25.5 51.2 28 L54 42 L62 50Z" fill="${cor}"/><rect x="2" y="55" width="60" height="4.5" rx="2.25" fill="${cor}"/>`;
}
const SIMB = { x0: 2, y0: 13, w: 60, h: 46.5 };
function icone(cor, sol, tam) {
  return `<svg viewBox="${SIMB.x0} ${SIMB.y0} ${SIMB.w} ${SIMB.h}" width="${tam}" height="${(tam * SIMB.h) / SIMB.w}" aria-hidden="true">${simbolo(cor, sol)}</svg>`;
}
// Medidas da fonte (canvas, a 100 px): Archivo 800 altura de maiúscula 66, "Macuxi" com 321 de largura de tinta;
// IBM Plex Sans 600 altura de maiúscula 0,66 do corpo.
// Regra do lockup: o topo do sol = topo do "M"; a base do lavrado = base do "FORÇA DE VENDAS";
// "FORÇA DE VENDAS" com a mesma largura do "Macuxi"; espaço entre símbolo e escrita = 0,3 da altura do símbolo.
// A largura de "Macuxi" é medida no navegador (getComputedTextLength), antes de montar as pranchas.
const L = { capM: 66, larguraM: 0, corpoD: 28, folga: 13 };
function calcularLockup(larguraM) {
  L.larguraM = larguraM;
  L.baseD = L.capM + L.folga + 0.66 * L.corpoD; // altura total do lockup: topo do "M" à base de "FORÇA DE VENDAS"
  L.escala = L.baseD / SIMB.h;
  L.larguraS = SIMB.w * L.escala;
  L.xTexto = L.larguraS + 0.3 * L.baseD;
  L.largura = L.xTexto + L.larguraM + 2;
}
function marca({ cor = C.azul, sol = C.sol, texto = C.grafite, desc = C.ink2, altura = 48, guias = false }) {
  // `altura` = do topo do "M" à base do "FORÇA DE VENDAS", em px
  const vb = `0 -6 ${L.largura.toFixed(1)} ${(L.baseD + 14).toFixed(1)}`;
  const k = altura / L.baseD;
  const g = guias
    ? [0, L.capM, L.baseD].map((y) => `<line x1="-30" x2="${L.largura + 30}" y1="${y}" y2="${y}" stroke="#E5484D" stroke-width="0.8" stroke-dasharray="4 3"/>`).join('') +
      `<line x1="${L.xTexto}" x2="${L.xTexto}" y1="-6" y2="${L.baseD + 8}" stroke="#2F80ED" stroke-width="0.8" stroke-dasharray="4 3"/><line x1="${L.xTexto + L.larguraM}" x2="${L.xTexto + L.larguraM}" y1="-6" y2="${L.baseD + 8}" stroke="#2F80ED" stroke-width="0.8" stroke-dasharray="4 3"/>`
    : '';
  return `<svg viewBox="${vb}" width="${(L.largura * k).toFixed(1)}" height="${((L.baseD + 14) * k).toFixed(1)}" style="overflow:visible;display:block" aria-label="Macuxi Força de Vendas">
    <g transform="translate(${(-SIMB.x0 * L.escala).toFixed(2)} ${(-SIMB.y0 * L.escala).toFixed(2)}) scale(${L.escala.toFixed(4)})">${simbolo(cor, sol)}</g>
    <text x="${L.xTexto.toFixed(1)}" y="${L.capM}" font-family="Archivo" font-weight="800" font-size="100" fill="${texto}">Macuxi</text>
    <text x="${(L.xTexto + 1).toFixed(1)}" y="${L.baseD.toFixed(2)}" font-family="IBM Plex Sans" font-weight="600" font-size="${L.corpoD}" textLength="${L.larguraM - 1}" lengthAdjust="spacing" fill="${desc}">FORÇA DE VENDAS</text>${g}</svg>`;
}
// Versão empilhada (splash): símbolo centrado em cima, escrita embaixo.
function marcaEmpilhada({ cor = C.azul, sol = C.sol, texto = C.grafite, desc = C.ink2, largura = 180 }) {
  const ls = 200; const es = ls / SIMB.w; const hs = SIMB.h * es; const gap = 30; const topoTexto = hs + gap;
  const W = L.larguraM + 2; const H = topoTexto + L.baseD + 10; const x0 = (W - ls) / 2;
  return `<svg viewBox="0 0 ${W} ${H}" width="${largura}" height="${(largura * H) / W}" aria-label="Macuxi Força de Vendas">
    <g transform="translate(${(x0 - SIMB.x0 * es).toFixed(2)} ${(-SIMB.y0 * es).toFixed(2)}) scale(${es.toFixed(4)})">${simbolo(cor, sol)}</g>
    <text x="1" y="${topoTexto + L.capM}" font-family="Archivo" font-weight="800" font-size="100" fill="${texto}">Macuxi</text>
    <text x="2" y="${(topoTexto + L.baseD).toFixed(2)}" font-family="IBM Plex Sans" font-weight="600" font-size="${L.corpoD}" textLength="${L.larguraM - 1}" lengthAdjust="spacing" fill="${desc}">FORÇA DE VENDAS</text></svg>`;
}
// O lockup antigo (flex centralizado), só para o antes e depois.
function marcaAntiga(tam) {
  return `<div style="display:flex;align-items:center;gap:${tam * 0.22}px"><svg viewBox="0 0 64 64" width="${tam}" height="${tam}">${simbolo(C.azul, C.sol)}</svg><div><div style="font:800 ${tam * 0.66}px/1 Archivo;letter-spacing:-0.02em">Macuxi</div><div style="font:600 ${tam * 0.17}px 'IBM Plex Sans';letter-spacing:.14em;color:${C.ink2};margin-top:${tam * 0.07}px">FORÇA DE VENDAS</div></div></div>`;
}

// ---------- estilo ----------
// O estilo lê a paleta na hora (C pode trocar de azul, ver comAzul).
const cssDe = () => `
@font-face{font-family:Archivo;font-weight:600;src:url(${FONTES}/Archivo_600SemiBold.ttf)}
@font-face{font-family:Archivo;font-weight:700;src:url(${FONTES}/Archivo_700Bold.ttf)}
@font-face{font-family:Archivo;font-weight:800;src:url(${FONTES}/Archivo_800ExtraBold.ttf)}
@font-face{font-family:'IBM Plex Sans';font-weight:400;src:url(${FONTES}/IBMPlexSans_400Regular.ttf)}
@font-face{font-family:'IBM Plex Sans';font-weight:500;src:url(${FONTES}/IBMPlexSans_500Medium.ttf)}
@font-face{font-family:'IBM Plex Sans';font-weight:600;src:url(${FONTES}/IBMPlexSans_600SemiBold.ttf)}
@font-face{font-family:'IBM Plex Sans';font-weight:700;src:url(${FONTES}/IBMPlexSans_700Bold.ttf)}
@font-face{font-family:'IBM Plex Mono';font-weight:500;src:url(${FONTES}/IBMPlexMono_500Medium.ttf)}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'IBM Plex Sans';color:${C.grafite};background:#FFFFFF;width:1600px;padding:48px}
h1{font:800 40px/1.1 Archivo;letter-spacing:-.01em}
h2{font:700 13px/1 'IBM Plex Sans';letter-spacing:.1em;text-transform:uppercase;color:${C.ink2};margin:0 0 14px}
.sup{font:600 14px 'IBM Plex Sans';color:${C.ink2};letter-spacing:.08em}
.sub{font-size:17px;color:${C.ink2};margin-top:8px;max-width:1250px;line-height:1.45}
.caixa{background:#fff;border:1px solid #E3E0D8;border-radius:18px;padding:24px}
.rot{font-size:12.5px;color:${C.ink2};margin-top:10px;text-align:center;line-height:1.35}
.lin{display:flex;align-items:center;gap:12px}
.tel{width:300px;height:620px;border-radius:34px;border:9px solid #0F1419;overflow:hidden;position:relative;flex:none;display:flex;flex-direction:column}
.barra{height:26px;display:flex;justify-content:space-between;align-items:center;padding:0 16px;font-size:11px;font-weight:600;flex:none}
.corpo{flex:1;overflow:hidden;padding:0 16px}
.card{background:#fff;border:1px solid ${C.linha};border-radius:14px;padding:12px}
.rotulo{font-size:10px;letter-spacing:.1em;font-weight:700;color:${C.ink2}}
.chip{display:inline-block;font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:99px;white-space:nowrap}
.li{display:flex;justify-content:space-between;align-items:center;font-size:12px;padding:9px 0;border-bottom:1px solid ${C.linhaSuave}}
.li:last-child{border-bottom:0}
.b1{height:46px;border-radius:14px;background:${C.azul};color:#fff;font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center}
.b2{height:42px;border-radius:12px;background:#fff;border:1.5px solid ${C.grafite};font-weight:600;font-size:13px;display:flex;align-items:center;justify-content:center}
.bp{height:42px;border-radius:12px;background:${C.erroBg};color:${C.erro};font-weight:600;font-size:13px;display:flex;align-items:center;justify-content:center}
.campo{height:40px;border:1px solid #C9CEC6;border-radius:12px;background:#fff;padding:0 12px;display:flex;align-items:center;font-size:12.5px;color:${C.ink3}}
.abas{height:54px;background:#fff;border-top:1px solid ${C.linha};display:flex;justify-content:space-around;align-items:center;font-size:10px;color:${C.ink3};flex:none}
.aba{text-align:center}.aba i{display:block;width:18px;height:18px;margin:0 auto 3px;border-radius:5px;border:2px solid ${C.ink3}}
.aba.on{color:${C.azul};font-weight:700}.aba.on i{border-color:${C.azul};background:${C.azulSuave}}
table{border-collapse:collapse;width:100%;font-size:13px}
td,th{padding:6px 8px;border-bottom:1px solid #ECEEE9;text-align:left}
.ok{color:${C.sucesso};font-weight:700}.nao{color:${C.erro};font-weight:700}
`;

const TOM = { sucesso: [C.sucesso, C.sucessoBg], aviso: [C.aviso, C.avisoBg], erro: [C.erro, C.erroBg], destaque: [C.azul, C.azulSuave], neutro: [C.neutro, C.neutroBg] };
const chip = (t, tom) => `<span class="chip" style="color:${TOM[tom][0]};background:${TOM[tom][1]}">${t}</span>`;
const ABAS_CAMPO = ['Início', 'Rota', 'Clientes', 'Pedidos', 'Mais'];
const ABAS_GESTAO = ['Início', 'Equipe', 'Aprovar', 'Mapa', 'Mais'];

// Moldura do celular: barra de status, cabeçalho (na faixa azul quando `topo`), corpo e abas.
function tel(F, { titulo, sub, acao = '', corpo, abas = ABAS_CAMPO, ativa = 0, semAbas = false, rodape = '' }) {
  const naFaixa = Boolean(F.topo && titulo);
  const cab = titulo
    ? `<div style="padding:12px 16px ${naFaixa ? 16 : 10}px;${naFaixa ? `background:${C.azul};color:#fff` : ''}"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div>${sub ? `<div style="font-size:11.5px;color:${naFaixa ? C.claroNoAzul : C.ink2}">${sub}</div>` : ''}<div style="font:800 23px/1.15 Archivo;margin-top:2px">${titulo}</div></div>${acao}</div></div>`
    : '';
  const barra = `<div class="barra" style="${naFaixa ? `background:${C.azul};color:#fff` : ''}"><span>06:30</span><span>4G ▮▮▮ 90%</span></div>`;
  const abasHtml = semAbas ? '' : `<div class="abas">${abas.map((t, i) => `<div class="aba ${i === ativa ? 'on' : ''}"><i></i>${t}</div>`).join('')}</div>`;
  return `<div class="tel" style="background:${F.hex}">${barra}${cab}<div class="corpo" style="${naFaixa ? 'padding-top:12px' : ''}">${corpo}</div>${rodape}${abasHtml}</div>`;
}

// ---------- telas ----------
const T = {
  splash: (F) => `<div class="tel" style="background:${F.topo ? C.azul : F.hex};align-items:center;justify-content:center">
    ${F.topo ? marcaEmpilhada({ cor: '#FFFFFF', sol: C.solClaro, texto: '#FFFFFF', desc: C.claroNoAzul, largura: 170 }) : marcaEmpilhada({ largura: 170 })}
    <div style="position:absolute;bottom:26px;font-size:11px;color:${F.topo ? C.claroNoAzul : C.ink2}">Macuxi Campo</div></div>`,
  login: (F) => {
    const topo = F.topo;
    return `<div class="tel" style="background:${topo ? `linear-gradient(${C.azul} 0 150px, ${F.hex} 150px)` : F.hex}"><div class="barra" style="${topo ? 'color:#fff' : ''}"><span>06:30</span><span>4G ▮▮▮ 90%</span></div>
    <div style="padding:${topo ? 44 : 50}px 26px 0;display:flex;justify-content:center">${topo ? marca({ cor: '#fff', sol: C.solClaro, texto: '#fff', desc: C.claroNoAzul, altura: 44 }) : marca({ altura: 44 })}</div>
    <div style="padding:${topo ? 50 : 40}px 20px 0"><div style="font:800 22px Archivo">Entrar</div>
      <div style="font-size:11px;font-weight:600;margin:12px 0 5px">Código da empresa</div><div class="campo" style="color:${C.grafite}">DISTEX</div>
      <div style="font-size:11px;font-weight:600;margin:10px 0 5px">E-mail</div><div class="campo" style="color:${C.grafite}">lucas@exemplo.com.br</div>
      <div style="font-size:11px;font-weight:600;margin:10px 0 5px">Senha</div><div class="campo" style="color:${C.grafite}">••••••••</div>
      <div class="b1" style="margin-top:18px">Entrar</div><div style="text-align:center;font-size:12px;font-weight:600;color:${C.azul};margin-top:12px">Esqueci a senha</div></div>
    <div style="position:absolute;bottom:16px;left:0;right:0;text-align:center;font-size:10.5px;color:${C.ink2}">Macuxi Campo · vendedores e promotores</div></div>`;
  },
  inicio: (F) => tel(F, {
    titulo: 'Bom dia, Lucas', sub: 'Quinta, 12 de novembro',
    corpo: `<div style="font-size:11.5px;color:${F.topo ? C.ink2 : C.ink2};margin:${F.topo ? '0 0 10px' : '-4px 0 10px'}">6 visitas hoje · 3 feitas</div>
      <div class="card"><div style="display:flex;justify-content:space-between"><span class="rotulo">RECADOS</span>${chip('2 novos', 'destaque')}</div><div style="font-size:11.5px;margin-top:7px;line-height:1.35"><b>Prioridade:</b> passe cedo no Mercadinho São Jorge, título vencido.</div></div>
      <div class="card" style="margin-top:9px"><div style="display:flex;justify-content:space-between"><span class="rotulo">META DO MÊS</span><b style="font-size:11px">31%</b></div><div style="font:800 17px Archivo;margin-top:5px">R$ 55.800 de R$ 180.000</div><div style="height:6px;border-radius:3px;background:${C.linhaSuave};margin-top:7px"><div style="width:31%;height:100%;border-radius:3px;background:${C.sol}"></div></div>
        <div class="li" style="padding-bottom:4px"><span>Positivação</span><b>9 de 15 clientes</b></div><div class="li" style="padding:4px 0 0"><span>Visitas</span><b>41 de 90</b></div></div>
      <div class="card" style="margin-top:9px;padding:0 12px"><div class="li"><b>Orçamentos</b><span>3 · R$ 1.150 ›</span></div><div class="li"><b>A faturar</b><span>6 · R$ 3.989 ›</span></div></div>
      <div class="b1" style="margin-top:12px;background:${C.grafite}">↻ Sincronizar</div>`,
  }),
  rota: (F) => tel(F, {
    titulo: 'Rota do dia', sub: 'Quinta, 12/11 · 6 visitas', ativa: 1,
    corpo: `<div style="height:118px;border-radius:14px;background:#E6E9E2;border:1px solid #D6DAD1;position:relative;overflow:hidden">
        <svg viewBox="0 0 268 118" width="100%" height="118"><path d="M20 96 C60 60 90 90 130 54 S210 40 248 20" fill="none" stroke="${C.azul}" stroke-width="3" stroke-dasharray="6 5"/>${[[20, 96, 1], [74, 74, 2], [130, 54, 3], [178, 46, 4], [248, 20, 5]].map(([x, y, n]) => `<circle cx="${x}" cy="${y}" r="9" fill="${n <= 3 ? C.azul : '#fff'}" stroke="${C.azul}" stroke-width="2"/><text x="${x}" y="${y + 3.5}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${n <= 3 ? '#fff' : C.azul}" font-family="IBM Plex Sans">${n}</text>`).join('')}</svg></div>
      <div class="card" style="margin-top:10px;padding:0 12px">
        ${[['1', 'Atacadinho Cachoeirinha', 'Rua Pará, 137 · São Geraldo', chip('Feita', 'sucesso')], ['2', 'Mercadinho São Jorge', 'Av. Brasil, 820 · Centro', chip('Feita', 'sucesso')], ['3', 'Supermercado Rio Negro', 'Rua Uraricoera, 45 · Caçari', chip('Em atendimento', 'destaque')], ['4', 'Mercearia Bom Preço', 'Av. Ville Roy, 300 · Aparecida', chip('Próxima', 'neutro')], ['5', 'Empório Tacutu', 'Rua Tacutu, 12 · Pricumã', chip('Próxima', 'neutro')]]
          .map(([n, c, e, s]) => `<div class="li"><div class="lin" style="gap:9px"><b style="width:20px;height:20px;border-radius:50%;background:${C.azulSuave};color:${C.azul};font-size:10.5px;display:flex;align-items:center;justify-content:center">${n}</b><div><b style="font-size:12px">${c}</b><div style="font-size:10.5px;color:${C.ink2}">${e}</div></div></div>${s}</div>`).join('')}</div>`,
  }),
  clientes: (F) => tel(F, {
    titulo: 'Clientes', sub: 'Carteira · 86 clientes', ativa: 2,
    corpo: `<div class="campo">Buscar cliente, CNPJ ou cidade</div>
      <div class="lin" style="gap:6px;margin:10px 0">${chip('Todos', 'destaque')}${chip('Sem pedido no mês', 'neutro')}${chip('Vencidos', 'neutro')}</div>
      <div class="card" style="padding:0 12px">${/* cada linha: nome, uma tag só (Vencido ou Em dia) e embaixo só a última visita (pedido de 12/11, R-20261112-180115) */ ''}${[['Atacadinho Cachoeirinha', 'Visitado hoje', chip('Em dia', 'sucesso')], ['Mercadinho São Jorge', 'Visitado ontem', chip('Vencido', 'erro')], ['Supermercado Rio Negro', 'Visitado há 12 dias', chip('Em dia', 'sucesso')], ['Mercearia Bom Preço', 'Visitado há 42 dias', chip('Em dia', 'sucesso')], ['Empório Tacutu', 'Visitado há 200 dias', chip('Vencido', 'erro')], ['Comercial Pacaraima', 'Nunca visitado', chip('Em dia', 'sucesso')]]
        .map(([c, d, s]) => `<div class="li"><div><b style="font-size:12px">${c}</b><div style="font-size:10.5px;color:${C.ink2}">${d}</div></div>${s}</div>`).join('')}</div>`,
  }),
  cliente360: (F) => tel(F, {
    titulo: 'Mercadinho São Jorge', sub: 'Cliente · 23.456.789/0001-01', ativa: 2,
    corpo: `<div class="lin" style="gap:6px;margin-bottom:10px">${chip('Título vencido', 'erro')}${chip('Rota de quinta', 'neutro')}</div>
      <div class="card"><span class="rotulo">FINANCEIRO</span><div class="li"><span>Limite</span><b>R$ 8.000</b></div><div class="li"><span>Em aberto</span><b>R$ 2.340</b></div><div class="li"><span>Vencido</span><b style="color:${C.erro}">R$ 612 · 6 dias</b></div></div>
      <div class="card" style="margin-top:9px"><span class="rotulo">ÚLTIMOS PEDIDOS</span><div class="li"><span>Nº 000011 · 11/11</span><b>R$ 812,40</b></div><div class="li"><span>Nº 000007 · 04/11</span><b>R$ 1.020,00</b></div></div>
      <div class="b1" style="margin-top:12px">Novo pedido</div><div class="b2" style="margin-top:8px">Fazer check-in</div>`,
  }),
  itens: (F) => tel(F, {
    titulo: 'Novo pedido', sub: 'Mercadinho São Jorge · Itens', ativa: 3,
    corpo: `<div class="campo">Buscar produto, código ou marca</div>
      <div class="card" style="margin-top:10px;padding:0 12px">${[['ACU-1K', 'Açúcar cristal 1 kg', 'FD c/ 10 · R$ 39,60', 1], ['AGU-1500', 'Água mineral 1,5 L', 'FD c/ 6 · R$ 12,79', 2], ['CAF-500', 'Café torrado e moído 500 g', 'UN · R$ 13,40', 4], ['ARR-5K', 'Arroz tipo 1 5 kg', 'FD c/ 6 · R$ 128,90', 0], ['FEI-1K', 'Feijão carioca 1 kg', 'FD c/ 10 · R$ 72,00', 0]]
        .map(([c, d, p, q]) => `<div class="li"><div style="max-width:150px"><div style="font:500 10px 'IBM Plex Mono';color:${C.ink2}">${c}</div><b style="font-size:11.5px">${d}</b><div style="font-size:10.5px;color:${C.ink2}">${p}</div></div><div class="lin" style="gap:6px"><span style="width:26px;height:26px;border-radius:8px;border:1.5px solid ${C.linha};display:flex;align-items:center;justify-content:center;font-weight:700">−</span><b style="width:14px;text-align:center">${q}</b><span style="width:26px;height:26px;border-radius:8px;background:${C.azul};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700">+</span></div></div>`).join('')}</div>`,
    rodape: `<div style="background:#fff;border-top:1px solid ${C.linha};padding:10px 16px;display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:10.5px;color:${C.ink2}">3 itens</div><b style="font:800 17px Archivo">R$ 118,78</b></div><div class="b1" style="width:120px;height:42px">Revisar</div></div>`,
  }),
  pedidos: (F) => tel(F, {
    titulo: 'Pedidos', sub: 'Novembro', ativa: 3,
    corpo: `<div class="lin" style="gap:6px;margin-bottom:10px">${chip('Todos', 'destaque')}${chip('Em aprovação', 'neutro')}${chip('Rejeitado', 'neutro')}</div>
      <div class="card" style="padding:0 12px">${[['Atacadinho Cachoeirinha', 'Nº 000014 · hoje 05:56', 'R$ 118,78', chip('Rejeitado', 'erro')], ['Atacadinho Cachoeirinha', 'Nº 000013 · hoje 05:55', 'R$ 126,64', chip('Aprovado', 'sucesso')], ['Mercadinho São Jorge', 'Nº 000011 · ontem 16:20', 'R$ 812,40', chip('Em aprovação', 'aviso')], ['Supermercado Rio Negro', 'Nº 000009 · 07/11', 'R$ 2.140,00', chip('Faturado', 'neutro')], ['Empório Tacutu', 'Nº 000008 · 06/11', 'R$ 455,10', chip('Faturado', 'neutro')]]
        .map(([c, n, v, s]) => `<div class="li"><div><b style="font-size:12px">${c}</b><div style="font-size:10.5px;color:${C.ink2}">${n}</div></div><div style="text-align:right"><b>${v}</b><div style="margin-top:3px">${s}</div></div></div>`).join('')}</div>`,
  }),
  catalogo: (F) => tel(F, {
    titulo: 'Catálogo', sub: '1.240 produtos', ativa: 4,
    corpo: `<div class="campo">O que o cliente precisa?</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">${[['Café torrado 500 g', 'Serra Alta', 'R$ 13,40', 'Em estoque'], ['Água mineral 1,5 L', 'Fonte Clara', 'R$ 12,79', 'Em estoque'], ['Açúcar cristal 1 kg', 'Doce Vale', 'R$ 39,60', 'Pouco estoque'], ['Arroz tipo 1 5 kg', 'Grão Bom', 'R$ 128,90', 'Em estoque']]
        .map(([d, m, p, e]) => `<div class="card" style="padding:8px"><div style="height:66px;border-radius:9px;background:${C.neutroBg};display:flex;align-items:center;justify-content:center;font:800 18px Archivo;color:${C.ink3}">${d[0]}</div><b style="font-size:11px;display:block;margin-top:6px">${d}</b><div style="font-size:10px;color:${C.ink2}">${m}</div><div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px"><b style="font-size:12px">${p}</b></div><div style="margin-top:4px">${chip(e, e === 'Em estoque' ? 'sucesso' : 'aviso')}</div></div>`).join('')}</div>`,
  }),
  mais: (F) => tel(F, {
    titulo: 'Mais', ativa: 4,
    corpo: `<div class="card lin"><b style="width:40px;height:40px;border-radius:50%;background:${C.azul};color:#fff;display:flex;align-items:center;justify-content:center;font:800 15px Archivo">LA</b><div><b style="font-size:13px">Lucas Andrade</b><div style="font-size:11px;color:${C.ink2}">Vendedor · Distribuidora Exemplo</div></div></div>
      <div class="card" style="margin-top:10px;padding:0 12px">${['Sincronização', 'Treinamento', 'Pesquisas', 'Minhas vendas', 'Diagnóstico', 'Trocar senha'].map((t) => `<div class="li"><span>${t}</span><span style="color:${C.ink3}">›</span></div>`).join('')}</div>
      <div class="bp" style="margin-top:12px">Sair</div>`,
  }),
  promotor: (F) => tel(F, {
    titulo: 'Visita do promotor', sub: 'Supermercado Rio Negro · 09:12', ativa: 1,
    corpo: `<div class="card" style="padding:0 12px">${[['Fotos da gôndola, antes', true], ['Arrumação e fotos, depois', true], ['Share de gôndola', true], ['Pesquisa de preço', false], ['Ruptura do mix', false], ['Validade e avarias', false]]
        .map(([t, ok]) => `<div class="li"><div class="lin" style="gap:9px"><span style="width:20px;height:20px;border-radius:6px;${ok ? `background:${C.sucesso};color:#fff` : `border:1.5px solid ${C.ink3}`};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700">${ok ? '✓' : ''}</span><span>${t}</span></div><span style="color:${C.ink3}">›</span></div>`).join('')}</div>
      <div class="card" style="margin-top:10px"><span class="rotulo">SHARE DE GÔNDOLA</span><div style="font:800 17px Archivo;margin-top:5px">38% · meta 35%</div><div style="height:6px;border-radius:3px;background:${C.linhaSuave};margin-top:7px"><div style="width:38%;height:100%;border-radius:3px;background:${C.sol}"></div></div></div>
      <div class="b1" style="margin-top:12px">Continuar</div>`,
  }),
  gestao: (F) => tel(F, {
    titulo: 'Equipe hoje', sub: 'Gestão · Quinta, 12/11', abas: ABAS_GESTAO, ativa: 0,
    corpo: `<div class="card" style="border-color:${C.azulClaro};background:${C.azulSuave}"><div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:12.5px;color:${C.azul}">Pedidos para aprovar</b><b style="background:${C.sol};color:#fff;border-radius:99px;padding:1px 9px;font-size:12px">3</b></div><div style="font-size:11px;color:${C.ink2};margin-top:3px">R$ 3.418 · o mais antigo de ontem</div></div>
      <div class="card" style="margin-top:9px;padding:0 12px">${[['Lucas Andrade', 31, '9 de 15'], ['Marina Souza', 54, '12 de 14'], ['Pedro Lima', 18, '4 de 16'], ['Ana Ribeiro', 42, '10 de 15']]
        .map(([n, p, pos]) => `<div style="padding:9px 0;border-bottom:1px solid ${C.linhaSuave}"><div style="display:flex;justify-content:space-between;font-size:12px"><b>${n}</b><span><b>${p}%</b> da meta</span></div><div style="height:5px;border-radius:3px;background:${C.linhaSuave};margin-top:6px"><div style="width:${p}%;height:100%;border-radius:3px;background:${C.sol}"></div></div><div style="font-size:10.5px;color:${C.ink2};margin-top:4px">Positivação ${pos}</div></div>`).join('')}</div>`,
  }),
  aprovar: (F) => tel(F, {
    titulo: 'Pedido 000011', sub: 'Aprovar · Mercadinho São Jorge', abas: ABAS_GESTAO, ativa: 2,
    corpo: `<div class="lin" style="gap:6px;margin-bottom:10px">${chip('Em aprovação', 'aviso')}${chip('Lucas Andrade', 'neutro')}</div>
      <div class="card"><span class="rotulo">ALERTAS</span><div style="font-size:11.5px;margin-top:6px;line-height:1.4">Desconto de 12% acima da alçada do vendedor (8%).<br>Cliente com título vencido há 6 dias.</div></div>
      <div class="card" style="margin-top:9px;padding:0 12px"><div class="li"><span>Itens</span><b>7</b></div><div class="li"><span>Desconto</span><b>12,0% · R$ 110,78</b></div><div class="li"><span>Total</span><b style="font:800 15px Archivo">R$ 812,40</b></div></div>
      <div class="b1" style="margin-top:12px">Aprovar</div><div class="bp" style="margin-top:8px">Recusar</div>`,
  }),
};
const ORDEM_TELAS = [
  ['splash', 'Abertura (splash)'], ['login', 'Login'], ['inicio', 'Início · vendedor'], ['rota', 'Rota do dia'],
  ['clientes', 'Clientes'], ['cliente360', 'Cliente 360'], ['itens', 'Novo pedido · itens'], ['pedidos', 'Pedidos'],
  ['catalogo', 'Catálogo'], ['mais', 'Mais'], ['promotor', 'Visita do promotor'], ['gestao', 'Gestão · equipe'],
  ['aprovar', 'Gestão · aprovar pedido'],
];

// ---------- BKO, portal, PDF e e-mail ----------
function bko(F) {
  const linhas = [['000014', 'Atacadinho Cachoeirinha', 'Lucas Andrade', 'R$ 118,78', chip('Rejeitado', 'erro')], ['000013', 'Atacadinho Cachoeirinha', 'Lucas Andrade', 'R$ 126,64', chip('Aprovado', 'sucesso')], ['000011', 'Mercadinho São Jorge', 'Lucas Andrade', 'R$ 812,40', chip('Em aprovação', 'aviso')], ['000010', 'Comercial Pacaraima', 'Marina Souza', 'R$ 1.330,00', chip('Aprovado', 'sucesso')], ['000009', 'Supermercado Rio Negro', 'Pedro Lima', 'R$ 2.140,00', chip('Faturado', 'neutro')]];
  return `<div style="width:780px;height:470px;border-radius:12px;border:1px solid #D6D2C8;overflow:hidden;display:flex;background:${F.hex}">
    <div style="width:176px;background:${C.grafite};padding:18px 14px;flex:none">${marca({ cor: C.azulClaro, sol: C.solClaro, texto: '#fff', desc: '#C9D0D8', altura: 26 })}
      <div style="margin-top:26px;font-size:12.5px;color:#C9D0D8;line-height:2.3">${['Início', 'Pedidos', 'Clientes', 'Catálogo', 'Equipe', 'Integração', 'Configurações'].map((t, i) => `<div style="padding:0 10px;border-radius:8px;${i === 1 ? 'background:#2B3743;color:#fff;font-weight:600;box-shadow:inset 3px 0 0 ' + C.solClaro : ''}">${t}</div>`).join('')}</div></div>
    <div style="flex:1;display:flex;flex-direction:column">
      <div style="height:${F.topo ? 64 : 56}px;${F.topo ? `background:${C.azul};color:#fff` : `border-bottom:1px solid ${C.linha}`};display:flex;align-items:center;justify-content:space-between;padding:0 22px"><b style="font:800 20px Archivo">Pedidos</b><span style="font-size:12px;${F.topo ? `color:${C.claroNoAzul}` : `color:${C.ink2}`}">Distribuidora Exemplo · Ana Gestora</span></div>
      <div style="padding:16px 22px"><div class="lin" style="gap:8px"><div class="campo" style="width:240px">Cliente, nº ou vendedor</div>${chip('Novembro', 'destaque')}${chip('Todas as filiais', 'neutro')}<div class="b1" style="margin-left:auto;width:120px;height:38px;font-size:13px">Exportar</div></div>
      <div style="background:#fff;border:1px solid ${C.linha};border-radius:12px;margin-top:14px;overflow:hidden"><table style="font-size:12.5px"><tr style="background:${C.linhaSuave}"><th>Nº</th><th>Cliente</th><th>Vendedor</th><th style="text-align:right">Total</th><th>Situação</th></tr>${linhas.map((l) => `<tr><td style="font-family:'IBM Plex Mono'">${l[0]}</td><td><b>${l[1]}</b></td><td>${l[2]}</td><td style="text-align:right"><b>${l[3]}</b></td><td>${l[4]}</td></tr>`).join('')}</table></div></div></div></div>`;
}
function portal(F) {
  return `<div style="width:520px;height:470px;border-radius:12px;border:1px solid #D6D2C8;overflow:hidden;background:${F.topo ? `linear-gradient(${C.azul} 0 150px, ${F.hex} 150px)` : F.hex};display:flex;flex-direction:column;align-items:center;padding-top:40px">
    ${F.topo ? marca({ cor: '#fff', sol: C.solClaro, texto: '#fff', desc: C.claroNoAzul, altura: 34 }) : marca({ altura: 34 })}
    <div style="font-size:12px;color:${F.topo ? C.claroNoAzul : C.ink2};margin-top:8px">Portal de implantação</div>
    <div style="width:340px;background:#fff;border:1px solid ${C.linha};border-radius:16px;padding:22px;margin-top:${F.topo ? 34 : 26}px"><div style="font:800 22px Archivo">Entrar</div>
      <div style="font-size:11.5px;font-weight:600;margin:12px 0 5px">E-mail</div><div class="campo" style="color:${C.grafite}">ana@exemplo.com.br</div>
      <div style="font-size:11.5px;font-weight:600;margin:10px 0 5px">Senha</div><div class="campo" style="color:${C.grafite}">••••••••</div>
      <div class="b1" style="margin-top:16px;height:42px">Entrar</div><div style="font-size:11.5px;color:${C.ink2};margin-top:10px">Esqueceu a senha? Fale com a Macuxi.</div></div></div>`;
}
function pdfEEmail() {
  return `<div style="display:flex;gap:20px;align-items:flex-start">
    <div style="flex:1"><div style="background:#fff;border:1px solid #D6DAD1;border-radius:4px;padding:20px 22px"><div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div class="lin"><div style="width:54px;height:54px;border-radius:12px;background:${C.azul};display:flex;align-items:center;justify-content:center">${icone('#fff', C.solClaro, 36)}</div><div><div style="font:800 18px Archivo">Distribuidora Exemplo</div><div style="font-size:9.5px;color:${C.ink2};margin-top:3px;white-space:nowrap">Filial Boa Vista · CNPJ 12.345.678/0002-71 · (95) 3224-1000</div><div style="font-size:9.5px;color:${C.ink2};white-space:nowrap">Rua Exemplo, 450 · Centro · Boa Vista/RR · CEP 69301-000</div></div></div>
      <div style="text-align:right;flex:none"><span style="font:700 10.5px 'IBM Plex Sans';letter-spacing:.08em;color:${C.azul}">PEDIDO</span> <span style="font:800 20px Archivo">000014</span><div style="font-size:10.5px;color:${C.ink2}">12/11/2026</div></div></div>
      <div style="margin-top:14px;height:24px;border:1px solid ${C.grafite};border-radius:4px;background:#F1F2F0"></div>
      <div style="margin-top:12px;height:20px;background:#00843D;color:#fff;font:700 9px 'IBM Plex Sans';letter-spacing:.08em;display:flex;align-items:center;padding-left:8px">ITEM · CÓDIGO · DESCRIÇÃO · MARCA · EMB. · QTD · PREÇO UNIT. · TOTAL</div><div style="height:12px"></div></div>
      <div class="rot">PDF de pedido, distribuidora sem logo cadastrado (com o logo dela, a Macuxi não aparece). O papel é sempre branco.</div></div>
    <div style="flex:1"><div style="background:#fff;border:1px solid #D6DAD1;border-radius:8px;padding:16px 20px;font-size:13px;line-height:1.5">
      <div style="color:${C.ink2};font-size:12px">Assunto: Seu acesso ao Macuxi Campo</div><div style="margin-top:8px">Olá, Lucas. Seu acesso está pronto. Entre com o código da empresa <b>DISTEX</b> e o seu e-mail.</div>
      <div style="margin-top:14px;padding-top:14px;border-top:3px solid ${C.azul}">${marca({ altura: 30 })}<div style="font-size:12px;color:${C.ink2};margin-top:8px">Equipe Macuxi FDV · Boa Vista, RR · <b style="color:${C.azul}">macuxifdv.com.br</b></div></div></div>
      <div class="rot">Assinatura de e-mail (o e-mail é sempre branco).</div></div></div>`;
}

// ---------- pranchas ----------
const pagina = (titulo, corpo) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${titulo}</title><style>${cssDe()}</style></head><body>${corpo}</body></html>`;

function paresDoFundo(F) {
  const lista = [['título e texto', C.grafite, 4.5], ['texto secundário', C.ink2, 4.5], ['texto de apoio', C.ink3, 4.5], ['azul (link, título)', C.azul, 4.5], ['laranja sol (barra, ícone)', C.sol, 3]];
  return lista.map(([uso, fg, min]) => ({ uso, fg, bg: F.hex, razao: Number(contraste(fg, F.hex).toFixed(2)), minimo: min, passa: contraste(fg, F.hex) >= min }));
}
const tabela = (F) => `<table>${paresDoFundo(F).map((p) => `<tr><td>${p.uso}</td><td class="${p.passa ? 'ok' : 'nao'}">${fmt(p.razao)}:1 ${p.passa ? '✓' : '✗'}</td></tr>`).join('')}${F.topo ? `<tr><td>texto claro na faixa azul</td><td class="ok">${fmt(contraste(C.claroNoAzul, C.azul))}:1 ✓</td></tr>` : ''}</table>`;

function alinhamento() {
  return pagina('Alinhamento do logo', `<div class="sup">MARCA MACUXI FDV · OPÇÃO E · MONTE RORAIMA (APROVADA) · 12/11/2026</div>
    <h1 style="margin-top:6px">Logo alinhado</h1>
    <div class="sub">Antes, o símbolo ficava só centralizado na altura do texto: o sol passava do topo do "M" e o lavrado não batia com a base de "FORÇA DE VENDAS". Agora o logo é uma peça só, com três regras fixas: <b>o topo do sol na linha do topo do "M"</b>, <b>a linha do lavrado na base de "FORÇA DE VENDAS"</b> e <b>"FORÇA DE VENDAS" com a largura exata de "Macuxi"</b>. O espaço entre o símbolo e a escrita é 0,3 da altura do logo.</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:26px">
      <div class="caixa"><h2>Antes</h2><div style="height:230px;display:flex;align-items:center;justify-content:center;position:relative">${marcaAntiga(150)}</div></div>
      <div class="caixa"><h2>Depois · com as linhas-guia</h2><div style="height:230px;display:flex;align-items:center;justify-content:center">${marca({ altura: 112, guias: true })}</div></div>
    </div>
    <div class="caixa" style="margin-top:20px"><h2>Versões</h2>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px">
        <div style="border:1px solid #E1E4DE;border-radius:12px;height:150px;display:flex;align-items:center;justify-content:center">${marca({ altura: 50 })}</div>
        <div style="background:${C.grafite};border-radius:12px;height:150px;display:flex;align-items:center;justify-content:center">${marca({ cor: C.azulClaro, sol: C.solClaro, texto: '#fff', desc: '#C9D0D8', altura: 50 })}</div>
        <div style="background:${C.azul};border-radius:12px;height:150px;display:flex;align-items:center;justify-content:center">${marca({ cor: '#fff', sol: C.solClaro, texto: '#fff', desc: C.claroNoAzul, altura: 50 })}</div>
        <div style="border:1px solid #E1E4DE;border-radius:12px;height:150px;display:flex;align-items:center;justify-content:center">${marca({ cor: '#000', sol: '#000', texto: '#000', desc: '#000', altura: 50 })}</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);font-size:12.5px;color:${C.ink2};text-align:center;margin-top:8px"><span>positiva</span><span>negativa no grafite</span><span>sobre o azul serra</span><span>monocromática</span></div>
      <div class="lin" style="gap:40px;margin-top:26px;align-items:flex-end">
        <div style="text-align:center">${marcaEmpilhada({ largura: 170 })}<div class="rot">empilhada (splash e materiais)</div></div>
        <div style="text-align:center">${marca({ altura: 30 })}<div class="rot">30 px (e-mail, cabeçalho)</div></div>
        <div style="text-align:center">${marca({ altura: 20 })}<div class="rot">20 px: o menor tamanho com a escrita</div></div>
        <div style="text-align:center">${icone(C.azul, C.sol, 24)}<div class="rot">abaixo disso, só o símbolo</div></div>
        <div style="text-align:center"><div style="width:64px;height:64px;border-radius:50%;background:${C.azul};display:flex;align-items:center;justify-content:center;margin:0 auto">${icone('#fff', C.solClaro, 40)}</div><div class="rot">ícone do Campo</div></div>
        <div style="text-align:center"><div style="width:64px;height:64px;border-radius:50%;background:${C.grafite};display:flex;align-items:center;justify-content:center;margin:0 auto">${icone(C.azulClaro, C.solClaro, 40)}</div><div class="rot">ícone do Gestão</div></div>
      </div></div>`);
}

function comparativoFundos() {
  const miniatura = (html) => `<div style="width:240px;height:496px;margin:0 auto"><div style="transform:scale(.8);transform-origin:top left">${html}</div></div>`;
  return pagina('Fundos', `<div class="sup">MARCA MACUXI FDV · OPÇÃO E · MONTE RORAIMA (APROVADA) · 12/11/2026 · FUNDO DO APP</div>
    <h1 style="margin-top:6px">Seis fundos lado a lado</h1>
    <div class="sub">A mesma tela Início e o mesmo Novo pedido, com a marca aprovada, em seis fundos. Os cartões continuam brancos. O contraste de cada texto foi conferido em cada fundo (mínimo 4,5:1 no texto e 3:1 no gráfico). As telas completas dos quatro principais estão nas pranchas "simulado-…".</div>
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:14px;margin-top:24px">
      ${FUNDOS.map((F) => `<div><div class="lin" style="gap:8px;margin-bottom:10px"><div style="width:34px;height:34px;border-radius:8px;border:1px solid #CFCAC0;background:${F.topo ? `linear-gradient(${C.azul} 0 50%,#fff 50%)` : F.hex}"></div><div><b style="font:800 16px Archivo">${F.nome}</b><div style="font:500 11px 'IBM Plex Mono';color:${C.ink2}">${F.topo ? `${C.azul} + ${F.hex}` : F.hex}</div></div></div></div>`).join('')}
      ${FUNDOS.map((F) => miniatura(T.inicio(F))).join('')}
      ${FUNDOS.map((F) => miniatura(T.itens(F))).join('')}
      ${FUNDOS.map((F) => `<div style="font-size:12.5px;line-height:1.45">${F.nota}<div style="margin-top:8px;font-size:12px">${tabela(F)}</div></div>`).join('')}
    </div>
    <div class="caixa" style="margin-top:24px;font-size:15px;line-height:1.55"><b>Recomendação: Areia #F6F1E7.</b> Tira a cara de sistema genérico trocando um token só, sem mexer em nenhuma tela. Dá o calor de Roraima, combina com o azul serra e com o sol, e todos os textos ficam bem acima do mínimo. A Palha é a mesma ideia, mais forte. O Topo azul é o mais marcante, mas muda o layout de todas as telas e pode vir depois, se você quiser mais marca na tela.</div>`);
}

function simulado(F) {
  return pagina(`Simulado · ${F.nome}`, `<div class="sup">MARCA MACUXI FDV · OPÇÃO E · MONTE RORAIMA (APROVADA) · 12/11/2026 · SIMULADO DE TODAS AS TELAS</div>
    <div class="lin" style="gap:16px;margin-top:6px"><div style="width:52px;height:52px;border-radius:12px;border:1px solid #CFCAC0;background:${F.topo ? `linear-gradient(${C.azul} 0 50%,#fff 50%)` : F.hex}"></div><div><h1>Fundo ${F.nome}</h1><div style="font:500 14px 'IBM Plex Mono';color:${C.ink2}">${F.topo ? `${C.azul} + ${F.hex}` : F.hex}</div></div></div>
    <div class="sub">${F.nota} Abaixo, o app Campo (vendedor e promotor), o app Gestão, o BKO, o portal, o PDF e o e-mail com a marca aprovada e este fundo.</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:26px 16px;margin-top:26px">
      ${ORDEM_TELAS.map(([id, nome]) => `<div style="display:flex;flex-direction:column;align-items:center">${T[id](F)}<div class="rot" style="font-weight:600;color:${C.grafite}">${nome}</div></div>`).join('')}
      <div style="font-size:13px;line-height:1.5;align-self:center"><b>Contraste neste fundo</b>${tabela(F)}</div>
      <div style="grid-column:1 / span 4;display:flex;gap:16px;align-items:flex-start"><div>${bko(F)}<div class="rot" style="font-weight:600;color:${C.grafite}">BKO · Pedidos</div></div><div>${portal(F)}<div class="rot" style="font-weight:600;color:${C.grafite}">Portal config. · Entrar</div></div></div>
      <div style="grid-column:1 / span 4">${pdfEEmail()}</div>
    </div>`);
}

// ---------- outros azuis (pedido de 12/11: "um azul mais névoa, mais estiloso, refinado, elegante") ----------
const misturar = (a, b, t) => {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v * (1 - t) + y[i] * t).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
};
const AZUIS = [
  { id: 'serra', nome: 'Azul serra', hex: '#24456B', nota: 'O aprovado na opção E. Firme e confiável, mas é o azul de muito sistema.' },
  { id: 'nevoa', nome: 'Azul névoa', hex: '#4A6C8C', nota: 'Azul acinzentado e leve, a névoa do topo do Monte Roraima. Suave e moderno; o mais "ar livre".' },
  { id: 'ardosia', nome: 'Azul ardósia', hex: '#3D5A73', nota: 'Azul de pedra, com cinza. Sóbrio e elegante, sem cara de banco nem de sistema.' },
  { id: 'noite', nome: 'Azul noite', hex: '#1E3350', nota: 'Marinho profundo, quase grafite. O mais sofisticado e premium; com o sol laranja, ganha muito contraste.' },
  { id: 'indigo', nome: 'Índigo névoa', hex: '#4C5F86', nota: 'Azul com um toque de violeta, empoeirado. O mais estiloso e diferente; foge do azul comum.' },
  { id: 'petroleo', nome: 'Azul petróleo', hex: '#1F4F5C', nota: 'Azul esverdeado escuro, das águas do Rio Branco. Elegante, mas fica perto do verde de "sucesso".' },
];
function corDoAzul(a) {
  return { azul: a.hex, azulClaro: misturar(a.hex, '#FFFFFF', 0.55), azulSuave: misturar(a.hex, '#FFFFFF', 0.86), claroNoAzul: misturar(a.hex, '#FFFFFF', 0.76), fundo: misturar(a.hex, '#FFFFFF', 0.93) };
}
function paresDoAzul(a) {
  const k = corDoAzul(a);
  return [
    ['texto branco no botão', '#FFFFFF', k.azul, 4.5], ['azul no fundo névoa (link, título)', k.azul, k.fundo, 4.5], ['azul no chip suave', k.azul, k.azulSuave, 4.5],
    ['azul claro no grafite', k.azulClaro, C.grafite, 4.5], ['texto de apoio no fundo névoa', C.ink3, k.fundo, 4.5], ['sol laranja no fundo névoa (gráfico)', C.sol, k.fundo, 3],
  ].map(([uso, fg, bg, min]) => ({ uso, fg, bg, razao: Number(contraste(fg, bg).toFixed(2)), minimo: min, passa: contraste(fg, bg) >= min }));
}
function azuis() {
  const original = { ...C };
  const miniatura = (html, w = 225, h = 465) => `<div style="width:${w}px;height:${h}px;margin:0 auto"><div style="transform:scale(.75);transform-origin:top left">${html}</div></div>`;
  const colunas = AZUIS.map((a) => {
    const k = corDoAzul(a);
    Object.assign(C, { azul: k.azul, azulClaro: k.azulClaro, azulSuave: k.azulSuave, claroNoAzul: k.claroNoAzul });
    const F = { hex: k.fundo };
    const html = {
      topo: `<div class="lin" style="gap:8px;margin-bottom:12px"><div style="width:40px;height:40px;border-radius:10px;background:${a.hex}"></div><div><b style="font:800 17px Archivo">${a.nome}</b><div style="font:500 11px 'IBM Plex Mono';color:${C.ink2}">${a.hex} · fundo ${k.fundo}</div></div></div>`,
      logo: `<div style="height:84px;border-radius:12px;background:${k.fundo};display:flex;align-items:center;justify-content:center">${marca({ altura: 30 })}</div><div style="height:84px;border-radius:12px;background:${a.hex};display:flex;align-items:center;justify-content:center;margin-top:8px">${marca({ cor: '#fff', sol: C.solClaro, texto: '#fff', desc: k.claroNoAzul, altura: 30 })}</div>
        <div class="lin" style="gap:10px;margin-top:10px;justify-content:center"><div style="width:56px;height:56px;border-radius:50%;background:${a.hex};display:flex;align-items:center;justify-content:center">${icone('#fff', C.solClaro, 34)}</div><div style="width:56px;height:56px;border-radius:50%;background:${C.grafite};display:flex;align-items:center;justify-content:center">${icone(k.azulClaro, C.solClaro, 34)}</div><div style="width:24px;height:24px;border-radius:50%;background:${a.hex};display:flex;align-items:center;justify-content:center">${icone('#fff', C.solClaro, 15)}</div></div>`,
      inicio: miniatura(T.inicio(F)),
      login: miniatura(T.login(F)),
      nota: `<div style="font-size:12.5px;line-height:1.45">${a.nota}</div><table style="font-size:11.5px;margin-top:8px">${paresDoAzul(a).map((q) => `<tr><td>${q.uso}</td><td class="${q.passa ? 'ok' : 'nao'}" style="white-space:nowrap">${fmt(q.razao)}:1 ${q.passa ? '✓' : '✗'}</td></tr>`).join('')}</table>`,
    };
    Object.assign(C, original);
    return { a, k, html };
  });
  const escopo = colunas.map(({ a, k }) => `.az-${a.id} .b1{background:${a.hex}}.az-${a.id} .aba.on{color:${a.hex}}.az-${a.id} .aba.on i{border-color:${a.hex};background:${k.azulSuave}}`).join('');
  const linha = (parte) => colunas.map(({ a, html }) => `<div class="az-${a.id}">${html[parte]}</div>`).join('');
  return pagina('Outros azuis', `<style>${escopo}</style><div class="sup">MARCA MACUXI FDV · OPÇÃO E · MONTE RORAIMA (APROVADA) · 12/11/2026 · OUTROS AZUIS</div>
    <h1 style="margin-top:6px">Seis azuis para a Macuxi</h1>
    <div class="sub">O mesmo logo, os mesmos ícones e as mesmas telas, trocando só o azul. Cada azul vem com o seu fundo névoa: o próprio azul bem clarinho, que tira o cinza sem esquentar a tela. O sol laranja continua igual. O contraste de cada par foi conferido.</div>
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:18px 14px;margin-top:24px">${linha('topo')}${linha('logo')}${linha('inicio')}${linha('login')}${linha('nota')}</div>
    <div class="caixa" style="margin-top:24px;font-size:15px;line-height:1.55"><b>Recomendação: Azul ardósia #3D5A73 com o fundo névoa dele.</b> É o que mais tira a cara de sistema: um azul com cinza de pedra, sóbrio e elegante, que conversa com o sol laranja sem brigar. O Azul noite é a alternativa mais premium (marinho profundo), e o Índigo névoa é o mais ousado. O Azul petróleo fica perto demais do verde de "sucesso" e não é recomendado.</div>`);
}

// ---------- Azul noite com o cabeçalho azul (pedido de 12/11: "coloque o azul noite naquele modelo do cabeçalho com fundo azul") ----------
function comAzul(id, fn) {
  const original = { ...C };
  const k = corDoAzul(AZUIS.find((a) => a.id === id));
  Object.assign(C, { azul: k.azul, azulClaro: k.azulClaro, azulSuave: k.azulSuave, claroNoAzul: k.claroNoAzul });
  try { return fn(); } finally { Object.assign(C, original); }
}
const NEVOA_NOITE = corDoAzul(AZUIS.find((a) => a.id === 'noite')).fundo;
const FUNDOS_NOITE = [
  { id: 'branco', nome: 'Branco', hex: '#FFFFFF', topo: true, nota: 'Corpo branco puro. O mais limpo e o mais legível ao sol; o azul noite do topo fica bem marcado. Os cartões precisam de borda.' },
  { id: 'cinza', nome: 'Cinza de hoje', hex: '#F3F4F1', topo: true, nota: 'O cinza-esverdeado de hoje. Com o topo azul noite melhora, mas continua frio e neutro.' },
  { id: 'nevoa', nome: 'Névoa noite', hex: NEVOA_NOITE, topo: true, nota: 'O azul noite bem clarinho. Tudo no mesmo tom, da faixa ao fundo: calmo e coerente.' },
  { id: 'gelo', nome: 'Gelo', hex: '#E8ECF1', topo: true, nota: 'Azul-acinzentado mais presente. Os cartões brancos saltam, mas a tela fica mais fria.' },
  { id: 'perola', nome: 'Pérola', hex: '#F8F6F1', topo: true, nota: 'Branco quebrado, um toque quente. Com o marinho, é a dupla clássica de marca premium.' },
  { id: 'areia', nome: 'Areia', hex: '#F6F1E7', topo: true, nota: 'Bege claro do lavrado. Com o marinho, fica quente e elegante, mas é o fundo que mais aparece.' },
];
const SIMULADOS_NOITE = ['branco', 'cinza', 'perola'];
const REC_NOITE = 'perola';
const nomeNoite = (F) => ({ ...F, nome: `${F.nome} · cabeçalho azul noite` });
function noiteFundos() {
  const miniatura = (html) => `<div style="width:228px;height:471px;margin:0 auto"><div style="transform:scale(.76);transform-origin:top left">${html}</div></div>`;
  return pagina('Azul noite · fundos', `<div class="sup">MARCA MACUXI FDV · OPÇÃO E · MONTE RORAIMA · 12/11/2026 · AZUL NOITE #1E3350 COM CABEÇALHO AZUL</div>
    <h1 style="margin-top:6px">Azul noite no cabeçalho, seis fundos no corpo</h1>
    <div class="sub">O modelo do cabeçalho azul, agora em Azul noite #1E3350: o título de cada tela numa faixa marinho e o corpo no fundo escolhido. Abaixo, Início, Novo pedido e login em seis fundos. Os cartões continuam brancos e o sol laranja continua igual. O contraste de cada texto foi conferido em cada fundo.</div>
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:16px 12px;margin-top:24px">
      ${FUNDOS_NOITE.map((F) => `<div class="lin" style="gap:8px"><div style="width:34px;height:34px;border-radius:8px;border:1px solid #CFCAC0;background:linear-gradient(${C.azul} 0 45%,${F.hex} 45%)"></div><div><b style="font:800 16px Archivo">${F.nome}${F.id === REC_NOITE ? ' ★' : ''}</b><div style="font:500 11px 'IBM Plex Mono';color:${C.ink2}">${F.hex}</div></div></div>`).join('')}
      ${FUNDOS_NOITE.map((F) => miniatura(T.inicio(F))).join('')}
      ${FUNDOS_NOITE.map((F) => miniatura(T.itens(F))).join('')}
      ${FUNDOS_NOITE.map((F) => miniatura(T.login(F))).join('')}
      ${FUNDOS_NOITE.map((F) => `<div style="font-size:12.5px;line-height:1.45">${F.nota}<div style="margin-top:8px;font-size:12px">${tabela(F)}</div></div>`).join('')}
    </div>
    <div class="caixa" style="margin-top:24px;font-size:15px;line-height:1.55"><b>Recomendação: Pérola #F8F6F1 com o cabeçalho Azul noite.</b> Marinho com branco quebrado é a dupla clássica de marca elegante: o corpo fica claro como o branco, mas sem o brilho frio, e não tem a cara de sistema do cinza. Se você preferir o máximo de leitura ao sol, o Branco puro. As telas completas do Branco, do Cinza e da Pérola estão nas pranchas "noite-simulado-…".</div>`);
}

// ---------- medir, gravar e fotografar ----------
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const navegador = await chromium.launch();
const aba = await navegador.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const fonteAbs = `file://${join(process.cwd(), 'apps/web/app/fonts/Archivo_800ExtraBold.ttf')}`;
const medida = join(tmpdir(), `macuxi-medida-${process.pid}.html`);
writeFileSync(medida, `<!doctype html><style>@font-face{font-family:Archivo;font-weight:800;src:url(${fonteAbs})}</style><svg width="600" height="120"><text id="m" x="0" y="80" font-family="Archivo" font-weight="800" font-size="100">Macuxi</text></svg>`);
await aba.goto(`file://${medida}`);
await aba.evaluate(() => document.fonts.ready);
if (!(await aba.evaluate(() => document.fonts.check('800 100px Archivo')))) throw new Error('a fonte Archivo 800 não carregou para a medida');
rmSync(medida);
calcularLockup(await aba.evaluate(() => document.getElementById('m').getComputedTextLength()));
console.log(`largura de "Macuxi" a 100 px: ${L.larguraM.toFixed(1)}`);
const relatorio = Object.fromEntries(FUNDOS.map((F) => [F.id, paresDoFundo(F)]));
relatorio.topo.push({ uso: 'texto claro na faixa azul', fg: C.claroNoAzul, bg: C.azul, razao: Number(contraste(C.claroNoAzul, C.azul).toFixed(2)), minimo: 4.5, passa: contraste(C.claroNoAzul, C.azul) >= 4.5 });
relatorio.azuis = Object.fromEntries(AZUIS.map((a) => [a.id, paresDoAzul(a)]));
relatorio.noite = comAzul('noite', () => Object.fromEntries(FUNDOS_NOITE.map((F) => [F.id, [...paresDoFundo(F), { uso: 'texto claro na faixa azul noite', fg: C.claroNoAzul, bg: C.azul, razao: Number(contraste(C.claroNoAzul, C.azul).toFixed(2)), minimo: 4.5, passa: contraste(C.claroNoAzul, C.azul) >= 4.5 }]])));
writeFileSync(join(AQUI, 'contraste.json'), `${JSON.stringify(relatorio, null, 2)}\n`);
const saidas = { alinhamento: alinhamento(), 'fundos-comparativo': comparativoFundos(), azuis: azuis() };
for (const id of SIMULADOS) saidas[`simulado-${id}`] = simulado(FUNDOS.find((f) => f.id === id));
saidas['noite-fundos'] = comAzul('noite', noiteFundos);
for (const id of SIMULADOS_NOITE) saidas[`noite-simulado-${id}`] = comAzul('noite', () => simulado(nomeNoite(FUNDOS_NOITE.find((f) => f.id === id))));
for (const [nome, html] of Object.entries(saidas)) writeFileSync(join(AQUI, `${nome}.html`), html);

for (const nome of Object.keys(saidas)) {
  await aba.goto(`file://${join(AQUI, `${nome}.html`)}`);
  await aba.evaluate(() => document.fonts.ready);
  await aba.screenshot({ path: join(AQUI, `${nome}.png`), fullPage: true });
  console.log(`${nome}.png`);
}
await navegador.close();
