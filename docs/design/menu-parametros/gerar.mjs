// Simulação 2a do menu Parâmetros do BKO (v1.0.18, R-20261120-191213): o menu de hoje (main e6a3a33) ao lado do proposto,
// a página /parametros com uma seção aberta e a seção de módulo sem licença. Gera os HTMLs e os PNGs desta pasta.
// Uso, a partir da raiz do repositório: node docs/design/menu-parametros/gerar.mjs
// Falha se um balão ou uma nota cobrir conteúdo, se o menu rolar em 1366×768 com qualquer grupo aberto ou se um item for cortado.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { abrirNavegador } from '../_comum/navegador.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const LOGO = '../../marca/ativos/2026-11-12-v1/macuxi-logo-negativo-grafite.svg';

// Menu de hoje no main (sem `menuParametros`; perfil Administrador, todos os módulos): grupos e itens como o shell monta
// (`apps/web/lib/menu-bko.ts`, ordem alfabética). `[item, destino]`: destino na proposta, quando muda.
const HOJE = [
  ['Acesso', [['Aparelhos'], ['Usuários']]],
  ['Análise', [['Indicadores'], ['Metas'], ['Painel da equipe'], ['Ranking'], ['Trajeto do dia']]],
  ['Cadastros', [['Carteira'], ['Clientes'], ['Coordenadas sugeridas'], ['Filiais'], ['Formas de pagamento e prazos']]],
  ['Comercial', [['Plano de RV', 'Parâmetros'], ['Transportadoras', 'Cadastros']]],
  ['Comunicação', [['Alertas'], ['Recados'], ['Regras de alerta', 'Parâmetros']]],
  ['Operação', [['Aprovações'], ['Pedidos'], ['Rotas'], ['Visitas']]],
  ['Parâmetros', [['Integração', 'Seção']]],
  ['Pesquisa', [['Pesquisas', 'Item direto']]],
  ['Produtos', [['Catálogo'], ['Fotos em lote'], ['Marcas concorrentes'], ['Preço e custo'], ['Tabelas de preço']]],
  ['Sistema', [['Auditoria'], ['Carga por arquivo'], ['Integração ERP']]],
  ['Trade', [['Cadastros'], ['Indicadores']]],
  ['Treinamento', [['Trilhas', 'Item direto']]],
];

// Menu proposto (ADR 0060: o que o SDK monta com `menuParametros: true`). { g, itens }: grupo; { i }: item direto (D9).
// Parâmetros fixo logo acima de Sistema (D1).
const MENU = [
  { g: 'Acesso', itens: ['Aparelhos', 'Usuários'] },
  { g: 'Análise', itens: ['Indicadores', 'Metas', 'Painel da equipe', 'Ranking', 'Trajeto do dia'] },
  { g: 'Cadastros', itens: ['Carteira', 'Clientes', 'Coordenadas sugeridas', 'Filiais', 'Formas de pagamento e prazos', 'Transportadoras'] },
  { g: 'Comunicação', itens: ['Alertas', 'Recados'] },
  { g: 'Operação', itens: ['Aprovações', 'Pedidos', 'Rotas', 'Visitas'] },
  { i: 'Pesquisa', modulo: true },
  { g: 'Produtos', itens: ['Catálogo', 'Fotos em lote', 'Marcas concorrentes', 'Preço e custo', 'Tabelas de preço'] },
  { g: 'Trade', itens: ['Cadastros', 'Indicadores'], modulo: true },
  { i: 'Treinamento', modulo: true },
  { i: 'Parâmetros' },
  { g: 'Sistema', itens: ['Auditoria', 'Carga por arquivo', 'Integração ERP'] },
];

// Página Parâmetros: seções (ordem alfabética) e painéis (ordem do código). l: só leitura; f: falta o painel (lacuna do 2b).
const SECOES = [
  ['Acesso', [['Perfis de acesso'], ['Módulos'], ['Promotor vê pedidos']]],
  ['Alertas', [['Alertas da equipe'], ['Produtividade do dia']]],
  ['Calendário', [['Feriados'], ['Almoço'], ['Rastreamento no expediente'], ['Ausências']]],
  ['Clientes', [['Farol'], ['Curvas ABC'], ['Quem vê cada tipo de documento'], ['Exceções por documento']]],
  ['Início', [['Dias úteis'], ['Frases do dia']]],
  ['Integração', [['De-para']]],
  ['Metas e RV', [['Plano de RV']]],
  ['Pedidos', [['Alçadas', 'l'], ['Frete padrão', 'f']]],
  ['Pesquisa', [['Vigência', 'l'], ['Construtor', 'l'], ['Fotos', 'l']]],
  ['Produtos', [['Desconto máximo padrão'], ['Medidas'], ['Catálogo', 'f']]],
  ['Trade', [['Validade', 'l'], ['Visita e coleta', 'l'], ['Gôndola', 'l']]],
  ['Treinamento', [['Quiz e lição', 'l'], ['XP', 'l'], ['Níveis e ranking', 'l']]],
  ['Visitas', [['Motivos de não venda'], ['Fotos do PDV'], ['Etapa pendente']]],
];
// Cenário único: empresa sem a licença de Pesquisa e de Treinamento; com Trade. Perfil Administrador.
const SEM = ['Pesquisa', 'Treinamento'];
const DICA = 'Contrate o módulo para usar';

const seta = (aberto) =>
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${aberto ? 90 : 0}deg)"><path d="M9 6l6 6-6 6"/></svg>`;
const cadeado = (t = 14) =>
  `<svg class="cad" width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`;
const pontos = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>`;
const slug = (t) => t.normalize('NFD').replace(/[^a-zA-Z]/g, '').toLowerCase();

// Menu lateral proposto. aberto: grupo aberto; ativo: [entrada de primeiro nível, item]; dica: entrada com o balão visível.
function menu({ aberto = null, ativo = [], dica = null } = {}) {
  const [ativoG, ativoI] = ativo;
  const linhas = MENU.map((e) => {
    const nome = e.g ?? e.i;
    if (e.modulo && SEM.includes(nome)) {
      return `<div class="titulo bloq" id="m-${slug(nome)}" role="link" aria-disabled="true" aria-describedby="dica" tabindex="0"${dica === nome ? ' data-dica' : ''}><span>${nome}</span>${cadeado()}</div>`;
    }
    if (e.i) {
      const sel = ativoG === nome;
      return `<a class="titulo direto${sel ? ' ativo' : ''}"${sel ? ' aria-current="page"' : ''}><span>${nome}</span></a>`;
    }
    const abre = aberto === nome;
    const lista = abre
      ? e.itens.map((i) => `<a class="item${ativoG === nome && ativoI === i ? ' ativo" aria-current="page' : ''}">${i}</a>`).join('')
      : '';
    return `<div class="grupo"><div class="titulo${abre ? ' aberto' : ''}" aria-expanded="${abre}"><span>${nome}</span>${seta(abre)}</div>${lista}</div>`;
  }).join('');
  return `<nav class="menu"><div class="brand"><img src="${LOGO}" height="28" alt="Macuxi Força de Vendas"><span>Distribuidora Exemplo</span></div><div class="lista">${linhas}</div><div class="rodape"><b>Ana Souza</b><span>Administrador</span><div class="sair">↪ Trocar perfil</div></div></nav><div class="dica" id="dica" role="tooltip"${dica ? '' : ' hidden'}>${DICA}</div>`;
}

// Depois das fontes: posiciona o balão e confere que nem o balão nem a nota de simulação cobrem conteúdo.
const SCRIPT = `<script>document.fonts.ready.then(()=>{const d=document.getElementById('dica'),t=document.querySelector('[data-dica]');if(t&&!d.hidden){const r=t.getBoundingClientRect();d.style.left=(r.right+10)+'px';d.style.top=(r.top+r.height/2-d.offsetHeight/2)+'px';}
const sobre=[...document.querySelectorAll('.dica:not([hidden]),.nota')].map(e=>e.getBoundingClientRect());const conflitos=[];
for(const el of document.querySelectorAll('main *')){if(el.closest('.nota'))continue;if(el.children.length&&!el.matches('td,th,.input,.btn,.selo,h1,h2,legend,small,.dia,.sec'))continue;const r=el.getBoundingClientRect();if(!r.width||!r.height)continue;for(const s of sobre){if(r.left<s.right&&r.right>s.left&&r.top<s.bottom&&r.bottom>s.top)conflitos.push(el.tagName+'.'+el.className+': '+el.textContent.trim().slice(0,30));}}
const l=document.querySelector('.lista');document.body.dataset.info=JSON.stringify({conflitos,lista:l.scrollHeight,visivel:l.clientHeight});document.body.dataset.pronto='1';});</script>`;

const CSS = `
*{box-sizing:border-box;margin:0}
body{font-family:system-ui,'Segoe UI',Roboto,-apple-system,sans-serif;background:#F8F6F1;color:#16202A;width:1366px;min-height:768px;display:flex;position:relative}
.menu{width:240px;min-height:768px;background:#16202A;color:#fff;display:flex;flex-direction:column;padding:20px 12px 16px;flex-shrink:0}
.brand{display:flex;flex-direction:column;align-items:flex-start;padding:0 8px 16px}
.brand img{display:block;height:28px;width:auto}
.brand span{font-size:12px;line-height:16px;color:#C9CED5;margin-top:18px}
.lista{display:flex;flex-direction:column;gap:2px;flex:1;min-height:0;overflow:hidden}
.titulo{display:flex;justify-content:space-between;align-items:center;height:30px;padding:0 10px;border-radius:8px;color:#F59A52;font-size:12px;font-weight:600;letter-spacing:.07em;text-transform:uppercase}
.titulo.direto.ativo{background:#2B3743;color:#fff}
.titulo.bloq{color:#8B96A3;cursor:not-allowed}
.item{display:flex;align-items:center;min-height:32px;padding:6px 10px 6px 20px;line-height:20px;border-radius:8px;font-size:15px;color:#C9CED5;position:relative}
.item.ativo{background:#2B3743;color:#fff;font-weight:600}
.item.ativo:before{content:'';position:absolute;left:8px;top:8px;bottom:8px;width:3px;border-radius:2px;background:#F59A52}
.cad{flex-shrink:0}
.dica{position:absolute;z-index:10;background:#fff;color:#16202A;font-size:13px;font-weight:600;line-height:18px;padding:7px 12px;border-radius:8px;box-shadow:0 6px 16px rgba(22,32,42,.22);white-space:nowrap}
.dica:before{content:'';position:absolute;left:-5px;top:50%;width:10px;height:10px;background:#fff;transform:translateY(-50%) rotate(45deg)}
.rodape{margin-top:12px;border-top:1px solid #2B3743;padding:12px 8px 0;display:flex;flex-direction:column}
.rodape b{font-size:15px}.rodape span{font-size:12px;color:#C9CED5}.sair{font-size:13px;font-weight:600;color:#C9CED5;margin-top:8px}
main{flex:1;min-width:0;padding:28px 32px;display:flex;flex-direction:column;gap:20px;max-width:1212px}
h1{font-weight:700;font-size:24px;line-height:1.2;min-height:42px;display:flex;align-items:center}
.corpo{display:flex;gap:24px;min-height:0;flex:1}
.secoes{width:200px;flex-shrink:0;display:flex;flex-direction:column;gap:2px}
.sec{display:flex;align-items:center;justify-content:space-between;height:40px;padding:0 12px 0 16px;border-radius:10px;font-size:15px;color:#34404D;position:relative}
.sec.ativo{background:#fff;color:#16202A;font-weight:600;box-shadow:0 0 0 1px #DFE2E6}
.sec.ativo:before{content:'';position:absolute;left:6px;top:10px;bottom:10px;width:3px;border-radius:2px;background:#1E3350}
.sec.bloq{color:#5B6673}
.conteudo{flex:1;min-width:0;display:flex;flex-direction:column;gap:20px}
.quadro{background:#fff;border:1px solid #DFE2E6;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:14px;min-width:0}
.quadro .topo{display:flex;align-items:center;justify-content:space-between;gap:12px}
h2{font-weight:700;font-size:17px}
.grade{display:grid;grid-template-columns:repeat(2,minmax(0,300px));gap:16px 32px}
.campo{display:flex;flex-direction:column;gap:4px;font-size:15px;font-weight:600}
.campo small{font-size:13px;font-weight:400;color:#4A5562;line-height:1.35}
.input{height:44px;border:1px solid #C9CED5;border-radius:10px;background:#fff;font-size:15px;font-weight:500;display:flex;align-items:center;justify-content:space-between;padding:0 12px;font-variant-numeric:tabular-nums}
.input.editado{border:2px solid #1E3350}
.input i{font-style:normal;font-size:13px;font-weight:400;color:#4A5562}
.acoes{display:flex;justify-content:flex-end;gap:8px}
.btn{height:44px;border-radius:10px;padding:0 18px;font-size:15px;font-weight:600;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.btn.p{background:#1E3350;color:#fff}
.btn.s{border:1px solid #C9CED5;background:#fff;color:#16202A}
.btn.d{background:#8B96A3;color:#fff}
table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:15px}
th{text-align:left;font-size:12px;font-weight:600;color:#4A5562;padding:8px 10px;border-bottom:1px solid #DFE2E6;white-space:nowrap}
td{padding:0 10px;height:44px;border-bottom:1px solid #ECEEF1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
tr:last-child td{border-bottom:0}
.selo{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.ok{color:#1D6B4F;background:#E2F1EA}.ne{color:#34404D;background:#ECEEF1}
.ac{width:52px;text-align:center;padding:0}
.dots{display:inline-flex;width:36px;height:36px;align-items:center;justify-content:center;border-radius:10px;color:#4A5562}
.dias{display:flex;gap:8px}
.dia{width:52px;height:44px;border-radius:10px;border:1px solid #C9CED5;background:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:600;color:#34404D}
.dia.on{background:#1E3350;border-color:#1E3350;color:#fff}
.chave{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:600}
.trilho{width:44px;height:26px;border-radius:999px;background:#1E3350;position:relative}
.trilho:after{content:'';position:absolute;right:3px;top:3px;width:20px;height:20px;border-radius:50%;background:#fff}
.vazio{align-items:center;justify-content:center;text-align:center;padding:56px 16px;gap:10px;color:#34404D}
.vazio b{font-size:15px;color:#16202A}
.nota{font-size:12px;line-height:1.5;color:#34404D;background:#fff;border:1px solid #DFE2E6;border-left:4px solid #C9CED5;border-radius:8px;padding:8px 12px;box-shadow:0 4px 12px rgba(22,32,42,.08);z-index:9}
.secoes .nota{margin-top:auto}
.comp{display:grid;grid-template-columns:250px 250px minmax(0,1fr);gap:20px;align-items:start}
.col{display:flex;flex-direction:column;gap:8px}
.col h2{font-size:15px}
.mini{background:#16202A;border-radius:12px;padding:10px 8px;display:flex;flex-direction:column;gap:2px}
.mini .titulo{height:26px}
.mini .item{min-height:26px;padding:3px 8px 3px 16px;font-size:13px;line-height:18px;justify-content:space-between;gap:6px}
.mini .item b{font-size:12px;font-weight:600;color:#C9CED5;white-space:nowrap}
.mini .titulo b{font-size:12px;font-weight:600;letter-spacing:0;text-transform:none;color:#C9CED5}
.arv{background:#fff;border:1px solid #DFE2E6;border-radius:12px;padding:12px 14px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px}
.no{display:flex;flex-direction:column;gap:2px;font-size:13px;color:#34404D}
.no > b{font-size:13px;color:#16202A;display:flex;align-items:center;gap:6px}
.no > b .tag{margin-left:auto}
.no.mod > b{color:#5B6673}
.no span{display:flex;justify-content:space-between;gap:8px}
.tag{font-style:normal;font-size:12px;font-weight:600;border-radius:999px;padding:0 6px;line-height:18px;white-space:nowrap}
.tag.l{color:#34404D;background:#ECEEF1}.tag.f{color:#7A4F00;background:#FFF1D6}
`;

const pagina = (titulo, opcoes, corpo) =>
  `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${titulo}</title><style>${CSS}</style><body>${menu(opcoes)}<main>${corpo}</main>${SCRIPT}</body></html>`;

// Página Parâmetros: lista de seções à esquerda (a selecionada em branco; as de módulo sem licença com cadeado) e o conteúdo à direita.
const parametros = (secao, conteudo, nota) =>
  pagina(
    `Parâmetros — ${secao}`,
    { ativo: ['Parâmetros'] },
    `<h1>Parâmetros</h1><div class="corpo"><nav class="secoes" aria-label="Seções de Parâmetros">${SECOES.map(([s]) =>
      SEM.includes(s)
        ? `<a class="sec bloq${s === secao ? ' ativo" aria-current="page' : ''}"><span>${s}</span>${cadeado()}</a>`
        : `<a class="sec${s === secao ? ' ativo" aria-current="page' : ''}">${s}</a>`,
    ).join('')}<div class="nota">${nota}</div></nav><div class="conteudo">${conteudo}</div></div>`,
  );

const campo = (rotulo, valor, unidade, editado = false) =>
  `<label class="campo">${rotulo}<span class="input${editado ? ' editado' : ''}">${valor}<i>${unidade}</i></span></label>`;
const linhaMenu = `<td class="ac"><span class="dots">${pontos}</span></td>`;

// ---------- 01: menu de hoje × proposto, e a árvore da página Parâmetros ----------
const colHoje = HOJE.map(
  ([g, itens]) => `<div class="titulo"><span>${g}</span></div>${itens.map(([i, para]) => `<div class="item"><span>${i}</span>${para ? `<b>→ ${para}</b>` : ''}</div>`).join('')}`,
).join('');
const colProposto = MENU.map((e) => {
  const nome = e.g ?? e.i;
  const bloq = e.modulo && SEM.includes(nome);
  if (e.i) return `<div class="titulo${bloq ? ' bloq' : ''}"><span>${nome}</span>${bloq ? cadeado(12) : '<b>item direto</b>'}</div>`;
  return `<div class="titulo"><span>${nome}</span></div>${e.itens.map((i) => `<div class="item"><span>${i}</span></div>`).join('')}`;
}).join('');
const TAG = { l: '<i class="tag l">leitura</i>', f: '<i class="tag f">falta</i>' };
// Selo "leitura" no título quando todos os painéis da seção são só leitura; por painel, só quando a seção mistura.
const arvore = SECOES.map(([s, paineis]) => {
  const todaLeitura = paineis.every(([, t]) => t === 'l');
  return `<div class="no${SEM.includes(s) ? ' mod' : ''}"><b>${s}${SEM.includes(s) ? cadeado(12) : ''}${todaLeitura ? TAG.l : ''}</b>${paineis.map(([p, t]) => `<span>${p}${t && !todaLeitura ? TAG[t] : ''}</span>`).join('')}</div>`;
}).join('');
const html01 = pagina(
  'Menu de hoje e proposto',
  { ativo: ['Parâmetros'] },
  `<h1>Menu do BKO: hoje e proposto</h1>
  <div class="comp">
  <section class="col"><h2>Hoje (main)</h2><div class="mini">${colHoje}</div></section>
  <section class="col"><h2>Proposto</h2><div class="mini">${colProposto}</div></section>
  <section class="col"><h2>Página Parâmetros · 13 seções · 34 painéis</h2><div class="arv">${arvore}</div>
  <div class="nota"><b>Simulação.</b> À esquerda, o menu proposto com Parâmetros selecionado; empresa sem Pesquisa e Treinamento (cadeado). "falta": painel ainda não existe. Hoje, 28 dos 32 painéis que já existem não abrem (sem a rota /parametros).</div></section>
  </div>`,
);

// ---------- 02: Parâmetros › Calendário (seção que mais cresceu desde 15/11) ----------
const feriados = [
  ['01/01/2026', 'Confraternização Universal', 'Nacional'],
  ['17/02/2026', 'Carnaval', 'Nacional'],
  ['05/09/2026', 'Elevação do Amazonas a província', 'Empresa'],
  ['24/10/2026', 'Aniversário de Manaus', 'Empresa'],
];
const dias = [['Dom', 0], ['Seg', 1], ['Ter', 1], ['Qua', 1], ['Qui', 1], ['Sex', 1], ['Sáb', 1]];
const html02 = parametros(
  'Calendário',
  `<section class="quadro"><div class="topo"><h2>Feriados · 2026</h2><span class="btn s">Novo feriado</span></div>
  <table><colgroup><col style="width:130px"><col><col style="width:120px"><col style="width:52px"></colgroup><thead><tr><th>Data</th><th>Feriado</th><th>Origem</th><th class="ac"></th></tr></thead><tbody>
  ${feriados.map(([d, n, o]) => `<tr><td>${d}</td><td>${n}</td><td><span class="selo ne">${o}</span></td>${o === 'Nacional' ? '<td></td>' : linhaMenu}</tr>`).join('')}
  </tbody></table></section>
  <section class="quadro"><h2>Almoço</h2><div class="grade">${campo('Início', '12:00', '')}${campo('Fim', '13:00', '')}</div>
  <div class="acoes"><span class="btn d">Salvar almoço</span></div></section>
  <section class="quadro"><div class="topo"><h2>Rastreamento no expediente</h2><span class="chave"><span class="trilho" role="switch" aria-checked="true"></span>Ligado</span></div>
  <div class="campo" role="group" aria-label="Expediente">Expediente<div class="dias">${dias.map(([d, on]) => `<span class="dia${on ? ' on' : ''}" aria-pressed="${on ? 'true' : 'false'}">${d}</span>`).join('')}</div></div>
  <div class="grade">${campo('A cada', '200', 'm', true)}${campo('No mínimo a cada', '5', 'min')}</div>
  <div class="acoes"><span class="btn s">Desfazer</span><span class="btn p">Salvar rastreamento</span></div></section>
  <section class="quadro"><div class="topo"><h2>Ausências</h2><span class="btn s">Nova ausência</span></div>
  <table><colgroup><col><col style="width:130px"><col style="width:130px"><col style="width:52px"></colgroup><thead><tr><th>Usuário</th><th>De</th><th>Até</th><th class="ac"></th></tr></thead><tbody>
  <tr><td>Carlos Lima</td><td>23/11/2026</td><td>27/11/2026</td>${linhaMenu}</tr><tr><td>Rita Alves</td><td>01/12/2026</td><td>05/12/2026</td>${linhaMenu}</tr>
  </tbody></table></section>`,
  '<b>Simulação.</b> Só o painel alterado tem Salvar ativo.',
);

// ---------- 03: Pesquisa sem licença ----------
const html03 = parametros(
  'Pesquisa',
  `<section class="quadro vazio">${cadeado(28)}<b>${DICA}</b></section>`,
  '<b>Simulação.</b> Seção de módulo sem licença: cadeado na lista; escolhida, mostra só o aviso.',
);

const TELAS = [
  ['01-menu-hoje-e-proposto', html01],
  ['02-parametros-calendario', html02],
  ['03-parametros-pesquisa-sem-licenca', html03],
];

const browser = await abrirNavegador();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2 });
let falhou = false;
for (const [nome, html] of TELAS) {
  const arq = join(AQUI, `${nome}.html`);
  writeFileSync(arq, html);
  await page.goto(pathToFileURL(arq).href);
  await page.waitForSelector('body[data-pronto]');
  const info = JSON.parse(await page.evaluate(() => document.body.dataset.info));
  const altura = await page.evaluate(() => {
    const fundo = (sel) => Math.max(...[...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect().bottom));
    return { menu: Math.round(fundo('.lista > *')), limiteMenu: Math.round(document.querySelector('.lista').getBoundingClientRect().bottom) };
  });
  if (info.conflitos.length || altura.menu > altura.limiteMenu) falhou = true;
  await page.screenshot({ path: join(AQUI, `${nome}.png`), fullPage: true });
  console.log(nome, JSON.stringify({ conflitos: info.conflitos, ...altura }));
}
// Pior caso do menu proposto: cada grupo aberto, um de cada vez (sem gravar arquivo), em 1366×768.
const base = `<base href="${pathToFileURL(AQUI + '/').href}">`;
let pior = { grupo: '', menu: 0, limiteMenu: 0 };
for (const e of MENU.filter((x) => x.g && !(x.modulo && SEM.includes(x.g)))) {
  await page.setContent(pagina('Pior caso', { aberto: e.g }, '').replace('<meta charset="utf-8">', `<meta charset="utf-8">${base}`));
  await page.waitForSelector('body[data-pronto]');
  const m = await page.evaluate(() => {
    const topo = document.querySelector('.lista').getBoundingClientRect().top;
    const fundo = Math.max(...[...document.querySelectorAll('.lista > *')].map((x) => x.getBoundingClientRect().bottom));
    const cortados = [...document.querySelectorAll('.lista .item')].filter((x) => x.scrollWidth > x.clientWidth).map((x) => x.textContent);
    return { menu: Math.round(fundo - topo), limiteMenu: Math.round(document.querySelector('.lista').getBoundingClientRect().bottom - topo), cortados };
  });
  if (m.cortados.length) {
    console.error(`Item cortado no menu (${e.g}): ${m.cortados.join(', ')}`);
    falhou = true;
  }
  if (m.menu > pior.menu) pior = { grupo: e.g, menu: m.menu, limiteMenu: m.limiteMenu };
}
console.log('pior caso do menu', JSON.stringify({ ...pior, cabeEm1366x768: pior.menu <= pior.limiteMenu }));
if (pior.menu > pior.limiteMenu) falhou = true;
await browser.close();
if (falhou) {
  console.error('Falha: balão ou nota cobrindo conteúdo, menu rolando (algum grupo aberto) ou item cortado.');
  process.exit(1);
}
