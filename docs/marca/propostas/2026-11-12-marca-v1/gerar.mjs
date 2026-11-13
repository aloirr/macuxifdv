// Gera as pranchas da proposta de marca v1 (T-0169, design-de-marca): HTML → PNG pelo Playwright.
// Uso (na raiz do repositório): node docs/marca/propostas/2026-11-12-marca-v1/gerar.mjs
// Saída nesta pasta: opcao-a.html/png, opcao-b.html/png, opcao-c.html/png, comparativa.html/png e contraste.json.
// As fontes são as do BKO (apps/web/app/fonts, licença OFL). Empresas e pessoas nas simulações são fictícias.
import { writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FONTES = relative(AQUI, join(process.cwd(), 'apps/web/app/fonts')).replaceAll('\\', '/');

// ---------- contraste (WCAG 2.x, a mesma conta de packages/ui/src/comum/contraste.ts) ----------
const canal = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (h) => { const n = h.replace('#', ''); const [r, g, b] = [0, 2, 4].map((i) => canal(parseInt(n.slice(i, i + 2), 16))); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contraste = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const MIN = { texto: 4.5, grafico: 3 };
const fmt = (n) => n.toFixed(2).replace('.', ',');

// ---------- símbolos (viewBox 0 0 64 64) ----------
let seq = 0;
const SIMBOLO = {
  // A · Rota: um traço só desenha o M (o caminho do dia) e termina no ponto (a visita feita).
  rota: (cor, ponto = cor) => `<path d="M14 50V18l18 20 18-20v17" fill="none" stroke="${cor}" stroke-width="8.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="50" cy="50.5" r="5.6" fill="${ponto}"/>`,
  // B · Sol a sol: o sol no horizonte, cortado por duas faixas (o dia do vendedor, do nascer ao pôr do sol).
  sol: (cor) => {
    const id = `m${++seq}`;
    return `<defs><mask id="${id}"><rect width="64" height="64" fill="#fff"/><rect x="0" y="35" width="64" height="5.5" fill="#000"/><rect x="0" y="45.5" width="64" height="5" fill="#000"/></mask></defs><circle cx="32" cy="33" r="22" fill="${cor}" mask="url(#${id})"/>`;
  },
  // C · Confluência: dois traços que viram um (o Uraricoera e o Tacutu formam o Rio Branco): o campo e o escritório no mesmo fluxo.
  rio: (cor) => `<path d="M10 17c18 0 18 15 32 15h12M10 47c18 0 18-15 32-15" fill="none" stroke="${cor}" stroke-width="8.5" stroke-linecap="round" stroke-linejoin="round"/>`,
};
const svg = (simbolo, tam, cor, ponto) => `<svg viewBox="0 0 64 64" width="${tam}" height="${tam}" aria-hidden="true">${SIMBOLO[simbolo](cor, ponto)}</svg>`;

// ---------- as opções ----------
const OPCOES = [
  {
    id: 'a',
    nome: 'Rota',
    tese: 'Mantém o laranja e o grafite que já estão em todas as telas e cria o logo que falta.',
    ideia: 'Um traço só desenha o M: é a rota do dia. O ponto no fim é a visita feita. Serve ao vendedor e ao promotor.',
    simbolo: 'rota',
    principal: '#C2540A', sobrePrincipal: '#FFFFFF', textoDestaque: '#8F3D06', destaqueEscuro: '#F59A52', suave: '#FBE9DC',
    simboloClaro: '#C2540A', pontoClaro: '#16202A', simboloEscuro: '#F59A52', pontoEscuro: '#FFFFFF',
    escrita: { familia: 'Archivo', peso: 800, caixa: 'Macuxi', espaco: '-0.02em' },
    paleta: [
      ['Laranja Macuxi', '#C2540A', 'preenchimento: botão principal, ícone, barra, contador'],
      ['Laranja texto', '#8F3D06', 'texto laranja sobre claro: link, aba ativa, "PEDIDO" no PDF'],
      ['Laranja claro', '#F59A52', 'laranja sobre o grafite'],
      ['Laranja suave', '#FBE9DC', 'fundo do chip e do cartão em destaque'],
      ['Grafite', '#16202A', 'texto, fundo escuro, ícone do Gestão'],
      ['Fundo', '#F3F4F1', 'fundo das telas'],
      ['Verde sucesso', '#1D6B4F', 'só situação (meta batida, aprovado); nunca decoração'],
    ],
    pares: [
      ['texto branco no botão laranja', '#FFFFFF', '#C2540A', 'texto'],
      ['laranja texto no fundo', '#8F3D06', '#F3F4F1', 'texto'],
      ['laranja texto no branco', '#8F3D06', '#FFFFFF', 'texto'],
      ['laranja claro no grafite', '#F59A52', '#16202A', 'texto'],
      ['grafite no fundo', '#16202A', '#F3F4F1', 'texto'],
      ['ponto grafite no ícone laranja', '#16202A', '#C2540A', 'grafico'],
      ['símbolo laranja no branco', '#C2540A', '#FFFFFF', 'grafico'],
    ],
    tipografia: 'Archivo ExtraBold no nome e nos números · IBM Plex Sans no texto (as mesmas de hoje)',
    custo: 'Baixo: nenhuma cor muda. Entra o logo: ícone do app, splash, login, portal e o logo padrão do PDF.',
    ganho: 'Reconhecimento: o vendedor já vê esse laranja todo dia. O logo novo só soma.',
    risco: 'Laranja é comum no varejo; o que diferencia é o símbolo, que precisa aparecer sempre igual.',
    campo: { fundo: '#C2540A', simbolo: '#FFFFFF', ponto: '#16202A' },
    gestao: { fundo: '#16202A', simbolo: '#FFFFFF', ponto: '#F59A52' },
  },
  {
    id: 'b',
    nome: 'Sol a sol',
    tese: 'Amarelo-sol com grafite: o par mais legível debaixo do sol, como placa de estrada.',
    ideia: 'O sol no horizonte, cortado em faixas: o dia do vendedor, do nascer ao pôr do sol.',
    simbolo: 'sol',
    principal: '#F2A900', sobrePrincipal: '#16202A', textoDestaque: '#7A4100', destaqueEscuro: '#F2A900', suave: '#FDF0C8',
    simboloClaro: '#16202A', simboloEscuro: '#F2A900',
    escrita: { familia: 'Archivo', peso: 800, caixa: 'MACUXI', espaco: '0.04em' },
    paleta: [
      ['Amarelo sol', '#F2A900', 'preenchimento: botão principal (texto grafite), ícone; destaque sobre o grafite'],
      ['Terra', '#7A4100', 'texto de destaque sobre claro: link, aba ativa, "PEDIDO" no PDF'],
      ['Sol suave', '#FDF0C8', 'fundo do chip e do cartão em destaque'],
      ['Grafite', '#16202A', 'texto, fundo escuro, texto sobre o amarelo'],
      ['Fundo', '#F3F4F1', 'fundo das telas'],
      ['Verde sucesso', '#1D6B4F', 'só situação'],
    ],
    pares: [
      ['texto grafite no botão amarelo', '#16202A', '#F2A900', 'texto'],
      ['terra no fundo', '#7A4100', '#F3F4F1', 'texto'],
      ['terra no branco', '#7A4100', '#FFFFFF', 'texto'],
      ['amarelo no grafite', '#F2A900', '#16202A', 'texto'],
      ['grafite no fundo', '#16202A', '#F3F4F1', 'texto'],
      ['amarelo no branco (barra, ícone)', '#F2A900', '#FFFFFF', 'grafico'],
    ],
    tipografia: 'Archivo ExtraBold em caixa alta no nome · IBM Plex Sans no texto (as mesmas de hoje)',
    custo: 'Alto: troca a cor de todas as telas e do BKO; o botão principal passa a ter texto grafite; o aviso (hoje amarelo-terra) precisa de outro tom; a barra amarela some no branco e precisa de contorno.',
    ganho: 'A tela mais legível ao sol e a marca mais visível na tela do celular.',
    risco: 'O amarelo falha no branco (2,01:1) e se confunde com "aviso". O sol é um símbolo comum, pouco nosso.',
    campo: { fundo: '#F2A900', simbolo: '#16202A' },
    gestao: { fundo: '#16202A', simbolo: '#F2A900' },
  },
  {
    id: 'c',
    nome: 'Confluência',
    tese: 'Azul de rio com grafite: sério e de confiança, perto do mundo do ERP.',
    ideia: 'Dois traços que viram um: o Uraricoera e o Tacutu formam o Rio Branco, o rio de Roraima. O campo e o escritório no mesmo fluxo.',
    simbolo: 'rio',
    principal: '#0A5A8C', sobrePrincipal: '#FFFFFF', textoDestaque: '#0A5A8C', destaqueEscuro: '#7CC4DE', suave: '#E1EEF5',
    simboloClaro: '#0A5A8C', simboloEscuro: '#7CC4DE',
    escrita: { familia: 'IBM Plex Sans', peso: 700, caixa: 'Macuxi', espaco: '-0.01em' },
    paleta: [
      ['Azul rio', '#0A5A8C', 'preenchimento e texto de destaque: botão, link, ícone, "PEDIDO" no PDF'],
      ['Azul claro', '#7CC4DE', 'azul sobre o grafite'],
      ['Azul suave', '#E1EEF5', 'fundo do chip e do cartão em destaque'],
      ['Grafite', '#16202A', 'texto, fundo escuro, ícone do Gestão'],
      ['Fundo', '#F3F4F1', 'fundo das telas'],
      ['Verde sucesso', '#1D6B4F', 'só situação'],
    ],
    pares: [
      ['texto branco no botão azul', '#FFFFFF', '#0A5A8C', 'texto'],
      ['azul no fundo', '#0A5A8C', '#F3F4F1', 'texto'],
      ['azul no branco', '#0A5A8C', '#FFFFFF', 'texto'],
      ['azul claro no grafite', '#7CC4DE', '#16202A', 'texto'],
      ['grafite no fundo', '#16202A', '#F3F4F1', 'texto'],
    ],
    tipografia: 'IBM Plex Sans Bold no nome · Archivo nos títulos e números · IBM Plex Sans no texto',
    custo: 'Médio: troca o laranja por azul em todas as telas e no BKO; o contraste fica mais folgado (uma cor serve de fundo e de texto).',
    ganho: 'Uma cor só para tudo (mais simples de aplicar) e cara de sistema de gestão.',
    risco: 'Azul é a cor da maioria dos sistemas e dos aplicativos de banco: a marca some no meio deles. Perde o laranja que o vendedor já conhece.',
    campo: { fundo: '#0A5A8C', simbolo: '#FFFFFF' },
    gestao: { fundo: '#16202A', simbolo: '#7CC4DE' },
  },
];

// ---------- estilo ----------
const css = `
@font-face{font-family:Archivo;font-weight:600;src:url(${FONTES}/Archivo_600SemiBold.ttf)}
@font-face{font-family:Archivo;font-weight:700;src:url(${FONTES}/Archivo_700Bold.ttf)}
@font-face{font-family:Archivo;font-weight:800;src:url(${FONTES}/Archivo_800ExtraBold.ttf)}
@font-face{font-family:'IBM Plex Sans';font-weight:400;src:url(${FONTES}/IBMPlexSans_400Regular.ttf)}
@font-face{font-family:'IBM Plex Sans';font-weight:500;src:url(${FONTES}/IBMPlexSans_500Medium.ttf)}
@font-face{font-family:'IBM Plex Sans';font-weight:600;src:url(${FONTES}/IBMPlexSans_600SemiBold.ttf)}
@font-face{font-family:'IBM Plex Sans';font-weight:700;src:url(${FONTES}/IBMPlexSans_700Bold.ttf)}
@font-face{font-family:'IBM Plex Mono';font-weight:500;src:url(${FONTES}/IBMPlexMono_500Medium.ttf)}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'IBM Plex Sans';color:#16202A;background:#E4E6E0;width:1600px;padding:48px}
h1{font:800 40px/1.1 Archivo;letter-spacing:-.01em}
h2{font:700 13px/1 'IBM Plex Sans';letter-spacing:.1em;text-transform:uppercase;color:#4A5562;margin:0 0 14px}
.sub{font-size:17px;color:#4A5562;margin-top:8px;max-width:1200px;line-height:1.45}
.grade{display:grid;gap:20px}
.caixa{background:#fff;border-radius:18px;padding:24px}
.rot{font-size:12px;color:#4A5562;margin-top:8px;text-align:center;line-height:1.35}
.lin{display:flex;align-items:center;gap:14px}
table{border-collapse:collapse;width:100%;font-size:13px}
td,th{padding:7px 8px;border-bottom:1px solid #ECEEE9;text-align:left;vertical-align:middle}
th{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#4A5562;font-weight:700}
.ok{color:#1D6B4F;font-weight:700}.nao{color:#A8261B;font-weight:700}
.tel{width:300px;height:620px;border-radius:34px;border:9px solid #0F1419;overflow:hidden;position:relative;background:#F3F4F1;flex:none}
.barra{height:26px;display:flex;justify-content:space-between;align-items:center;padding:0 16px;font-size:11px;font-weight:600}
`;

// ---------- peças ----------
function escrita(o, cor, tam = 40) {
  const e = o.escrita;
  return `<span style="font-family:'${e.familia}';font-weight:${e.peso};font-size:${tam}px;letter-spacing:${e.espaco};color:${cor};line-height:1">${e.caixa}</span>`;
}
function logo(o, { simbolo, ponto, texto, desc, tam = 64 }) {
  return `<div class="lin" style="gap:${tam * 0.22}px">${svg(o.simbolo, tam, simbolo, ponto)}<div>${escrita(o, texto, tam * 0.66)}<div style="font:600 ${tam * 0.17}px 'IBM Plex Sans';letter-spacing:.14em;color:${desc};margin-top:${tam * 0.07}px">FORÇA DE VENDAS</div></div></div>`;
}
const logoClaro = (o, tam) => logo(o, { simbolo: o.simboloClaro, ponto: o.pontoClaro, texto: '#16202A', desc: '#4A5562', tam });
const logoEscuro = (o, tam) => logo(o, { simbolo: o.simboloEscuro, ponto: o.pontoEscuro, texto: '#FFFFFF', desc: '#C9D0D8', tam });
function icone(o, variante, tam, forma = 'circulo') {
  const v = o[variante];
  const raio = { arredondado: '28%', circulo: '50%', gota: '50% 50% 50% 14%' }[forma];
  return `<div style="width:${tam}px;height:${tam}px;border-radius:${raio};background:${v.fundo};display:flex;align-items:center;justify-content:center;flex:none">${svg(o.simbolo, tam * 0.6, v.simbolo, v.ponto ?? v.simbolo)}</div>`;
}
function adaptativo(o, variante) {
  const v = o[variante];
  // camada 108 dp desenhada a 1,5 px/dp; tracejado = zona segura (círculo de 66 dp), que nenhuma máscara corta
  return `<div style="position:relative;width:162px;height:162px;background:${v.fundo};flex:none">
    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">${svg(o.simbolo, 64.8, v.simbolo, v.ponto ?? v.simbolo)}</div>
    <div style="position:absolute;left:31.5px;top:31.5px;width:99px;height:99px;border-radius:50%;border:1.5px dashed ${v.fundo === '#16202A' ? '#8A949C' : '#16202A'};opacity:.7"></div></div>`;
}
function tematico(o) {
  // ícone monocromático do Android 13+: o sistema pinta o símbolo na cor do tema do aparelho
  return `<div style="width:64px;height:64px;border-radius:50%;background:#DCE3EC;display:flex;align-items:center;justify-content:center;flex:none">${svg(o.simbolo, 38, '#2F4156')}</div>`;
}

function telaInicial(o) {
  const outros = ['Telefone', 'Mensagens', 'Câmera', 'Galeria', 'Agenda', 'Mapas', 'Relógio', 'Arquivos'];
  const gen = (n, i) => `<div style="text-align:center;width:66px"><div style="width:52px;height:52px;border-radius:50%;margin:0 auto;background:${['#5F7A8C', '#7B8B5E', '#8C6F5F', '#6A6F8C'][i % 4]};opacity:.85"></div><div style="font-size:10.5px;color:#fff;margin-top:5px;white-space:nowrap">${n}</div></div>`;
  const nosso = (v, n) => `<div style="text-align:center;width:66px"><div style="margin:0 auto;width:52px">${icone(o, v, 52)}</div><div style="font-size:10.5px;color:#fff;margin-top:5px;white-space:nowrap;font-weight:600">${n}</div></div>`;
  const itens = [gen(outros[0], 0), gen(outros[1], 1), nosso('campo', 'Macuxi Campo'), gen(outros[2], 2), gen(outros[3], 3), gen(outros[4], 0), nosso('gestao', 'Macuxi Gestão'), gen(outros[5], 1), gen(outros[6], 2), gen(outros[7], 3)];
  return `<div class="tel" style="background:linear-gradient(170deg,#6E8A9C 0%,#9AAE9A 55%,#C9B48A 100%)">
    <div class="barra" style="color:#fff"><span>06:30</span><span>4G ▮▮▮ 90%</span></div>
    <div style="text-align:center;color:#fff;margin-top:46px;font:300 54px/1 'IBM Plex Sans'">06:30</div>
    <div style="text-align:center;color:#fff;font-size:13px;margin-top:6px">quinta-feira, 12 de novembro</div>
    <div style="position:absolute;left:14px;right:14px;bottom:70px;display:grid;grid-template-columns:repeat(4,1fr);row-gap:22px;justify-items:center">${itens.join('')}</div>
    <div style="position:absolute;left:24px;right:24px;bottom:22px;height:36px;border-radius:18px;background:rgba(255,255,255,.75)"></div></div>`;
}

function telaInicio(o) {
  const ink = o.textoDestaque;
  return `<div class="tel"><div class="barra"><span>06:30</span><span>4G ▮▮▮ 90%</span></div>
    <div style="padding:14px 16px 0">
      <div style="font-size:12px;color:#4A5562">Quinta, 12 de novembro</div>
      <div style="font:800 25px/1.15 Archivo;margin-top:4px">Bom dia, Lucas</div>
      <div style="font-size:12px;color:#4A5562;margin-top:3px">6 visitas hoje · 3 feitas</div>
      <div style="background:#fff;border:1px solid #E1E4DE;border-radius:14px;padding:12px;margin-top:12px">
        <div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:10px;letter-spacing:.1em;font-weight:700;color:#4A5562">RECADOS</span><span style="font-size:10.5px;font-weight:600;color:${ink};background:${o.suave};padding:2px 8px;border-radius:99px">2 novos</span></div>
        <div style="font-size:12px;margin-top:8px;line-height:1.35"><b>Prioridade:</b> passe cedo no Mercadinho São Jorge, título vencido.</div></div>
      <div style="background:#fff;border:1px solid #E1E4DE;border-radius:14px;padding:12px;margin-top:10px">
        <div style="display:flex;justify-content:space-between"><span style="font-size:10px;letter-spacing:.1em;font-weight:700;color:#4A5562">META DO MÊS</span><span style="font-size:11px;font-weight:600">31%</span></div>
        <div style="font:800 18px Archivo;margin-top:6px">R$ 55.800 de R$ 180.000</div>
        <div style="height:6px;border-radius:3px;background:#ECEEE9;margin-top:8px;${o.id === 'b' ? 'box-shadow:0 0 0 1px #16202A;' : ''}"><div style="width:31%;height:100%;border-radius:3px;background:${o.principal}"></div></div>
        <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-top:10px"><span>Positivação</span><b>9 de 15 clientes</b></div>
        <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-top:6px"><span>Visitas</span><b>41 de 90</b></div></div>
      <div style="background:#fff;border:1px solid #E1E4DE;border-radius:14px;padding:0 12px;margin-top:10px;font-size:12px">
        <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #ECEEE9"><b>Orçamentos</b><span>3 · R$ 1.150 ›</span></div>
        <div style="display:flex;justify-content:space-between;padding:10px 0"><b>A faturar</b><span>6 · R$ 3.989 ›</span></div></div>
      <div style="height:44px;border-radius:14px;background:#16202A;color:#fff;font-weight:600;font-size:14px;display:flex;align-items:center;justify-content:center;margin-top:14px">↻ Sincronizar</div>
    </div>
    <div style="position:absolute;bottom:0;left:0;right:0;height:54px;background:#fff;border-top:1px solid #E1E4DE;display:flex;justify-content:space-around;align-items:center;font-size:10px;color:#4A5562">
      ${['Início', 'Rota', 'Clientes', 'Pedidos', 'Mais'].map((t, i) => `<div style="text-align:center;${i === 0 ? `color:${ink};font-weight:700` : ''}"><div style="width:18px;height:18px;margin:0 auto 3px;border-radius:5px;border:2px solid ${i === 0 ? (o.id === 'b' ? '#16202A' : o.principal) : '#5B6673'};${i === 0 && o.id === 'b' ? 'background:#F2A900;' : ''}"></div>${t}</div>`).join('')}</div></div>`;
}

function telaLogin(o) {
  const campo = (r, v) => `<div style="font-size:11.5px;font-weight:600;margin:12px 0 5px">${r}</div><div style="height:44px;border:1px solid #C9CEC6;border-radius:12px;background:#fff;padding:0 12px;display:flex;align-items:center;font-size:13px">${v}</div>`;
  return `<div class="tel" style="background:#F3F4F1"><div class="barra"><span>06:30</span><span>4G ▮▮▮ 90%</span></div>
    <div style="padding:40px 22px 0">
      <div style="display:flex;justify-content:center">${logoClaro(o, 58)}</div>
      <div style="font:800 24px Archivo;margin-top:38px">Entrar</div>
      ${campo('Código da empresa', 'DISTEX')}${campo('E-mail', 'lucas@exemplo.com.br')}${campo('Senha', '••••••••')}
      <div style="height:50px;border-radius:14px;background:${o.principal};color:${o.sobrePrincipal};font-weight:700;font-size:15px;display:flex;align-items:center;justify-content:center;margin-top:20px">Entrar</div>
      <div style="text-align:center;font-size:12.5px;font-weight:600;color:${o.textoDestaque};margin-top:14px">Esqueci a senha</div>
    </div>
    <div style="position:absolute;bottom:18px;left:0;right:0;text-align:center;font-size:11px;color:#4A5562">Macuxi Campo · vendedores e promotores</div></div>`;
}

function pdf(o, comLogoDoCliente) {
  const logoCliente = comLogoDoCliente
    ? `<div style="width:54px;height:54px;border-radius:10px;background:#E6E9E2;display:flex;align-items:center;justify-content:center;font:800 18px Archivo;color:#4A5562">DE</div>`
    : icone(o, 'campo', 54, 'arredondado');
  return `<div><div style="background:#fff;border:1px solid #D6DAD1;border-radius:4px;padding:20px 22px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div class="lin" style="gap:12px">${logoCliente}<div><div style="font:800 20px Archivo">Distribuidora Exemplo</div>
        <div style="font-size:9.5px;color:#4A5562;margin-top:3px;white-space:nowrap">Filial Boa Vista · CNPJ 12.345.678/0002-71 · (95) 3224-1000</div>
        <div style="font-size:9.5px;color:#4A5562;white-space:nowrap">Rua Exemplo, 450 · Centro · Boa Vista/RR · CEP 69301-000</div></div></div>
      <div style="text-align:right;flex:none;margin-left:10px"><span style="font:700 10.5px 'IBM Plex Sans';letter-spacing:.08em;color:${o.textoDestaque}">PEDIDO</span> <span style="font:800 24px Archivo">000014</span><div style="font-size:10.5px;color:#4A5562">12/11/2026</div></div></div>
    <div style="margin-top:14px;height:24px;border:1px solid #16202A;border-radius:4px;background:#F1F2F0"></div>
    <div style="margin-top:12px;height:20px;background:#00843D;color:#fff;font:700 9px 'IBM Plex Sans';letter-spacing:.08em;display:flex;align-items:center;padding-left:8px">ITEM · CÓDIGO · DESCRIÇÃO · MARCA · EMB. · QTD · PREÇO UNIT. · TOTAL</div>
    <div style="height:12px;border-bottom:1px solid #ECEEE9"></div><div style="height:12px;background:#F3F4F1"></div></div>
    <div class="rot">${comLogoDoCliente ? 'PDF com o logo da distribuidora (o caso normal): a Macuxi não aparece' : 'Distribuidora sem logo cadastrado: o ícone Macuxi entra no lugar do ícone provisório de hoje'}</div></div>`;
}

function email(o) {
  return `<div style="background:#fff;border:1px solid #D6DAD1;border-radius:8px;padding:16px 20px;font-size:13px;line-height:1.5">
    <div style="color:#4A5562;font-size:12px">Assunto: Seu acesso ao Macuxi Campo</div>
    <div style="margin-top:8px">Olá, Lucas. Seu acesso está pronto. Entre com o código da empresa <b>DISTEX</b> e o seu e-mail.</div>
    <div style="margin-top:14px;padding-top:12px;border-top:3px solid ${o.principal}">
      <div class="lin" style="gap:12px">${svg(o.simbolo, 34, o.simboloClaro, o.pontoClaro)}
      <div><div style="font-weight:700">Equipe Macuxi FDV</div><div style="font-size:12px;color:#4A5562">Força de vendas para distribuidores e indústria · Boa Vista, RR</div>
      <div style="font-size:12px;font-weight:600;color:${o.textoDestaque}">macuxifdv.com.br</div></div></div></div></div>`;
}

function tabelaContraste(o) {
  return `<table><tr><th>Par</th><th>Cores</th><th>Razão</th><th>Mínimo</th></tr>${o.pares
    .map(([uso, fg, bg, tipo]) => {
      const r = contraste(fg, bg);
      const ok = r >= MIN[tipo];
      return `<tr><td>${uso}</td><td><span style="display:inline-block;padding:2px 8px;border-radius:6px;background:${bg};color:${fg};border:1px solid #E1E4DE;font-weight:700">Aa ■</span> <span style="font:500 11px 'IBM Plex Mono';color:#4A5562">${fg} / ${bg}</span></td><td class="${ok ? 'ok' : 'nao'}">${fmt(r)}:1 ${ok ? '✓' : '✗'}</td><td>${tipo === 'texto' ? 'texto 4,5' : 'gráfico 3,0'}</td></tr>`;
    })
    .join('')}</table>`;
}

function prancha(o, ordem) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Opção ${o.id.toUpperCase()} · ${o.nome}</title><style>${css}</style></head><body>
  <div style="margin-bottom:28px">
    <div style="font:600 14px 'IBM Plex Sans';color:#4A5562;letter-spacing:.08em">MARCA MACUXI FDV · PROPOSTA V1 · 12/11/2026 · OPÇÃO ${ordem} DE 3${o.id === 'a' ? ' · RECOMENDADA' : ''}</div>
    <h1 style="margin-top:6px">Opção ${o.id.toUpperCase()} · ${o.nome}</h1><div class="sub"><b>${o.tese}</b> ${o.ideia}</div></div>

  <div class="grade" style="grid-template-columns:1.25fr 1fr">
    <div class="caixa"><h2>1. Logo · positiva, negativa e monocromática</h2>
      <div class="grade" style="grid-template-columns:1fr 1fr;gap:14px">
        <div style="background:#fff;border:1px solid #E1E4DE;border-radius:12px;height:150px;display:flex;align-items:center;justify-content:center">${logoClaro(o)}</div>
        <div style="background:#16202A;border-radius:12px;height:150px;display:flex;align-items:center;justify-content:center">${logoEscuro(o)}</div>
        <div style="background:#fff;border:1px solid #E1E4DE;border-radius:12px;height:150px;display:flex;align-items:center;justify-content:center">${logo(o, { simbolo: '#000000', texto: '#000000', desc: '#000000' })}</div>
        <div style="background:${o.principal};border-radius:12px;height:150px;display:flex;align-items:center;justify-content:center">${logo(o, { simbolo: o.sobrePrincipal, texto: o.sobrePrincipal, desc: o.sobrePrincipal })}</div>
      </div>
      <div style="font-size:12px;color:#4A5562;margin-top:8px">Em cima: positiva (fundo claro) e negativa (fundo grafite). Embaixo: monocromática (impressão em uma cor, carimbo, fax) e sobre a cor principal.</div>
      <div class="lin" style="margin-top:18px;gap:26px;font-size:12px;color:#4A5562">
        <div class="lin" style="gap:8px">${svg(o.simbolo, 24, '#16202A', '#16202A')}<span>símbolo sozinho<br>a partir de 24 px</span></div>
        <div>${escrita(o, '#16202A', 22)}<div style="margin-top:4px">escrita: ${o.escrita.familia} ${o.escrita.peso}</div></div>
        <div style="max-width:330px">Macuxi é o nome de um povo: escrito sempre inteiro, sem letra deformada, sem sombra e sem contorno.</div></div>
    </div>
    <div class="caixa"><h2>2. Ícone do app Android</h2>
      <div class="lin" style="gap:18px;align-items:flex-start">
        <div>${adaptativo(o, 'campo')}<div class="rot">Campo · camada 108 dp<br>tracejado = zona segura</div></div>
        <div>${adaptativo(o, 'gestao')}<div class="rot">Gestão · camada 108 dp</div></div></div>
      <div class="lin" style="gap:14px;margin-top:20px;align-items:flex-end">
        ${icone(o, 'campo', 64)}${icone(o, 'campo', 64, 'arredondado')}${icone(o, 'campo', 64, 'gota')}${tematico(o)}
        ${icone(o, 'gestao', 48)}${icone(o, 'campo', 32)}${icone(o, 'campo', 24)}${icone(o, 'gestao', 24)}</div>
      <div style="font-size:12px;color:#4A5562;margin-top:10px;line-height:1.4">Máscaras círculo, arredondada e gota · ícone temático (Android 13+) · 48, 32 e 24 px. Campo e Gestão: o mesmo símbolo com os fundos trocados, para ninguém confundir os dois apps.</div>
    </div>
  </div>

  <div class="grade" style="grid-template-columns:1fr 1.25fr;margin-top:20px">
    <div class="caixa"><h2>3. Paleta</h2>
      ${o.paleta.map(([n, h, p]) => `<div class="lin" style="margin-bottom:9px"><div style="width:58px;height:40px;border-radius:9px;background:${h};border:1px solid #E1E4DE;flex:none"></div><div><b style="font-size:14px">${n}</b> <span style="font:500 12px 'IBM Plex Mono';color:#4A5562">${h}</span><div style="font-size:12px;color:#4A5562">${p}</div></div></div>`).join('')}
      <h2 style="margin-top:20px">Tipografia</h2>
      <div style="font:800 34px Archivo">Pedido 000014 · R$ 1.240</div>
      <div style="font:400 16px 'IBM Plex Sans';margin-top:6px">Passe cedo no Mercadinho São Jorge. Título vencido.</div>
      <div style="font-size:12px;color:#4A5562;margin-top:8px">${o.tipografia}</div></div>
    <div class="caixa"><h2>4. Contraste conferido (WCAG AA)</h2>${tabelaContraste(o)}
      <div class="grade" style="grid-template-columns:repeat(3,1fr);margin-top:18px;font-size:13px;line-height:1.45">
        <div><b>Custo da troca</b><br>${o.custo}</div><div><b>Ganho</b><br>${o.ganho}</div><div><b>Risco</b><br>${o.risco}</div></div></div>
  </div>

  <div class="caixa" style="margin-top:20px"><h2>5. Aplicação simulada · ícone na tela do celular, Início do Campo, login, cabeçalho do PDF de pedido e assinatura de e-mail</h2>
    <div class="lin" style="align-items:flex-start;gap:22px">
      ${telaInicial(o)}${telaInicio(o)}${telaLogin(o)}
      <div style="flex:1;display:flex;flex-direction:column;gap:12px">${pdf(o, true)}${pdf(o, false)}${email(o)}</div>
    </div>
    <div style="font-size:12px;color:#4A5562;margin-top:12px">O Início não ganha logo: a marca aparece na cor do destaque, na aba ativa e na barra da meta. O logo fica no ícone, no splash, no login, no portal e nos e-mails. O cabeçalho verde da tabela do PDF é o aprovado na T-0159 e não muda nesta proposta. Empresas e pessoas são fictícias.</div>
  </div></body></html>`;
}

function comparativa() {
  const col = (o) => `<div class="caixa" style="${o.id === 'a' ? 'box-shadow:0 0 0 3px #16202A' : ''}">
    <div style="font:600 12px 'IBM Plex Sans';letter-spacing:.08em;color:#4A5562">OPÇÃO ${o.id.toUpperCase()}${o.id === 'a' ? ' · RECOMENDADA' : ''}</div>
    <div style="font:800 28px Archivo;margin:4px 0 14px">${o.nome}</div>
    <div style="height:130px;border-radius:12px;border:1px solid #E1E4DE;display:flex;align-items:center;justify-content:center">${logoClaro(o, 56)}</div>
    <div class="lin" style="margin-top:14px;gap:12px">${icone(o, 'campo', 64)}${icone(o, 'gestao', 64)}${icone(o, 'campo', 24)}${icone(o, 'gestao', 24)}
      <div style="display:flex;gap:4px;margin-left:auto">${o.paleta.slice(0, 5).map(([, h]) => `<div style="width:26px;height:44px;border-radius:6px;background:${h};border:1px solid #E1E4DE"></div>`).join('')}</div></div>
    <div style="display:flex;justify-content:center;margin-top:16px"><div style="width:246px;height:508px"><div style="transform:scale(.82);transform-origin:top left">${telaLogin(o)}</div></div></div>
    <div style="font-size:13.5px;line-height:1.5;margin-top:8px"><b>${o.tese}</b><br><br><b>Custo:</b> ${o.custo}<br><b>Ganho:</b> ${o.ganho}<br><b>Risco:</b> ${o.risco}</div></div>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Comparativa</title><style>${css}</style></head><body>
    <div style="font:600 14px 'IBM Plex Sans';color:#4A5562;letter-spacing:.08em">MARCA MACUXI FDV · PROPOSTA V1 · 12/11/2026 · COMPARATIVA</div>
    <h1 style="margin-top:6px">Três caminhos para a marca</h1>
    <div class="sub">Hoje o app não tem logo: o ícone na tela do celular, e no PDF quando a distribuidora não cadastrou o dela, é o ícone provisório do kit de desenvolvimento. As três opções resolvem isso. A diferença é o quanto mexem nas cores que o vendedor já usa.</div>
    <div class="grade" style="grid-template-columns:repeat(3,1fr);margin-top:24px">${OPCOES.map(col).join('')}</div>
    <div class="caixa" style="margin-top:20px;font-size:15px;line-height:1.55"><b>Recomendação: opção A · Rota.</b> Mantém o laranja e o grafite que já estão em todas as telas, no BKO e no PDF, com o contraste já testado. A marca ganha o que falta, um símbolo próprio no ícone, no login e no PDF, sem refazer telas. Marca se constrói repetindo os mesmos sinais: trocar a cor agora apaga o que o vendedor já reconhece.</div></body></html>`;
}

// ---------- gravar e fotografar ----------
const relatorio = {};
for (const o of OPCOES) {
  relatorio[o.id] = o.pares.map(([uso, fg, bg, tipo]) => ({ uso, fg, bg, tipo, razao: Number(contraste(fg, bg).toFixed(2)), passa: contraste(fg, bg) >= MIN[tipo] }));
}
writeFileSync(join(AQUI, 'contraste.json'), `${JSON.stringify(relatorio, null, 2)}\n`);
OPCOES.forEach((o, i) => writeFileSync(join(AQUI, `opcao-${o.id}.html`), prancha(o, i + 1)));
writeFileSync(join(AQUI, 'comparativa.html'), comparativa());

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
for (const nome of ['opcao-a', 'opcao-b', 'opcao-c', 'comparativa']) {
  await pagina.goto(`file://${join(AQUI, `${nome}.html`)}`);
  await pagina.evaluate(() => document.fonts.ready);
  await pagina.screenshot({ path: join(AQUI, `${nome}.png`), fullPage: true });
  console.log(`${nome}.png`);
}
await navegador.close();
