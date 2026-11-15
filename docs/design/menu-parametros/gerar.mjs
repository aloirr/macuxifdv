// Simulação do menu Parâmetros do BKO, versão final (decisões R-20261115-121000 e R-20261115-122000). Gera os HTMLs e os PNGs desta pasta.
// Uso, a partir da raiz do repositório: node docs/design/menu-parametros/gerar.mjs
// O gerador falha se um balão ou uma nota de simulação cobrir conteúdo da tela, se o menu rolar em 1366×768 (a página pode rolar)
// ou se o menu, com qualquer grupo aberto (pior caso), passar da lista visível.
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const AQUI = dirname(fileURLToPath(import.meta.url));
const LOGO = '../../marca/ativos/2026-11-12-v1/macuxi-logo-negativo-grafite.svg';

// Menu final (perfil Administrador). Grupos e itens em ordem alfabética (ADR 0050), com duas exceções decididas:
// Parâmetros fica fixo no fim, logo acima de Sistema (D1); entrada com uma página só é item direto, sem sanfona (D9).
// { g, itens }: grupo com sanfona. { i }: item direto de primeiro nível.
const MENU = [
  { g: 'Acesso', itens: ['Aparelhos', 'Usuários'] },
  { g: 'Análise', itens: ['Indicadores', 'Metas', 'Painel da equipe', 'Ranking'] },
  { g: 'Cadastros', itens: ['Carteira', 'Clientes', 'Coordenadas sugeridas', 'Filiais', 'Formas de pagamento e prazos', 'Transportadoras'] },
  { g: 'Comunicação', itens: ['Alertas', 'Recados'] },
  { g: 'Operação', itens: ['Aprovações', 'Pedidos', 'Rotas', 'Visitas'] },
  { i: 'Pesquisa', modulo: true },
  { g: 'Produtos', itens: ['Catálogo', 'Marcas concorrentes', 'Preço e custo', 'Tabelas de preço'] },
  { g: 'Trade', itens: ['Cadastros', 'Indicadores'], modulo: true },
  { i: 'Treinamento', modulo: true },
  { i: 'Parâmetros' },
  { g: 'Sistema', itens: ['Auditoria', 'Carga por arquivo', 'Integração ERP'] },
];
// Seções da página Parâmetros (/parametros/<secao>), em ordem alfabética.
const SECOES = ['Acesso', 'Alertas', 'Calendário', 'Clientes', 'Início', 'Metas e RV', 'Pedidos', 'Pesquisa', 'Produtos', 'Trade', 'Treinamento', 'Visitas'];
// Cenário único de todas as telas: empresa sem a licença de Pesquisa e de Treinamento; com Trade.
const SEM = ['Pesquisa', 'Treinamento'];
const DICA = 'Contrate o módulo para usar';

const seta = (aberto) =>
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${aberto ? 90 : 0}deg)"><path d="M9 6l6 6-6 6"/></svg>`;
const cadeado = (t = 14) =>
  `<svg class="cad" width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`;
const pontos = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>`;
const slug = (t) => t.normalize('NFD').replace(/[^a-zA-Z]/g, '').toLowerCase();

// aberto: grupo aberto; ativo: [entrada de primeiro nível, item] selecionados; dica: entrada com o balão visível (passar do mouse).
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
h1{font-family:system-ui,'Segoe UI',Roboto,-apple-system,sans-serif;font-weight:700;font-size:24px;line-height:1.2;min-height:42px;display:flex;align-items:center}
.corpo{display:flex;gap:24px;min-height:0;flex:1}
.secoes{width:200px;flex-shrink:0;display:flex;flex-direction:column;gap:2px}
.sec{display:flex;align-items:center;justify-content:space-between;height:40px;padding:0 12px 0 16px;border-radius:10px;font-size:15px;color:#34404D;position:relative}
.sec.ativo{background:#fff;color:#16202A;font-weight:600;box-shadow:0 0 0 1px #DFE2E6}
.sec.ativo:before{content:'';position:absolute;left:6px;top:10px;bottom:10px;width:3px;border-radius:2px;background:#1E3350}
.sec.bloq{color:#5B6673}
.conteudo{flex:1;min-width:0;display:flex;flex-direction:column;gap:20px}
.quadro{background:#fff;border:1px solid #DFE2E6;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:14px;min-width:0}
.quadro .topo{display:flex;align-items:center;justify-content:space-between;gap:12px}
h2{font-family:system-ui,'Segoe UI',Roboto,-apple-system,sans-serif;font-weight:700;font-size:17px}
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
.abc{display:grid;grid-template-columns:240px repeat(3,minmax(0,1fr));gap:12px 16px;align-items:center}
.abc .col{font-size:13px;font-weight:600;color:#4A5562}
fieldset{border:1px solid #ECEEF1;border-radius:12px;padding:12px 14px 14px;display:flex;flex-direction:column;gap:10px}
legend{font-size:15px;font-weight:600;padding:0 4px}
table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:15px}
th{text-align:left;font-size:13px;font-weight:600;color:#4A5562;padding:8px 10px;border-bottom:1px solid #DFE2E6;white-space:nowrap}
td{padding:0 10px;height:44px;border-bottom:1px solid #ECEEF1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
tr:last-child td{border-bottom:0}
.n{text-align:right;font-variant-numeric:tabular-nums}
.sub td:first-child{padding-left:28px;color:#34404D}
.forte{font-weight:600}
.selo{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.ok{color:#1D6B4F;background:#E2F1EA}.ne{color:#34404D;background:#ECEEF1}
.ac{width:52px;text-align:center;padding:0}
.dots{display:inline-flex;width:36px;height:36px;align-items:center;justify-content:center;border-radius:10px;color:#4A5562}
.mais{width:44px;height:44px;border:1px solid #C9CED5;border-radius:10px;background:#fff;display:flex;align-items:center;justify-content:center;color:#16202A}
.dias{display:flex;gap:8px}
.dia{width:52px;height:44px;border-radius:10px;border:1px solid #C9CED5;background:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:600;color:#34404D}
.dia.on{background:#1E3350;border-color:#1E3350;color:#fff}
.hj{color:#fff;background:#1E3350;margin-right:8px}
.leitura .valor{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums;padding-top:4px}
.leitura .valor i{font-style:normal;font-size:13px;font-weight:400;color:#4A5562;margin-left:8px}
.nova{display:flex;gap:8px}
.nova .input{flex:1;color:#4A5562;font-weight:400}
.vazio{align-items:center;justify-content:center;text-align:center;padding:56px 16px;gap:10px;color:#34404D}
.vazio b{font-size:15px;color:#16202A}
.nota{font-size:12px;line-height:1.5;color:#34404D;background:#fff;border:1px solid #DFE2E6;border-left:4px solid #C9CED5;border-radius:8px;padding:8px 12px;box-shadow:0 4px 12px rgba(22,32,42,.08);z-index:9}
.secoes .nota{margin-top:auto}
.nota.solta{position:absolute;right:20px;bottom:16px;max-width:620px}
.arvore{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.no{border:1px solid #ECEEF1;border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:4px;font-size:13px;color:#34404D}
.no b{font-size:13px;color:#16202A;display:flex;align-items:center;justify-content:space-between;gap:6px}
.no.mod b{color:#5B6673}
.no em{font-style:normal;font-size:12px;color:#4A5562}
`;

// Página com o menu lateral. nota: texto da simulação; vai na coluna das seções (abaixo da lista) ou solta no canto.
const pagina = (titulo, opcoes, corpo, notaSolta = '') =>
  `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${titulo}</title><style>${CSS}</style><body>${menu(opcoes)}<main>${corpo}</main>${notaSolta ? `<div class="nota solta">${notaSolta}</div>` : ''}${SCRIPT}</body></html>`;

// Página Parâmetros: lista de seções à esquerda (a selecionada em branco, as de módulo sem licença com cadeado) e o conteúdo à direita.
const parametros = (secao, conteudo, nota) =>
  pagina(
    `Parâmetros — ${secao}`,
    { ativo: ['Parâmetros'] },
    `<h1>Parâmetros</h1><div class="corpo"><nav class="secoes" aria-label="Seções de Parâmetros">${SECOES.map((s) =>
      SEM.includes(s)
        ? `<a class="sec bloq${s === secao ? ' ativo" aria-current="page' : ''}"><span>${s}</span>${cadeado()}</a>`
        : `<a class="sec${s === secao ? ' ativo" aria-current="page' : ''}">${s}</a>`,
    ).join('')}<div class="nota">${nota}</div></nav><div class="conteudo">${conteudo}</div></div>`,
  );

const campo = (rotulo, ajuda, valor, unidade, editado = false) =>
  `<label class="campo">${rotulo}<small>${ajuda}</small><span class="input${editado ? ' editado' : ''}">${valor}<i>${unidade}</i></span></label>`;
const linhaMenu = () => `<td class="ac"><span class="dots">${pontos}</span></td>`;

// ---------- 01: menu lateral final ----------
const html01 = pagina(
  'Menu lateral',
  { aberto: 'Trade', ativo: ['Trade', 'Indicadores'], dica: 'Treinamento' },
  `<h1>Menu lateral</h1>
  <section class="quadro" style="margin-left:300px"><h2>Primeiro nível</h2><div class="arvore">${MENU.map((e) => {
    const nome = e.g ?? e.i;
    const bloq = e.modulo && SEM.includes(nome);
    const conteudo = e.g ? e.itens.join('<br>') : `<em>Item direto${nome === 'Parâmetros' ? ': seções na página' : ''}</em>`;
    return `<div class="no${bloq ? ' mod' : ''}"><b>${nome}${bloq ? cadeado(12) : ''}</b><span>${conteudo}</span></div>`;
  }).join('')}</div></section>`,
  '<b>Simulação.</b> Empresa sem Pesquisa e Treinamento: os dois aparecem com cadeado e não abrem; o balão aparece no passar do mouse, no foco e no clique (aqui, em Treinamento). Trade tem licença e está aberto. O quadro serve só para a aprovação.',
);

// ---------- 02: Clientes ----------
// Curvas ABC em grade (RD-P01): linhas Curva A e Curva B (rótulo e ajuda uma vez) × colunas das três dimensões, só com os campos.
const abc = [
  ['Curva A a partir de', 'Participação no total do mês.', ['20', '20', '25']],
  ['Curva B a partir de', 'Abaixo disso, curva C.', ['5', '5', '10']],
];
const caixa = (valor, unidade, rotulo) => `<span class="input" aria-label="${rotulo}">${valor}<i>${unidade}</i></span>`;
const dims = ['Faturamento', 'Volume', 'Frequência'];
const html02 = parametros(
  'Clientes',
  `<section class="quadro"><h2>Farol</h2><div class="grade">
  ${campo('Cliente verde até', 'Dias sem compra.', '30', 'dias')}
  ${campo('Cliente amarelo até', 'Acima disso, vermelho.', '60', 'dias', true)}
  ${campo('Vendedor verde a partir de', 'Positivação do mês.', '70', '%')}
  ${campo('Vendedor amarelo a partir de', 'Abaixo disso, vermelho.', '50', '%')}
  </div><div class="acoes"><span class="btn s">Desfazer</span><span class="btn p">Salvar farol</span></div></section>
  <section class="quadro"><h2>Curvas ABC</h2><div class="abc" role="group" aria-label="Curvas ABC"><span></span>${dims.map((d) => `<span class="col">${d}</span>`).join('')}
  ${abc.map(([rot, ajuda, vals]) => `<div class="campo">${rot}<small>${ajuda}</small></div>${vals.map((v, i) => caixa(v, '%', `${rot}, ${dims[i]}`)).join('')}`).join('')}
  </div><div class="acoes"><span class="btn d">Salvar curvas</span></div></section>`,
  '<b>Simulação.</b> Farol e Curvas ABC saem de Cadastros › Clientes. Só o painel alterado tem Salvar ativo.',
);

// ---------- 03: Pedidos (só Alçadas; Formas de pagamento e prazos foi para Cadastros, R-20261115-122000) ----------
const html03 = parametros(
  'Pedidos',
  `<section class="quadro"><h2>Alçadas</h2><table><colgroup><col style="width:40%"><col></colgroup><thead><tr><th>Desconto do pedido</th><th>Quem aprova</th></tr></thead><tbody>
  <tr><td>Até 5%</td><td>Vendedor (aprovado na hora)</td></tr><tr><td>Até 10%</td><td>Supervisor</td></tr><tr><td>Até 15%</td><td>Gerente</td></tr><tr><td>Acima de 15%</td><td>Analista comercial</td></tr>
  </tbody></table></section>`,
  '<b>Simulação.</b> Alçadas (só os limites) sai do antigo Comercial; as decisões recentes vão para Operação › Pedidos (D5). Só leitura, como hoje (P6).',
);

// ---------- 04: Início ----------
// 32 frases = 30 padrão + 2 da empresa (RN-CORE-41); a tela mostra as primeiras. A frase do dia leva o selo "Hoje" na linha (RD-P02).
const frases = [
  ['Cada visita é uma chance de fazer o cliente voltar.', 'Padrão', true, false],
  ['Organize a rota antes de sair: menos volta, mais venda.', 'Padrão', true, true],
  ['Cliente bem atendido indica outro cliente.', 'Padrão', true, false],
  ['Gôndola cheia vende sozinha.', 'Padrão', false, false],
  ['Ouça o cliente antes de oferecer.', 'Padrão', true, false],
];
const dias = [['Dom', 0], ['Seg', 1], ['Ter', 1], ['Qua', 1], ['Qui', 1], ['Sex', 1], ['Sáb', 0]];
const html04 = parametros(
  'Início',
  `<section class="quadro"><h2>Dias úteis e equipe parada</h2>
  <div class="campo">Dias úteis da semana<small>Base da meta do dia.</small><div class="dias">${dias.map(([d, on]) => `<span class="dia${on ? ' on' : ''}" aria-pressed="${on ? 'true' : 'false'}">${d}</span>`).join('')}</div></div>
  <div class="grade" style="grid-template-columns:minmax(0,380px)">${campo('Minutos para considerar "parado"', 'Sem check-in depois do último checkout. De 15 a 480.', '45', 'min')}</div>
  <div class="acoes"><span class="btn d">Salvar dias úteis</span></div></section>
  <section class="quadro"><h2>Frases do dia · 32</h2>
  <div class="nova"><span class="input">Nova frase</span><span class="btn p">Adicionar frase</span></div>
  <table><colgroup><col style="width:44px"><col><col style="width:120px"><col style="width:120px"><col style="width:52px"></colgroup><thead><tr><th class="n">#</th><th>Frase</th><th>Origem</th><th>Situação</th><th class="ac"></th></tr></thead><tbody>
  ${frases.map(([t, o, a, h], i) => `<tr><td class="n">${i + 1}</td><td>${h ? '<span class="selo hj">Hoje</span>' : ''}${t}</td><td>${o}</td><td><span class="selo ${a ? 'ok' : 'ne'}">${a ? 'Ativa' : 'Desativada'}</span></td>${linhaMenu()}</tr>`).join('')}
  </tbody></table></section>`,
  '<b>Simulação.</b> Dias úteis e "parado" saem de Análise › Metas; Frases do dia ganham tela (30 padrão + 2 da empresa; aparecem as primeiras). Subir, descer, editar e remover ficam no "⋯".',
);

// ---------- 05: Produtos (com Catálogo, D6) ----------
const medidas = [
  ['CX', 'Caixa', true, 412],
  ['FD', 'Fardo', true, 96],
  ['PCT', 'Pacote', true, 158],
  ['UN', 'Unidade', true, 1203],
];
const html05 = parametros(
  'Produtos',
  `<section class="quadro"><h2>Desconto máximo padrão</h2><div class="grade">
  <div class="campo"><small>Vale para o produto sem desconto próprio.</small><span class="input" aria-label="Desconto máximo padrão">10<i>%</i></span></div>
  </div><div class="acoes"><span class="btn d">Salvar desconto</span></div></section>
  <section class="quadro"><div class="topo"><h2>Medidas · 4</h2><span class="btn p">Nova medida</span></div>
  <table><colgroup><col style="width:110px"><col><col style="width:120px"><col style="width:110px"><col style="width:52px"></colgroup><thead><tr><th>Sigla</th><th>Descrição</th><th>Situação</th><th class="n">Produtos</th><th class="ac"></th></tr></thead><tbody>
  ${medidas.map(([s, d, a, n]) => `<tr><td class="forte">${s}</td><td>${d}</td><td><span class="selo ${a ? 'ok' : 'ne'}">${a ? 'Ativa' : 'Inativa'}</span></td><td class="n">${n.toLocaleString('pt-BR')}</td>${linhaMenu()}</tr>`).join('')}
  </tbody></table></section>
  <section class="quadro"><h2>Catálogo</h2><div class="grade">
  ${campo('Limite da aplicação', 'De 100 a 2.000.', '2.000', 'caracteres')}
  </div><div class="acoes"><span class="btn d">Salvar catálogo</span></div></section>`,
  '<b>Simulação.</b> Desconto e Medidas saem das abas de Produtos › Preço e custo. Catálogo é tela nova (D6, RN-CAT-11).',
);

// ---------- 06: Trade (com licença; só leitura até existir a rota de gravação, P4/RD-P07) ----------
// "Padrão: X" só quando o valor difere do padrão (RD-P05): aqui, Em atenção até (45; padrão 30).
const leitura = (rotulo, ajuda, valor, unidade, padrao = '') =>
  `<div class="campo leitura">${rotulo}<small>${ajuda}</small><span class="valor">${valor}${unidade === '%' ? '%' : unidade ? ` ${unidade}` : ''}${padrao ? `<i>Padrão: ${padrao}</i>` : ''}</span></div>`;
const html06 = parametros(
  'Trade',
  `<section class="quadro"><h2>Validade</h2><div class="grade">
  ${leitura('Crítica até', 'Dias para vencer.', '7', 'dias')}
  ${leitura('Em atenção até', 'Acima disso, ok.', '45', 'dias', '30 dias')}
  </div></section>
  <section class="quadro"><h2>Visita e coleta</h2><div class="grade">
  ${leitura('Permanência mínima', 'Para contar nos indicadores.', '10', 'min')}
  ${leitura('Variação de preço sem confirmar', 'Sobre a última coleta.', '50', '%')}
  </div></section>
  <section class="quadro"><h2>Gôndola</h2><div class="grade">
  ${leitura('Peso do parcial na conformidade', 'De 0 a 1.', '0', '')}
  </div></section>`,
  '<b>Simulação.</b> Os 5 parâmetros do Promotor: 3 da gaveta de Trade › Cadastros e 2 sem tela hoje. Só leitura: a rota de gravação é lote futuro.',
);

// ---------- 07: Pesquisa sem licença ----------
const html07 = parametros(
  'Pesquisa',
  `<section class="quadro vazio">${cadeado(28)}<b>${DICA}</b></section>`,
  '<b>Simulação.</b> Seção de módulo sem licença: aparece com cadeado na lista; ao ser escolhida, o lado direito mostra só o aviso, sem balão.',
);

const TELAS = [
  ['01-menu-lateral', html01],
  ['02-parametros-clientes', html02],
  ['03-parametros-pedidos', html03],
  ['04-parametros-inicio', html04],
  ['05-parametros-produtos', html05],
  ['06-parametros-trade', html06],
  ['07-parametros-pesquisa-sem-licenca', html07],
];

// Playwright do repositório; se o navegador dele não estiver instalado, o Playwright global da sessão (sem instalar nada).
async function abrirNavegador() {
  try {
    return await require('playwright').chromium.launch();
  } catch {
    const global = join(execSync('npm root -g').toString().trim(), 'playwright');
    return await require(global).chromium.launch();
  }
}
const browser = await abrirNavegador();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2 });
let falhou = false;
for (const [nome, html] of TELAS) {
  const arq = join(AQUI, `${nome}.html`);
  writeFileSync(arq, html);
  await page.goto(pathToFileURL(arq).href);
  await page.waitForSelector('body[data-pronto]');
  const info = JSON.parse(await page.evaluate(() => document.body.dataset.info));
  // Fundo do último elemento do menu e do conteúdo: nada pode passar da lista visível do menu.
  const altura = await page.evaluate(() => {
    const fundo = (sel) => Math.max(...[...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect().bottom));
    return { menu: Math.round(fundo('.lista > *')), limiteMenu: Math.round(document.querySelector('.lista').getBoundingClientRect().bottom), main: Math.round(fundo('main *')) };
  });
  if (info.conflitos.length || altura.menu > altura.limiteMenu) falhou = true;
  await page.screenshot({ path: join(AQUI, `${nome}.png`), fullPage: true });
  console.log(nome, JSON.stringify({ conflitos: info.conflitos, ...altura }));
}
// Pior caso do menu: cada grupo aberto, um de cada vez (sem gravar arquivo), em 1366×768.
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
