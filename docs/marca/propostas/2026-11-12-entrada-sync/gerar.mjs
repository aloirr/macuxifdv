// Simulação da entrada no app com a sincronização na tela do logo (pedido de 12/11/2026, T-0169, design-de-marca).
// Usa os ativos aprovados (docs/marca/ativos/2026-11-12-v1). Uso, na raiz: node docs/marca/propostas/2026-11-12-entrada-sync/gerar.mjs
// Saída nesta pasta: entrada-sync.html/png. Nomes e números são fictícios.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = process.cwd();
const ATIVOS = join(RAIZ, 'docs/marca/ativos/2026-11-12-v1');
const FONTES = relative(AQUI, join(RAIZ, 'apps/web/app/fonts')).replaceAll('\\', '/');
const svg = (nome, largura) => readFileSync(join(ATIVOS, nome), 'utf8').trim().replace('<svg ', `<svg width="${largura}" `);

const C = {
  noite: '#1E3350', perola: '#F8F6F1', branco: '#FFFFFF', grafite: '#16202A', ink2: '#4A5562', ink3: '#5B6673',
  claro: '#C9CED5', solClaro: '#F59A52', trilho: '#3A4D68', ok: '#7FD1A8', alerta: '#F7A59C', linha: '#E1E4DE',
};

const css = `
@font-face{font-family:Archivo;font-weight:800;src:url(${FONTES}/Archivo_800ExtraBold.ttf)}
@font-face{font-family:'IBM Plex Sans';font-weight:400;src:url(${FONTES}/IBMPlexSans_400Regular.ttf)}
@font-face{font-family:'IBM Plex Sans';font-weight:500;src:url(${FONTES}/IBMPlexSans_500Medium.ttf)}
@font-face{font-family:'IBM Plex Sans';font-weight:600;src:url(${FONTES}/IBMPlexSans_600SemiBold.ttf)}
@font-face{font-family:'IBM Plex Sans';font-weight:700;src:url(${FONTES}/IBMPlexSans_700Bold.ttf)}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'IBM Plex Sans';color:${C.grafite};background:#fff;width:1600px;padding:48px}
h1{font:800 40px/1.1 Archivo}
.sup{font:600 14px 'IBM Plex Sans';color:${C.ink2};letter-spacing:.08em}
.sub{font-size:17px;color:${C.ink2};margin-top:8px;max-width:1280px;line-height:1.45}
.fluxo{display:grid;grid-template-columns:repeat(4,1fr);gap:30px 16px;margin-top:28px}
.passo{display:flex;flex-direction:column;align-items:center}
.n{font:800 15px Archivo;color:${C.noite};margin-top:12px;text-align:center}
.leg{font-size:13px;color:${C.ink2};line-height:1.45;margin-top:4px;max-width:300px;text-align:center}
.tel{width:300px;height:620px;border-radius:34px;border:9px solid #0F1419;overflow:hidden;position:relative;display:flex;flex-direction:column}
.barra{height:26px;display:flex;justify-content:space-between;align-items:center;padding:0 16px;font-size:11px;font-weight:600;flex:none}
.trilho{height:6px;border-radius:3px;background:${C.trilho};overflow:hidden}
.trilho i{display:block;height:100%;border-radius:3px;background:${C.solClaro}}
.etapa{display:flex;align-items:center;gap:10px;font-size:12.5px;padding:6px 0}
.bola{width:18px;height:18px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700}
.caixa{border:1px solid #E3E0D8;border-radius:16px;padding:22px;margin-top:30px}
table{border-collapse:collapse;width:100%;font-size:13.5px}td,th{padding:7px 10px;border-bottom:1px solid #ECEEE9;text-align:left;vertical-align:top}
th{font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:${C.ink2}}
`;

// Tela do logo: fundo Azul noite, logo empilhado sempre no mesmo lugar (não pula quando a barra aparece)
// e a área de sincronização presa embaixo.
function telaLogo(baixo = '', { ola = '' } = {}) {
  return `<div class="tel" style="background:${C.noite};color:#fff"><div class="barra"><span>06:30</span><span>4G ▮▮▮ 90%</span></div>
    <div style="position:absolute;top:118px;left:0;right:0;display:flex;flex-direction:column;align-items:center">${svg('macuxi-logo-empilhado-negativo.svg', 170)}
    ${ola ? `<div style="font-size:14px;color:${C.claro};margin-top:20px">${ola}</div>` : ''}</div>
    <div style="position:absolute;left:26px;right:26px;bottom:30px">${baixo || `<div style="text-align:center;font-size:11px;color:${C.claro}">Macuxi Campo</div>`}</div></div>`;
}
const progresso = (rotulo, pct) => `<div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:8px"><span>${rotulo}</span><b>${pct}%</b></div><div class="trilho"><i style="width:${pct}%"></i></div>`;
const ETAPAS = ['Envio do que ficou no aparelho', 'Clientes e rota', 'Catálogo e preços', 'Pedidos e metas', 'Fotos e materiais'];
function etapas(feitas, atual) {
  return `<div style="margin-top:14px">${ETAPAS.map((e, i) => {
    const st = i < feitas ? 'ok' : i === atual ? 'agora' : 'falta';
    const bola = st === 'ok' ? `<span class="bola" style="background:${C.ok};color:${C.noite}">✓</span>` : st === 'agora' ? `<span class="bola" style="border:2px solid ${C.solClaro}"><span style="width:7px;height:7px;border-radius:50%;background:${C.solClaro}"></span></span>` : `<span class="bola" style="border:2px solid ${C.trilho}"></span>`;
    return `<div class="etapa" style="color:${st === 'falta' ? C.claro : '#fff'};${st === 'agora' ? 'font-weight:600' : ''}">${bola}${e}</div>`;
  }).join('')}</div>`;
}
const botao = (t, tipo) => tipo === 'principal'
  ? `<div style="height:48px;border-radius:14px;background:#fff;color:${C.noite};font-weight:700;font-size:14.5px;display:flex;align-items:center;justify-content:center;margin-top:12px">${t}</div>`
  : `<div style="height:44px;border-radius:12px;border:1.5px solid ${C.claro};color:#fff;font-weight:600;font-size:13.5px;display:flex;align-items:center;justify-content:center;margin-top:10px">${t}</div>`;

function login() {
  const campo = (r, v) => `<div style="font-size:11px;font-weight:600;margin:11px 0 5px">${r}</div><div style="height:40px;border:1px solid #C9CEC6;border-radius:12px;background:#fff;padding:0 12px;display:flex;align-items:center;font-size:12.5px">${v}</div>`;
  return `<div class="tel" style="background:linear-gradient(${C.noite} 0 150px, ${C.perola} 150px)"><div class="barra" style="color:#fff"><span>06:30</span><span>4G ▮▮▮ 90%</span></div>
    <div style="padding:42px 26px 0;display:flex;justify-content:center">${svg('macuxi-logo-negativo-azul-noite.svg', 220)}</div>
    <div style="padding:52px 20px 0"><div style="font:800 22px Archivo">Entrar</div>${campo('Código da empresa', 'DISTEX')}${campo('E-mail', 'lucas@exemplo.com.br')}${campo('Senha', '••••••••')}
      <div style="height:46px;border-radius:14px;background:${C.noite};color:#fff;font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center;margin-top:18px">Entrar</div>
      <div style="text-align:center;font-size:12px;font-weight:600;color:${C.noite};margin-top:12px">Esqueci a senha</div></div>
    <div style="position:absolute;bottom:16px;left:0;right:0;text-align:center;font-size:10.5px;color:${C.ink2}">Macuxi Campo · vendedores e promotores</div></div>`;
}
function inicio() {
  return `<div class="tel" style="background:${C.perola}"><div style="background:${C.noite};color:#fff;padding-bottom:16px"><div class="barra"><span>06:31</span><span>4G ▮▮▮ 90%</span></div>
    <div style="padding:12px 16px 0"><div style="font-size:11.5px;color:${C.claro}">Quinta, 12 de novembro</div><div style="font:800 23px Archivo;margin-top:2px">Bom dia, Lucas</div></div></div>
    <div style="padding:12px 16px;font-size:12px">${['RECADOS', 'META DO MÊS', 'ORÇAMENTOS · A FATURAR'].map((t, i) => `<div style="background:#fff;border:1px solid ${C.linha};border-radius:14px;height:${[70, 110, 80][i]}px;padding:12px;margin-bottom:9px;font-size:10px;letter-spacing:.1em;font-weight:700;color:${C.ink2}">${t}${i === 1 ? `<div style="height:6px;border-radius:3px;background:#ECEEE9;margin-top:42px"><div style="width:31%;height:100%;border-radius:3px;background:#C2540A"></div></div>` : ''}</div>`).join('')}</div>
    <div style="position:absolute;bottom:0;left:0;right:0;height:54px;background:#fff;border-top:1px solid ${C.linha};display:flex;justify-content:space-around;align-items:center;font-size:10px;color:${C.ink3}">${['Início', 'Rota', 'Clientes', 'Pedidos', 'Mais'].map((t, i) => `<div style="text-align:center;${i === 0 ? `color:${C.noite};font-weight:700` : ''}"><div style="width:18px;height:18px;margin:0 auto 3px;border-radius:5px;border:2px solid ${i === 0 ? C.noite : C.ink3}"></div>${t}</div>`).join('')}</div></div>`;
}

const PASSOS = [
  ['1 · Abertura', 'Nada pendente: só o logo, por um instante. Segue para o login (ou direto para o Início, se a sessão ainda vale).', telaLogo()],
  ['2 · Antes do login', 'Só aparece se houver o que fazer sem usuário: atualizar o app e conferir o servidor. A barra mostra a etapa e o percentual.', telaLogo(progresso('Atualizando o app', 45))],
  ['3 · Login', 'O login aprovado: logo na faixa Azul noite e o formulário no Pérola.', login()],
  ['4 · Depois do login', 'Volta para a tela do logo e faz as etapas da carga. Cada etapa vira ✓ quando termina.', telaLogo(`${progresso('Etapa 2 de 5 · Clientes e rota', 38)}${etapas(1, 1)}`, { ola: 'Olá, Lucas' })],
  ['5 · Quase pronto', 'A barra é do total, de 0 a 100%. A etapa atual fica em destaque, com o ponto laranja.', telaLogo(`${progresso('Etapa 4 de 5 · Pedidos e metas', 82)}${etapas(3, 3)}`, { ola: 'Olá, Lucas' })],
  ['6 · Pronto', 'Tudo ✓: o app abre o Início sozinho, sem botão.', telaLogo(`${progresso('Pronto', 100)}${etapas(5, -1)}`, { ola: 'Olá, Lucas' })],
  ['7 · Sem sinal', 'A etapa que parou fica marcada. "Continuar sem sincronizar" só aparece se já houver uma carga anterior no aparelho; na primeira carga, só "Tentar de novo".', telaLogo(`<div style="display:flex;gap:8px;align-items:center;font-size:13px;color:${C.alerta};font-weight:600"><span class="bola" style="background:${C.alerta};color:${C.noite}">!</span>Sem internet na etapa 3 de 5</div>${botao('Tentar de novo', 'principal')}${botao('Continuar sem sincronizar', 'secundario')}<div style="text-align:center;font-size:12px;color:${C.claro};margin-top:12px">Trocar usuário</div>`, { ola: 'Olá, Lucas' })],
  ['8 · Início', 'O app abre no Início com o cabeçalho Azul noite.', inicio()],
];

const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Entrada no app com sincronização</title><style>${css}</style></head><body>
<div class="sup">MARCA MACUXI FDV · V1 APROVADA · 12/11/2026 · ENTRADA NO APP</div>
<h1 style="margin-top:6px">A sincronização na tela do logo</h1>
<div class="sub">A tela de abertura, com o logo, passa a ser também a tela da sincronização: antes do login, se houver algo a fazer, e depois do login, com as etapas da carga. A carga sai da tela própria de hoje e vem para cá. Abaixo, o fluxo do Macuxi Campo; o Gestão é igual, com as etapas dele.</div>
<div class="fluxo">${PASSOS.map(([n, leg, tela]) => `<div class="passo">${tela}<div class="n">${n}</div><div class="leg">${leg}</div></div>`).join('')}</div>
<div class="caixa"><div style="font:800 20px Archivo;margin-bottom:12px">Regras da tela</div><table>
<tr><th>Item</th><th>Regra</th></tr>
<tr><td>Fundo e logo</td><td>Azul noite <b>#1E3350</b>, com o logo empilhado negativo (<code>macuxi-logo-empilhado-negativo.svg</code>) no centro. É a mesma tela da splash, então a passagem da splash para a sincronização não tem corte.</td></tr>
<tr><td>Barra</td><td>Trilho <b>#3A4D68</b> e preenchimento no sol claro <b>#F59A52</b> (5,85:1 no Azul noite; o trilho é só fundo). Em cima: "Etapa n de N · nome da etapa" à esquerda e o percentual do total à direita, em branco.</td></tr>
<tr><td>Etapas (Campo)</td><td>1 Envio do que ficou no aparelho · 2 Clientes e rota · 3 Catálogo e preços · 4 Pedidos e metas · 5 Fotos e materiais. Só aparecem as etapas dos módulos ativos no perfil. No Gestão: equipe, aprovações, metas e alertas.</td></tr>
<tr><td>Antes do login</td><td>Só o que não precisa de usuário: atualizar o app e conferir o servidor. Sem nada a fazer, a barra não aparece.</td></tr>
<tr><td>Textos</td><td>Só o nome da etapa e o percentual; "Olá, Lucas" depois do login. Sem frase explicando o que o app faz por trás.</td></tr>
<tr><td>Erro</td><td>Ícone e texto em <b>#F7A59C</b> (6,58:1 no Azul noite), "Tentar de novo" (botão branco com texto Azul noite) e "Continuar sem sincronizar" (contorno) só com carga anterior. "Trocar usuário" como link.</td></tr>
<tr><td>Pronto</td><td>Tudo ✓ e o app abre o Início sozinho.</td></tr>
</table></div>
</body></html>`;

writeFileSync(join(AQUI, 'entrada-sync.html'), html);
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await pagina.goto(`file://${join(AQUI, 'entrada-sync.html')}`);
await pagina.evaluate(() => document.fonts.ready);
await pagina.screenshot({ path: join(AQUI, 'entrada-sync.png'), fullPage: true });
await navegador.close();
console.log('entrada-sync.png');
