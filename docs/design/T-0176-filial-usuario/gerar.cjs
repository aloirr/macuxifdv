// T-0176 (filial do usuário) e T-0175 (vínculo do vendedor do ERP): simulação do BKO › Usuários em 1366×768.
// Gera um HTML por tela nesta pasta e o PNG (deviceScaleFactor 2). Uso: node docs/design/T-0176-filial-usuario/gerar.cjs
// Visual: o mesmo das simulações da revisão do BKO (docs/design/telas/bko-revisao/), §P1 a §P8.
const fs = require('fs');
const path = require('path');
// Playwright pré-instalado da sessão (os navegadores dele estão em /opt/pw-browsers); sem ele, o do repositório.
function carregarPlaywright() {
  try {
    return require(require.resolve('playwright', { paths: (process.env.NODE_PATH || '').split(':').concat('/opt/node-tools/node_modules') }));
  } catch {
    return require('playwright');
  }
}
const { chromium } = carregarPlaywright();

const DIR = __dirname;
const FONTES = '../../../apps/web/app/fonts';
const LOGO = '../../marca/ativos/2026-11-12-v1/macuxi-logo-negativo-grafite.svg';

const CSS = `
@font-face{font-family:Archivo;font-weight:700;src:url(${FONTES}/Archivo_700Bold.ttf)}
@font-face{font-family:Archivo;font-weight:800;src:url(${FONTES}/Archivo_800ExtraBold.ttf)}
@font-face{font-family:Plex;font-weight:400;src:url(${FONTES}/IBMPlexSans_400Regular.ttf)}
@font-face{font-family:Plex;font-weight:500;src:url(${FONTES}/IBMPlexSans_500Medium.ttf)}
@font-face{font-family:Plex;font-weight:600;src:url(${FONTES}/IBMPlexSans_600SemiBold.ttf)}
@font-face{font-family:Plex;font-weight:700;src:url(${FONTES}/IBMPlexSans_700Bold.ttf)}
@font-face{font-family:Mono;font-weight:500;src:url(${FONTES}/IBMPlexMono_500Medium.ttf)}
*{box-sizing:border-box;margin:0}
body{font-family:Plex;background:#F8F6F1;color:#16202A;width:1366px;height:768px;display:flex;overflow:hidden;position:relative}
.menu{width:240px;height:768px;background:#16202A;color:#fff;display:flex;flex-direction:column;padding:20px 12px 16px;flex-shrink:0}
.brand{display:flex;flex-direction:column;align-items:flex-start;padding:0 8px 16px}
.brand img{display:block;height:28px;width:auto}
.brand span{font-size:12px;line-height:16px;color:#C9CED5;margin-top:18px}
.lista{display:flex;flex-direction:column;gap:2px}
.titulo{display:flex;justify-content:space-between;align-items:center;height:30px;padding:0 10px;border-radius:8px;color:#F59A52;font-size:11.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase}
.item{display:flex;align-items:center;height:32px;padding:0 10px 0 20px;border-radius:8px;font-size:14px;color:#C9CED5;white-space:nowrap;position:relative}
.item.ativo{background:#2B3743;color:#fff;font-weight:600}
.item.ativo:before{content:'';position:absolute;left:8px;top:8px;bottom:8px;width:3px;border-radius:2px;background:#F59A52}
.rodape{margin-top:auto;border-top:1px solid #2B3743;padding:12px 8px 0;display:flex;flex-direction:column}
.rodape b{font-size:14px}.rodape span{font-size:12px;color:#C9CED5}.sair{font-size:13px;font-weight:600;color:#C9CED5;margin-top:8px}
main{flex:1;min-width:0;padding:28px 32px;display:flex;flex-direction:column;gap:16px}
.cab{display:flex;align-items:center;justify-content:space-between;min-height:42px}
h1{font-family:Archivo;font-weight:800;font-size:24px;line-height:1.2}
.mais{width:42px;height:42px;border:1px solid #C9CED5;border-radius:10px;background:#fff;display:flex;align-items:center;justify-content:center;color:#16202A}
.pri{height:42px;padding:0 16px;border-radius:10px;background:#1E3350;color:#fff;font-weight:600;font-size:14px;display:flex;align-items:center}
.sec{height:42px;padding:0 16px;border:1px solid #C9CED5;border-radius:10px;font-weight:600;font-size:14px;display:flex;align-items:center;background:#fff}
.filtros{display:flex;align-items:flex-end;gap:10px}
.f{display:flex;flex-direction:column;gap:3px;font-size:12px;font-weight:600;color:#4A5562}
.campo{height:38px;border:1px solid #C9CED5;border-radius:10px;background:#fff;font-size:14px;font-weight:500;color:#16202A;display:flex;align-items:center;padding:0 10px;justify-content:space-between;gap:8px;white-space:nowrap}
.campo.ligado{border:2px solid #1E3350}
.busca{width:290px;justify-content:flex-start}
.busca.sem{color:#4A5562;font-weight:400}
.btn2{white-space:nowrap;flex:none;height:38px;border:1px solid #C9CED5;border-radius:10px;background:#fff;font-size:13px;font-weight:600;padding:0 12px;display:flex;align-items:center}
.quadro{background:#fff;border:1px solid #DFE2E6;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:12px;min-width:0}
table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:13px}
th{text-align:left;font-weight:600;color:#4A5562;padding:8px 10px;border-bottom:1px solid #DFE2E6;white-space:nowrap}
td{padding:0 10px;height:44px;border-bottom:1px solid #ECEEF1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
tr:last-child td{border-bottom:none}
.nome{font-weight:600}
.mono{font-family:Mono;font-size:12.5px}
.vazio-c{color:#4A5562}
.selo{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.ok{color:#1D6B4F;background:#E2F1EA}.al{color:#7A4F00;background:#FFF1D6}.pe{color:#A8261B;background:#FDE8E6}.ne{color:#34404D;background:#ECEEF1}
.pend{color:#1E3350;background:#DFE2E6}
.ac{width:52px;text-align:center;padding:0}
.dots{display:inline-flex;width:36px;height:36px;align-items:center;justify-content:center;border-radius:10px;color:#4A5562}
.dots.on{background:#F8F6F1;color:#16202A;outline:2px solid #1E3350;outline-offset:-2px}
.menuacoes{position:absolute;background:#fff;border:1px solid #DFE2E6;border-radius:12px;box-shadow:0 10px 24px rgba(22,32,42,.16);padding:4px 0;min-width:230px;z-index:5}
.menuacoes div{height:40px;display:flex;align-items:center;padding:0 14px;font-size:14px;font-weight:500}
.menuacoes .foco{background:#DFE2E6;outline:2px solid #1E3350;outline-offset:-2px}
.menuacoes .perigo{color:#A8261B}
.menuacoes hr{border:none;border-top:1px solid #ECEEF1;margin:4px 0}
.lk{color:#1E3350;font-weight:600;text-decoration:underline;text-underline-offset:2px}
.bsm{height:34px;padding:0 12px;border:1px solid #C9CED5;border-radius:10px;font-size:13px;font-weight:600;display:inline-flex;align-items:center;background:#fff;color:#16202A}
/* gaveta (packages/ui/src/web/overlay.tsx · Drawer com rodape) */
.vela{position:absolute;inset:0;background:rgba(22,32,42,.35);z-index:7}
aside{position:absolute;right:0;top:0;bottom:0;width:560px;background:#F8F6F1;z-index:8;display:flex;flex-direction:column;box-shadow:-8px 0 24px rgba(22,32,42,.18)}
.g-cab{display:flex;justify-content:space-between;align-items:center;padding:18px 20px;background:#fff;border-bottom:1px solid #DFE2E6}
.g-cab h2{font-family:Archivo;font-weight:800;font-size:20px}
.fechar{width:40px;height:40px;border:1px solid #C9CED5;border-radius:10px;display:flex;align-items:center;justify-content:center}
.g-corpo{flex:1;min-height:0;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:16px}
.g-corpo::-webkit-scrollbar{width:8px}.g-corpo::-webkit-scrollbar-thumb{background:#C9CED5;border-radius:4px}
.g-rodape{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;background:#fff;border-top:1px solid #DFE2E6}
.abas{display:flex;gap:4px;border-bottom:1px solid #DFE2E6;flex:none}
.abas div{height:44px;padding:0 16px;display:flex;align-items:center;font-size:14px;font-weight:600;color:#4A5562;border-bottom:2px solid transparent;margin-bottom:-1px}
.abas div.on{color:#1E3350;border-bottom-color:#1E3350}
.cf{display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600;flex:none}
.cf .op{font-weight:400;color:#4A5562}
.ctl{height:42px;border-radius:10px;background:#fff;border:1px solid #C9CED5;display:flex;align-items:center;justify-content:space-between;padding:0 12px;font-size:14px;font-weight:500;gap:8px}
.ctl.ph{color:#4A5562;font-weight:400}
.ctl.erro{border:2px solid #A8261B}
.ctl.foco{border:2px solid #1E3350}
.ctl.so{background:#ECEEF1;border:none;font-family:Mono;font-size:14px}
.err{display:flex;gap:4px;font-size:12px;font-weight:400;color:#A8261B;line-height:16px}
.err svg{margin-top:2px;flex-shrink:0}
.par{display:flex;gap:12px;flex:none}
.par>.cf{flex:1;min-width:0}
.ajuda{font-size:12px;font-weight:400;color:#4A5562}
.perfis{display:flex;flex-direction:column;gap:2px;flex:none}
.perfis ul{list-style:none;padding:0;display:flex;flex-direction:column}
.perfis li{display:flex;align-items:center;gap:12px;min-height:44px;padding:6px 8px;border-radius:10px;font-size:14px}
.cx{width:18px;height:18px;border:1.5px solid #4A5562;border-radius:4px;background:#fff;flex:none;display:flex;align-items:center;justify-content:center}
.cx.on{background:#16202A;border-color:#16202A}
.padrao{border-radius:8px;background:#ECEEF1;padding:2px 8px;font-size:11px;font-weight:700;color:#34404D}
.previa{display:flex;flex-direction:column;gap:4px;border:1px solid #DFE2E6;border-radius:10px;padding:12px;flex:none}
.previa b{font-size:12px;font-weight:600;color:#4A5562}.previa span{font-size:13px}
.nota-s{font-size:12px;color:#4A5562;margin-top:-8px;flex:none}
.lista-sel{position:absolute;background:#fff;border:1px solid #DFE2E6;border-radius:12px;box-shadow:0 10px 24px rgba(22,32,42,.16);padding:4px 0;z-index:9}
.lista-sel div{height:40px;display:flex;align-items:center;justify-content:space-between;padding:0 12px;font-size:14px;font-weight:500}
.lista-sel .on{background:#DFE2E6;font-weight:600}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{height:44px;padding:0 14px;border-radius:999px;border:1px solid #C9CED5;background:#fff;display:inline-flex;align-items:center;gap:6px;font-size:14px;font-weight:500}
.chip.on{background:#DFE2E6;border:2px solid #1E3350;color:#1E3350;font-weight:600;padding:0 13px}
.cartao{background:#fff;border:1px solid #DFE2E6;border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:10px;flex:none}
.cartao .rot{font-size:12px;font-weight:600;color:#4A5562}
.cartao .val{font-size:15px;font-weight:600}
.dl{display:grid;grid-template-columns:140px 1fr;row-gap:8px;font-size:14px}
.dl dt{color:#4A5562}.dl dd{font-weight:600;margin:0}
.opc2{display:flex;flex-direction:column;align-items:flex-start;gap:0;line-height:18px}
.opc2 small{font-size:12px;color:#4A5562;font-weight:400}
.toast{position:absolute;left:50%;bottom:24px;transform:translateX(-50%);background:#16202A;color:#fff;border-radius:12px;padding:12px 16px;font-size:14px;font-weight:500;z-index:10}
`;

const ic = {
  busca: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4A5562" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  baixo: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  cima: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
  dots: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.9"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
  x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  check: (c = '#fff', t = 14) => `<svg width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
  alerta: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
};
const seta = (aberto) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${aberto ? 90 : 0}deg)"><path d="M9 6l6 6-6 6"/></svg>`;

const GRUPOS = [
  ['Acesso', ['Aparelhos', 'Perfis de acesso', 'Usuários']],
  ['Análise', []],
  ['Cadastros', []],
  ['Comercial', []],
  ['Comunicação', ['Alertas', 'Recados', 'Regras de alerta']],
  ['Conteúdo de campo', []],
  ['Operação', []],
  ['Produtos', []],
  ['Sistema', []],
];
function menu(ativo) {
  const grupos = GRUPOS.map(([g, itens]) => {
    const aberto = itens.includes(ativo);
    return `<div class="grupo"><div class="titulo"><span>${g}</span>${seta(aberto)}</div>${aberto ? itens.map((i) => `<a class="item${i === ativo ? ' ativo' : ''}">${i}</a>`).join('') : ''}</div>`;
  }).join('');
  return `<nav class="menu"><div class="brand"><img src="${LOGO}" height="28" alt="Macuxi Força de Vendas"><span>Distribuidora Exemplo</span></div><div class="lista">${grupos}</div><div class="rodape"><b>Ana Exemplo</b><span>Administrador</span><div class="sair">↪ Trocar perfil</div></div></nav>`;
}

// ---------- lista de Usuários ----------
const sel = (rotulo, valor, w, ligado) => `<label class="f">${rotulo}<span class="campo${ligado ? ' ligado' : ''}" style="width:${w}px">${valor}${ic.baixo}</span></label>`;
function filtros({ busca = '', perfil = 'Todos', filial = 'Todas', equipe = 'Todas', situacao = 'Todas', limpar = false } = {}) {
  const b = busca
    ? `<span class="campo busca ligado">${ic.busca}<span>${busca}</span></span>`
    : `<span class="campo busca sem">${ic.busca}<span>Buscar nome, e-mail ou código</span></span>`;
  return `<div class="filtros">${b}${sel('Perfil', perfil, 140, perfil !== 'Todos')}${sel('Filial', filial, 150, filial !== 'Todas')}${sel('Equipe', equipe, 150, equipe !== 'Todas')}${sel('Situação', situacao, 140, situacao !== 'Todas')}${limpar ? '<span class="btn2">Limpar filtros</span>' : ''}</div>`;
}
const L = (nome, perfis, filial, equipe, fdv, codigo, situacao, opts = {}) => ({ nome, perfis, filial, equipe, fdv, codigo, situacao, ...opts });
const vazio = '<span class="vazio-c">—</span>';
function tabela(linhas, { menuEm = -1, menuItens = [] } = {}) {
  const tr = linhas
    .map((l, i) => `<tr><td class="nome">${l.nome}</td><td>${l.perfis}</td><td${l.filialTitle ? ` title="${l.filialTitle}"` : ''}>${l.filial ?? vazio}</td><td>${l.equipe ?? vazio}</td><td class="mono">${l.fdv}</td><td class="mono">${l.codigo ?? vazio}</td><td>${l.situacao}</td><td class="ac"><span class="dots${i === menuEm ? ' on' : ''}" aria-label="Ações de ${l.nome}">${ic.dots}</span></td></tr>`)
    .join('');
  const menuHtml = menuEm >= 0 ? `<div class="menuacoes" style="right:44px;top:${46 + 44 * menuEm + 40}px">${menuItens.join('')}</div>` : '';
  return `<section class="quadro" aria-label="Usuários" style="position:relative"><table><colgroup><col style="width:17%"><col style="width:10%"><col style="width:14%"><col><col style="width:96px"><col style="width:112px"><col style="width:178px"><col style="width:52px"></colgroup><thead><tr><th>Nome</th><th>Perfis</th><th>Filial</th><th>Equipe</th><th>Código FDV</th><th>Código ERP</th><th>Situação</th><th class="ac"></th></tr></thead><tbody>${tr}</tbody></table>${menuHtml}</section>`;
}
const cabUsuarios = (n) => `<div class="cab"><h1>Usuários${n ? ` · ${n}` : ''}</h1><div style="display:flex;gap:8px"><span class="pri">Novo usuário</span><span class="mais" aria-label="Mais ações">${ic.dots}</span></div></div>`;

const ATIVO = '<span class="selo ok">Ativo</span>';
// Nomes e códigos fictícios (sobrenome "Exemplo"): nenhum dado real na simulação.
const BLOQ = '<span class="selo pe">Bloqueado · sem filial</span>';
const LISTA_TODOS = [
  L('Ana Exemplo', 'Admin', null, null, '0001', null, ATIVO),
  L('Bruno Exemplo', 'Vendedor', 'Porto Velho', 'Porto Velho', '0002', 'VEN-000101', '<span class="selo ne">Inativo</span>'),
  L('Carla Exemplo', 'Vendedor', 'Boa Vista', 'Boa Vista Centro', '0003', 'VEN-000102', ATIVO),
  L('Davi Exemplo', 'Vendedor', 'Manaus', 'Manaus Norte', '0004', 'VEN-000103', ATIVO),
  L('Elisa Exemplo', 'Analista', null, null, '0005', null, '<span class="selo pend">Senha a criar</span>'),
  L('Fernanda Exemplo', 'Supervisor', 'Boa Vista, Manaus', 'Boa Vista Centro', '0006', 'SUP-0101', ATIVO),
  L('Gustavo Exemplo', 'Promotor', 'Boa Vista +2', 'Boa Vista Centro', '0007', 'PRO-0101', ATIVO, { filialTitle: 'Boa Vista, Manaus, Santarém' }),
  L('Helena Exemplo', 'Gerente', 'Boa Vista +3', null, '0009', 'GER-0101', ATIVO, { filialTitle: 'Boa Vista, Manaus, Porto Velho, Santarém' }),
  L('Rafael Exemplo', 'Vendedor', null, 'Manaus Norte', '0008', 'VEN-000104', BLOQ),
];
const LISTA_PROVISORIOS = [
  L('Vendedor Exemplo', 'Vendedor', 'Boa Vista', null, '0012', 'VEN-000123', '<span class="selo al">Provisório</span>'),
  L('Vendedora Exemplo', 'Vendedor', 'Boa Vista', null, '0013', 'VEN-000124', '<span class="selo al">Provisório</span>'),
];
const telaLista = (main) => `<main>${main}</main>`;

// ---------- gaveta de usuário ----------
const PERFIS = ['Vendedor', 'Promotor', 'Supervisor', 'Gerente', 'Analista', 'Assistente', 'Admin'];
function perfis(marcados) {
  return `<div class="perfis" id="perfis"><span style="font-size:13px;font-weight:600">Perfis</span><span class="ajuda">Marque um ou mais. Quem acumula funções, como vendedor e promotor, fica com os dois.</span><ul>${PERFIS.map((p) => `<li><span class="cx${marcados.includes(p) ? ' on' : ''}">${marcados.includes(p) ? ic.check() : ''}</span>${p}<span class="padrao">Padrão</span></li>`).join('')}</ul></div>`;
}
const campo = (rotulo, valor, { op = false, erro = '', ph = false, extra = '', classe = '', seletor = false } = {}) =>
  `<label class="cf"><span>${rotulo}${op ? '<span class="op"> (opcional)</span>' : ''}</span><span class="ctl${ph ? ' ph' : ''}${erro ? ' erro' : ''}${classe ? ` ${classe}` : ''}"${erro ? ' aria-invalid="true"' : ''}>${valor}${seletor ? ic.baixo : ''}</span>${erro ? `<span class="err">${ic.alerta}${erro}</span>` : ''}${extra}</label>`;
function gaveta(titulo, corpo, botao = 'Salvar', extra = '') {
  return `<div class="vela"></div><aside role="dialog" aria-label="${titulo}"><div class="g-cab"><h2>${titulo}</h2><span class="fechar" aria-label="Fechar painel">${ic.x}</span></div><div class="g-corpo" id="corpo">${corpo}</div><div class="g-rodape"><span class="sec">Cancelar</span><span class="pri">${botao}</span></div>${extra}</aside>`;
}
const abas = '<div class="abas"><div class="on">Dados</div><div>Parâmetros</div></div>';
const dadosTopo = (nome, email) => `${abas}${campo('Nome', nome)}${campo('E-mail (usado no login)', email)}`;
const previa = (t) => `<div class="previa"><b>Onde esta pessoa entra</b><span>${t}</span></div>`;
const equipe = (nome, superior) => `${campo('Equipe', nome, { seletor: true })}<p class="nota-s">Superior imediato: ${superior} (responsável da equipe).</p>`;
// Código FDV: gerado e só de leitura (aparece em Editar); Código ERP: igual ao do ERP, opcional
const codigos = (fdv, erp, o = {}) => `<div class="par"><div style="flex:0 0 130px">${campo('Código FDV', fdv, { classe: 'so' })}</div>${campo('Código ERP', erp, { op: true, ...o })}</div>`;
const senha = `${campo('Senha inicial', '', {})}<div style="display:flex;gap:8px;flex:none"><span class="bsm">Gerar senha</span></div>`;

// Telas: id, html (sem menu), menu ativo, rolagem da gaveta (seletor do elemento que fica no topo)
const telas = [];

// 1 · Novo usuário, vendedor (Filial aberta, escolha única)
telas.push({
  id: '1-novo-vendedor',
  ativo: 'Usuários',
  rolar: '.previa',
  html:
    telaLista(cabUsuarios(9) + filtros() + tabela(LISTA_TODOS)) +
    gaveta(
      'Novo usuário',
      `${dadosTopo('Rafael Exemplo', 'rafael.exemplo@distexemplo.com.br')}${perfis(['Vendedor'])}${previa('Entra em: Campo.')}${campo('Filial', 'Boa Vista', { seletor: true })}<div class="par">${campo('Código ERP', 'VEN-000104', { op: true })}<div style="flex:1"></div></div>${equipe('Manaus Norte', 'Fernanda Exemplo')}${senha}`,
    ),
});

// 2 · Editar supervisor (várias filiais)
telas.push({
  id: '2-editar-supervisor',
  ativo: 'Usuários',
  rolar: '#perfis',
  html:
    telaLista(cabUsuarios(9) + filtros() + tabela(LISTA_TODOS)) +
    gaveta(
      'Editar usuário',
      `${dadosTopo('Fernanda Exemplo', 'fernanda.exemplo@distexemplo.com.br')}${perfis(['Supervisor'])}${previa('Entra em: Gestão.')}<div class="cf" role="group" aria-label="Filiais"><span>Filiais</span><div class="chips"><span class="chip on">${ic.check('#1E3350', 14)}Boa Vista</span><span class="chip on">${ic.check('#1E3350', 14)}Manaus</span><span class="chip">Porto Velho</span><span class="chip">Santarém</span></div></div>${codigos('0006', 'SUP-0101')}${equipe('Boa Vista Centro', 'Helena Exemplo')}`,
    ),
});

// 3 · Erro: vendedor sem filial
telas.push({
  id: '3-erro-vendedor-sem-filial',
  ativo: 'Usuários',
  rolar: '#perfis',
  html:
    telaLista(cabUsuarios(9) + filtros() + tabela(LISTA_TODOS)) +
    gaveta(
      'Novo usuário',
      `${dadosTopo('Rafael Exemplo', 'rafael.exemplo@distexemplo.com.br')}${perfis(['Vendedor'])}${previa('Entra em: Campo.')}${campo('Filial', 'Escolha', { ph: true, seletor: true, erro: 'Escolha a filial do vendedor.' })}<div class="par">${campo('Código ERP', 'VEN-000104', { op: true })}<div style="flex:1"></div></div>${equipe('Manaus Norte', 'Fernanda Exemplo')}${senha}`,
    ),
});

// 4 · Alertas do BKO: um aviso só para os vendedores sem filial
const linhaAlerta = (tipo, msg, desde, selo, acao) => `<tr><td>${tipo}</td><td class="nome">${msg}</td><td style="text-align:right;font-variant-numeric:tabular-nums">${desde}</td><td>${selo}</td><td style="text-align:right">${acao}</td></tr>`;
telas.push({
  id: '4-alertas-vendedores-sem-filial',
  ativo: 'Alertas',
  html: telaLista(
    `<div class="cab"><h1>Alertas · 4</h1><div style="display:flex;gap:8px"><span class="mais" aria-label="Mais ações">${ic.dots}</span></div></div>` +
      `<div class="filtros">${sel('Situação', 'Abertos', 150, false)}</div>` +
      `<section class="quadro" aria-label="Alertas"><table><colgroup><col style="width:150px"><col><col style="width:120px"><col style="width:110px"><col style="width:170px"></colgroup><thead><tr><th>Tipo</th><th>Mensagem</th><th style="text-align:right">Desde</th><th>Situação</th><th></th></tr></thead><tbody>` +
      linhaAlerta('Cadastro', '3 vendedores sem filial: bloqueados no app', '15/11 07:40', '<span class="selo pe">Aberto</span>', '<span class="bsm">Informar filial</span>') +
      linhaAlerta('Cadastro', '2 vendedores provisórios do ERP', '15/11 06:10', '<span class="selo al">Aberto</span>', '<span class="bsm">Ver provisórios</span>') +
      linhaAlerta('Sem visita', '12 clientes sem visita há 30 dias · Manaus Norte', '14/11 18:00', '<span class="selo al">Aberto</span>', `<span class="dots">${ic.dots}</span>`) +
      linhaAlerta('Aprovação parada', '2 pedidos aguardando há mais de 24 h', '14/11 16:20', '<span class="selo al">Aberto</span>', `<span class="dots">${ic.dots}</span>`) +
      `</tbody></table></section>`,
  ),
});

// 5 · Lista de Usuários com a Filial (chegando pelo alerta: Vendedor + Sem filial)
telas.push({
  id: '5-lista-com-filial',
  ativo: 'Usuários',
  html: telaLista(cabUsuarios(9) + filtros() + tabela(LISTA_TODOS)),
});
telas.push({
  id: '5b-lista-sem-filial-pelo-alerta',
  ativo: 'Usuários',
  html: telaLista(
    cabUsuarios(3) +
      filtros({ perfil: 'Vendedor', filial: 'Sem filial', limpar: true }) +
      tabela([
        L('Igor Exemplo', 'Vendedor', null, 'Boa Vista Centro', '0010', 'VEN-000105', BLOQ),
        L('Júlia Exemplo', 'Vendedor', null, null, '0011', 'VEN-000106', BLOQ),
        L('Rafael Exemplo', 'Vendedor', null, 'Manaus Norte', '0008', 'VEN-000104', BLOQ),
      ]),
  ),
});

// 6a · Provisórios + busca por código + "⋯" com Vincular
telas.push({
  id: '6a-lista-provisorios',
  ativo: 'Usuários',
  html: telaLista(
    cabUsuarios(2) +
      filtros({ situacao: 'Provisórios', limpar: true }) +
      tabela(LISTA_PROVISORIOS, { menuEm: 0, menuItens: ['<div class="foco">Vincular vendedor do ERP</div>', '<div>Editar</div>', '<hr>', '<div class="perigo">Desativar</div>'] }),
  ),
});
telas.push({
  id: '6b-busca-codigo-erp',
  ativo: 'Usuários',
  html: telaLista(cabUsuarios(1) + filtros({ busca: '000123', limpar: true }) + tabela([LISTA_PROVISORIOS[0]])),
});

// 6c · Gaveta Vincular vendedor do ERP
telas.push({
  id: '6c-vincular-vendedor-erp',
  ativo: 'Usuários',
  html:
    telaLista(cabUsuarios(2) + filtros({ situacao: 'Provisórios', limpar: true }) + tabela(LISTA_PROVISORIOS)) +
    gaveta(
      'Vincular vendedor do ERP',
      `<div class="cartao"><span class="rot">Vendedor do ERP</span><span class="val">Vendedor Exemplo</span></div>` +
        campo('Usuário do BKO', '<span class="opc2">Vendedor Exemplo da Silva<small>vendedor.exemplo@distexemplo.com.br</small></span>', { seletor: true, classe: 'alto' }) +
        `<div class="cartao"><span class="rot">Passa para o usuário do BKO</span><dl class="dl"><dt>Código ERP</dt><dd class="mono" style="font-size:14px">VEN-000123</dd><dt>Carteira</dt><dd>48 clientes</dd></dl></div>`,
      'Vincular',
    ),
});

// 6d · Erro 409: código repetido de um provisório (Editar o usuário real)
telas.push({
  id: '6d-erro-codigo-de-provisorio',
  ativo: 'Usuários',
  rolar: '.previa',
  html:
    telaLista(cabUsuarios(9) + filtros() + tabela(LISTA_TODOS)) +
    gaveta(
      'Editar usuário',
      `${dadosTopo('Vendedor Exemplo da Silva', 'vendedor.exemplo@distexemplo.com.br')}${perfis(['Vendedor'])}${previa('Entra em: Campo.')}${campo('Filial', 'Boa Vista', { seletor: true })}${codigos('0014', 'VEN-000123', { erro: 'Este Código ERP já está num usuário provisório.', extra: '<span style="margin-top:2px"><span class="bsm">Vincular vendedor do ERP</span></span>' })}${equipe('Boa Vista Centro', 'Fernanda Exemplo')}`,
    ),
});

// ---------- app Macuxi Campo: vendedor sem filial (bloqueado) ----------
// Visual do kit (packages/ui/src/mobile): o mesmo arranjo da `TelaDeErro` (ícone num círculo, título, o que fazer,
// um principal e um secundário), fundo Pérola, Botao principal 52 (Azul noite) e secundário alto 52 (contorno grafite).
// Aparelho: Pixel 7 do Playwright (devices['Pixel 7']), sem mudar o deviceScaleFactor dele.
const CSS_APP = `
@font-face{font-family:Archivo;font-weight:700;src:url(${FONTES}/Archivo_700Bold.ttf)}
@font-face{font-family:Plex;font-weight:400;src:url(${FONTES}/IBMPlexSans_400Regular.ttf)}
@font-face{font-family:Plex;font-weight:600;src:url(${FONTES}/IBMPlexSans_600SemiBold.ttf)}
*{box-sizing:border-box;margin:0}
html,body{height:100%}
body{font-family:Plex;background:#F8F6F1;color:#16202A;display:flex;flex-direction:column}
.sb{height:28px;display:flex;align-items:center;justify-content:space-between;padding:0 20px;font-size:13px;font-weight:600;color:#16202A}
.sb i{display:inline-block;width:14px;height:10px;border:1.5px solid #16202A;border-radius:2px;margin-left:6px;position:relative}
.sb i:after{content:'';position:absolute;inset:1px;right:4px;background:#16202A}
.conteudo{flex:1;display:flex;flex-direction:column;justify-content:center;padding:48px 20px;gap:24px}
.topo{display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center}
.icone{width:56px;height:56px;border-radius:28px;background:#FFF1D6;display:flex;align-items:center;justify-content:center}
h1{font-family:Archivo;font-weight:700;font-size:20px;line-height:26px}
p{font-size:15px;line-height:22px;color:#4A5562}
.acoes{display:flex;flex-direction:column;gap:8px}
.b{height:52px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:600}
.pri{background:#1E3350;color:#fff}
.sec{background:#fff;border:1.5px solid #16202A;color:#16202A}
.nav{height:24px;display:flex;align-items:center;justify-content:center}
.nav span{width:108px;height:4px;border-radius:2px;background:#16202A;opacity:.85}
`;
const cadeado = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#7A4F00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const telasApp = [
  {
    id: '7-app-vendedor-sem-filial',
    html: `<div class="sb"><span>8:15</span><span>4G<i></i></span></div><main class="conteudo" aria-live="polite"><div class="topo"><div class="icone" aria-hidden="true">${cadeado}</div><h1>Seu cadastro está sem filial</h1><p>Peça ao administrador para informar a sua filial.</p></div><div class="acoes"><span class="b pri">Tentar de novo</span><span class="b sec">Sair</span></div></main><div class="nav"><span></span></div>`,
  },
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2 });
  for (const t of telas) {
    const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>T-0176 · ${t.id}</title><style>${CSS}.ctl.alto{height:52px}</style><body>${menu(t.ativo)}${t.html}</body></html>`;
    const arq = path.join(DIR, `${t.id}.html`);
    fs.writeFileSync(arq, html);
    await page.goto(`file://${arq}`);
    await page.evaluate(() => document.fonts.ready);
    if (t.rolar) {
      await page.evaluate((s) => {
        const c = document.getElementById('corpo');
        const alvo = document.querySelector(s);
        c.scrollTop = alvo.offsetTop - c.offsetTop - 8;
      }, t.rolar);
    }
    if (t.depois) await t.depois(page);
    await page.screenshot({ path: path.join(DIR, `${t.id}.png`) });
    console.log('ok', t.id);
  }
  const { devices } = carregarPlaywright();
  const { defaultBrowserType: _tipo, ...pixel7 } = devices['Pixel 7'];
  const celular = await browser.newPage(pixel7);
  for (const t of telasApp) {
    const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>T-0176 · ${t.id}</title><style>${CSS_APP}</style><body>${t.html}</body></html>`;
    const arq = path.join(DIR, `${t.id}.html`);
    fs.writeFileSync(arq, html);
    await celular.goto(`file://${arq}`);
    await celular.evaluate(() => document.fonts.ready);
    await celular.screenshot({ path: path.join(DIR, `${t.id}.png`) });
    console.log('ok', t.id);
  }
  await browser.close();
})();
