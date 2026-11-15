// Simulação do menu Parâmetros do BKO (pedido do Alexandre, 15/11/2026). Gera os HTMLs e os PNGs desta pasta.
// Uso, a partir da raiz do repositório: node docs/design/menu-parametros/gerar.mjs
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const AQUI = dirname(fileURLToPath(import.meta.url));
const FONTES = '../../../apps/web/app/fonts';
const LOGO = '../../marca/ativos/2026-11-12-v1/macuxi-logo-negativo-grafite.svg';

// Menu depois da mudança (perfil Administrador). Grupos e itens em ordem alfabética (ADR 0050).
// Pesquisa, Trade e Treinamento são grupos próprios (R-20261115-113500); "Conteúdo de campo" fica vazio e some.
const MENU = [
  ['Acesso', ['Aparelhos', 'Usuários']],
  ['Análise', ['Indicadores', 'Metas', 'Painel da equipe', 'Ranking']],
  ['Cadastros', ['Carteira', 'Clientes', 'Coordenadas sugeridas', 'Filiais']],
  ['Comercial', ['Transportadoras']],
  ['Comunicação', ['Alertas', 'Recados']],
  ['Operação', ['Aprovações', 'Pedidos', 'Rotas', 'Visitas']],
  ['Parâmetros', ['Acesso', 'Alertas', 'Calendário', 'Clientes', 'Início', 'Metas e RV', 'Pedidos', 'Pesquisa', 'Produtos', 'Trade', 'Treinamento', 'Visitas']],
  ['Pesquisa', ['Pesquisas']],
  ['Produtos', ['Catálogo', 'Marcas concorrentes', 'Preço e custo', 'Tabelas de preço']],
  ['Sistema', ['Auditoria', 'Carga por arquivo', 'Integração ERP']],
  ['Trade', ['Cadastros', 'Indicadores']],
  ['Treinamento', ['Trilhas']],
];
// Grupos que dependem de licença; na empresa sem a licença, o grupo e o submenu de Parâmetros com o mesmo nome ficam com cadeado.
const DICA = 'Contrate o módulo para usar';

const seta = (aberto) =>
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${aberto ? 90 : 0}deg)"><path d="M9 6l6 6-6 6"/></svg>`;
const cadeado = `<svg class="cad" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`;
const pontos = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>`;

// aberto: grupo aberto (sanfona); ativo: item selecionado; sem: grupos sem licença; dica: id do elemento com a dica visível (simula o passar do mouse).
function menu({ aberto = 'Parâmetros', ativo = null, sem = [], dica = null } = {}) {
  const id = (t) => t.normalize('NFD').replace(/[^a-zA-Z]/g, '').toLowerCase();
  const attrBloq = (alvo) => ` aria-disabled="true" aria-describedby="dica" tabindex="0"${dica === alvo ? ' data-dica' : ''}`;
  const grupos = MENU.map(([g, itens]) => {
    if (sem.includes(g)) {
      return `<div class="grupo"><div class="titulo bloq" id="g-${id(g)}"${attrBloq(`g-${id(g)}`)}><span>${g}</span>${cadeado}</div></div>`;
    }
    const abre = g === aberto;
    const lista = abre
      ? itens
          .map((i) =>
            g === 'Parâmetros' && sem.includes(i)
              ? `<a class="item bloq" id="p-${id(i)}"${attrBloq(`p-${id(i)}`)}><span>${i}</span>${cadeado}</a>`
              : `<a class="item${i === ativo ? ' ativo' : ''}"${i === ativo ? ' aria-current="page"' : ''}>${i}</a>`,
          )
          .join('')
      : '';
    return `<div class="grupo"><div class="titulo${abre ? ' aberto' : ''}" aria-expanded="${abre}"><span>${g}</span>${seta(abre)}</div>${lista}</div>`;
  }).join('');
  return `<nav class="menu"><div class="brand"><img src="${LOGO}" height="28" alt="Macuxi Força de Vendas"><span>Distribuidora Exemplo</span></div><div class="lista">${grupos}</div><div class="rodape"><b>Ana Souza</b><span>Administrador</span><div class="sair">↪ Trocar perfil</div></div></nav><div class="dica" id="dica" role="tooltip"${dica ? '' : ' hidden'}>${DICA}</div>`;
}

// Depois das fontes: rola a lista até o item aberto (como o shell faz ao abrir o grupo), esmaece a borda cortada e posiciona a dica.
const SCRIPT = `<script>document.fonts.ready.then(()=>{const l=document.querySelector('.lista');const alvo=document.querySelector('.item.ativo')||[...document.querySelectorAll('.titulo.aberto ~ .item')].pop();if(alvo){const a=alvo.getBoundingClientRect(),b=l.getBoundingClientRect();if(a.bottom>b.bottom)l.scrollTop+=a.bottom-b.bottom+4;}if(l.scrollTop>0)l.classList.add('mais-acima');else if(l.scrollHeight>l.clientHeight)l.classList.add('mais-abaixo');const d=document.getElementById('dica'),t=document.querySelector('[data-dica]');if(t&&!d.hidden){const r=t.getBoundingClientRect();d.style.left=(r.right+10)+'px';d.style.top=(r.top+r.height/2-d.offsetHeight/2)+'px';}document.body.dataset.pronto='1';});</script>`;

const CSS = `
@font-face{font-family:Archivo;font-weight:700;src:url(${FONTES}/Archivo_700Bold.ttf)}
@font-face{font-family:Archivo;font-weight:800;src:url(${FONTES}/Archivo_800ExtraBold.ttf)}
@font-face{font-family:Plex;font-weight:400;src:url(${FONTES}/IBMPlexSans_400Regular.ttf)}
@font-face{font-family:Plex;font-weight:500;src:url(${FONTES}/IBMPlexSans_500Medium.ttf)}
@font-face{font-family:Plex;font-weight:600;src:url(${FONTES}/IBMPlexSans_600SemiBold.ttf)}
*{box-sizing:border-box;margin:0}
body{font-family:Plex;background:#F8F6F1;color:#16202A;width:1440px;height:900px;display:flex;overflow:hidden;position:relative}
.menu{width:240px;height:900px;background:#16202A;color:#fff;display:flex;flex-direction:column;padding:20px 12px 16px;flex-shrink:0}
.brand{display:flex;flex-direction:column;align-items:flex-start;padding:0 8px 16px}
.brand img{display:block;height:28px;width:auto}
.brand span{font-size:12px;line-height:16px;color:#C9CED5;margin-top:18px}
.lista{display:flex;flex-direction:column;gap:2px;flex:1;min-height:0;overflow:hidden}
.lista.mais-abaixo{-webkit-mask-image:linear-gradient(to top,transparent 0,#000 36px);mask-image:linear-gradient(to top,transparent 0,#000 36px)}
.lista.mais-acima{-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 36px);mask-image:linear-gradient(to bottom,transparent 0,#000 36px)}
.titulo{display:flex;justify-content:space-between;align-items:center;height:30px;padding:0 10px;border-radius:8px;color:#F59A52;font-size:11.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase}
.item{display:flex;align-items:center;height:32px;padding:0 10px 0 20px;border-radius:8px;font-size:14px;color:#C9CED5;white-space:nowrap;position:relative}
.item.ativo{background:#2B3743;color:#fff;font-weight:600}
.titulo.bloq{color:#8B96A3;cursor:not-allowed}
.item.bloq{color:#8B96A3;justify-content:space-between;cursor:not-allowed}
.cad{flex-shrink:0}
.dica{position:absolute;z-index:10;background:#fff;color:#16202A;font-size:13px;font-weight:600;line-height:18px;padding:7px 12px;border-radius:8px;box-shadow:0 6px 16px rgba(22,32,42,.22);white-space:nowrap}
.dica:before{content:'';position:absolute;left:-5px;top:50%;width:10px;height:10px;background:#fff;transform:translateY(-50%) rotate(45deg)}
.item.ativo:before{content:'';position:absolute;left:8px;top:8px;bottom:8px;width:3px;border-radius:2px;background:#F59A52}
.rodape{margin-top:12px;border-top:1px solid #2B3743;padding:12px 8px 0;display:flex;flex-direction:column}
.rodape b{font-size:14px}.rodape span{font-size:12px;color:#C9CED5}.sair{font-size:13px;font-weight:600;color:#C9CED5;margin-top:8px}
main{flex:1;min-width:0;padding:28px 32px;display:flex;flex-direction:column;gap:20px;max-width:1212px}
.cab{display:flex;flex-direction:column;gap:2px;min-height:42px;justify-content:center}
.eyebrow{font-size:13px;color:#4A5562}
h1{font-family:Archivo;font-weight:800;font-size:24px;line-height:1.2}
.quadro{background:#fff;border:1px solid #DFE2E6;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:14px;min-width:0}
.quadro .topo{display:flex;align-items:center;justify-content:space-between;gap:12px}
h2{font-family:Archivo;font-weight:700;font-size:18px}
.grade{display:grid;grid-template-columns:repeat(2,minmax(0,300px));gap:16px 32px}
.campo{display:flex;flex-direction:column;gap:4px;font-size:14px;font-weight:600}
.campo small{font-size:13px;font-weight:400;color:#4A5562;line-height:1.35}
.input{height:44px;border:1px solid #C9CED5;border-radius:10px;background:#fff;font-size:14px;font-weight:500;display:flex;align-items:center;justify-content:space-between;padding:0 12px;font-variant-numeric:tabular-nums}
.input.editado{border:2px solid #1E3350}
.input i{font-style:normal;font-size:13px;font-weight:400;color:#4A5562}
.acoes{display:flex;justify-content:flex-end;gap:8px}
.btn{height:44px;border-radius:10px;padding:0 18px;font-size:14px;font-weight:600;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.btn.p{background:#1E3350;color:#fff}
.btn.s{border:1px solid #C9CED5;background:#fff;color:#16202A}
.btn.d{background:#8B96A3;color:#fff}
.dims{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
fieldset{border:1px solid #ECEEF1;border-radius:12px;padding:12px 14px 14px;display:flex;flex-direction:column;gap:10px}
legend{font-size:14px;font-weight:600;padding:0 4px}
table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:14px}
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
.dia{width:52px;height:44px;border-radius:10px;border:1px solid #C9CED5;background:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;color:#34404D}
.dia.on{background:#1E3350;border-color:#1E3350;color:#fff}
.hoje{font-size:14px;background:#F8F6F1;border-radius:10px;padding:10px 12px}
.nova{display:flex;gap:8px}
.nova .input{flex:1;color:#4A5562;font-weight:400}
.nota{position:absolute;right:20px;bottom:16px;max-width:620px;font-size:12px;line-height:1.5;color:#34404D;background:#fff;border:1px solid #DFE2E6;border-left:4px solid #1D6B4F;border-radius:8px;padding:8px 12px;box-shadow:0 4px 12px rgba(22,32,42,.08);z-index:9}
.mapa td{height:40px}
.mapa .sai{color:#4A5562;font-size:13px}
`;

const pagina = (titulo, opcoes, corpo, nota) =>
  `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${titulo}</title><style>${CSS}</style><body>${menu(opcoes)}<main>${corpo}</main>${nota ? `<div class="nota">${nota}</div>` : ''}${SCRIPT}</body></html>`;

const cab = (t) => `<div class="cab"><span class="eyebrow">Parâmetros</span><h1>${t}</h1></div>`;
const campo = (rotulo, ajuda, valor, unidade, editado = false) =>
  `<label class="campo">${rotulo}<small>${ajuda}</small><span class="input${editado ? ' editado' : ''}">${valor}<i>${unidade}</i></span></label>`;

// ---------- 01: menu com Parâmetros aberto + mapa dos submenus ----------
const MAPA = [
  ['Acesso', 'Perfis de acesso · Módulos · Promotor vê pedidos', 'Acesso › Perfis de acesso; Usuários e módulos (só URL)'],
  ['Alertas', 'Regras de alerta (detalhe na spec de alertas)', 'Comunicação › Regras de alerta'],
  ['Calendário', 'Feriados · Janela do almoço', 'sem lugar no menu'],
  ['Clientes', 'Farol · Curvas ABC', 'Cadastros › Clientes (painéis)'],
  ['Início', 'Dias úteis e equipe parada · Frases do dia', 'Análise › Metas (painel); sem lugar no menu'],
  ['Metas e RV', 'Plano de RV', 'Comercial › Plano de RV'],
  ['Pedidos', 'Alçadas · Formas de pagamento e prazos', 'Comercial › Alçadas; Comercial › Formas de pagamento e prazos'],
  ['Pesquisa', 'Vigência · Construtor · Fotos', 'sem tela'],
  ['Produtos', 'Desconto máximo padrão · Medidas', 'Produtos › Preço e custo (abas)'],
  ['Trade', 'Validade · Visita e coleta · Gôndola', 'Conteúdo de campo › Trade (gaveta); 2 sem tela'],
  ['Treinamento', 'Quiz e lição · XP · Níveis e ranking', 'sem tela'],
  ['Visitas', 'Motivos de não venda · Fotos do PDV · Etapa pendente', 'Cadastros › Motivos; Cadastros › Fotos do PDV; Análise › Metas (painel)'],
];
const html01 = pagina(
  'Parâmetros — menu',
  {},
  `<div class="cab"><h1>Parâmetros</h1></div>
  <section class="quadro mapa"><h2>Submenus e seções</h2><table><colgroup><col style="width:150px"><col style="width:42%"><col></colgroup>
  <thead><tr><th>Submenu</th><th>Seções da página</th><th>Hoje está em</th></tr></thead><tbody>
  ${MAPA.map(([s, sec, de]) => `<tr><td class="forte">${s}</td><td>${sec}</td><td class="sai">${de}</td></tr>`).join('')}
  </tbody></table></section>`,
  '<b>Simulação.</b> Empresa com os 8 módulos. Grupo Parâmetros aberto (sanfona). Com 12 grupos e 12 submenus a lista passa 63 px da altura e rola (borda de baixo esmaecida): ver D3. A tabela serve só para a aprovação.',
);

// ---------- 02: Parâmetros › Clientes ----------
const dim = (nome, a, b) =>
  `<fieldset><legend>${nome}</legend>${campo('Curva A a partir de', 'Participação no total do mês.', a, '%')}${campo('Curva B a partir de', 'Abaixo disso, curva C.', b, '%')}</fieldset>`;
const html02 = pagina(
  'Parâmetros — Clientes',
  { ativo: 'Clientes' },
  `${cab('Clientes')}
  <section class="quadro"><h2>Farol</h2><div class="grade">
  ${campo('Cliente verde até', 'Dias sem compra.', '30', 'dias')}
  ${campo('Cliente amarelo até', 'Acima disso, vermelho.', '60', 'dias', true)}
  ${campo('Vendedor verde a partir de', 'Positivação do mês.', '70', '%')}
  ${campo('Vendedor amarelo a partir de', 'Abaixo disso, vermelho.', '50', '%')}
  </div><div class="acoes"><span class="btn s">Desfazer</span><span class="btn p">Salvar farol</span></div></section>
  <section class="quadro"><h2>Curvas ABC</h2><div class="dims">${dim('Faturamento', '20', '5')}${dim('Volume', '20', '5')}${dim('Frequência', '25', '10')}</div>
  <div class="acoes"><span class="btn d">Salvar curvas</span></div></section>`,
  '<b>Simulação.</b> Os painéis "Parâmetros do farol" e "Curvas ABC" saem de dentro de Cadastros › Clientes. Cada seção salva sozinha: o botão principal só fica ativo na seção alterada (aqui, o Farol); nas outras, desabilitado.',
);

// ---------- 03: Parâmetros › Pedidos ----------
const fp = [
  ['Boleto', '', 'ok', 'ERP', 'forte'],
  ['28 dias', '28 dias', 'ok', 'ERP', 'sub'],
  ['28/56 dias', '42 dias', 'ok', 'ERP', 'sub'],
  ['30/60/90 dias', '60 dias', 'ne', 'BKO', 'sub'],
  ['Cartão', '', 'ok', 'BKO', 'forte'],
  ['Dinheiro', '', 'ok', 'BKO', 'forte'],
  ['Pix', '', 'ok', 'ERP', 'forte'],
];
const html03 = pagina(
  'Parâmetros — Pedidos',
  { ativo: 'Pedidos' },
  `${cab('Pedidos')}
  <section class="quadro"><h2>Alçadas</h2><table><colgroup><col style="width:40%"><col></colgroup><thead><tr><th>Desconto do pedido</th><th>Quem aprova</th></tr></thead><tbody>
  <tr><td>Até 5%</td><td>Vendedor (aprovado na hora)</td></tr><tr><td>Até 10%</td><td>Supervisor</td></tr><tr><td>Até 15%</td><td>Gerente</td></tr><tr><td>Acima de 15%</td><td>Analista comercial</td></tr>
  </tbody></table></section>
  <section class="quadro"><div class="topo"><h2>Formas de pagamento e prazos · 7</h2><div style="display:flex;gap:8px"><span class="btn p">Nova forma</span><span class="mais" aria-label="Mais ações">${pontos}</span></div></div>
  <table><colgroup><col><col style="width:140px"><col style="width:120px"><col style="width:90px"><col style="width:52px"></colgroup><thead><tr><th>Forma e prazo</th><th class="n">Prazo médio</th><th>Situação</th><th>Origem</th><th class="ac"></th></tr></thead><tbody>
  ${fp.map(([n, m, s, o, c]) => `<tr class="${c === 'sub' ? 'sub' : ''}"><td class="${c === 'forte' ? 'forte' : ''}">${n}</td><td class="n">${m}</td><td><span class="selo ${s}">${s === 'ok' ? 'Ativo' : 'Inativo'}</span></td><td>${o}</td><td class="ac"><span class="dots">${pontos}</span></td></tr>`).join('')}
  </tbody></table></section>`,
  '<b>Simulação.</b> Alçadas e Formas de pagamento e prazos saem de Comercial. "Decisões recentes" (histórico, não parâmetro) não vem para cá: ver decisão D5 da spec. Único botão principal: Nova forma.',
);

// ---------- 04: Parâmetros › Início ----------
const frases = [
  ['Cada visita é uma chance de fazer o cliente voltar.', 'Padrão', true],
  ['Organize a rota antes de sair: menos volta, mais venda.', 'Padrão', true],
  ['Cliente bem atendido indica outro cliente.', 'Da empresa', true],
  ['Confira a validade na gôndola antes de oferecer.', 'Da empresa', false],
];
const dias = [['Dom', 0], ['Seg', 1], ['Ter', 1], ['Qua', 1], ['Qui', 1], ['Sex', 1], ['Sáb', 0]];
const html04 = pagina(
  'Parâmetros — Início',
  { ativo: 'Início' },
  `${cab('Início')}
  <section class="quadro"><h2>Dias úteis e equipe parada</h2>
  <div class="campo">Dias úteis da semana<small>Base da meta do dia.</small><div class="dias">${dias.map(([d, on]) => `<span class="dia${on ? ' on' : ''}" aria-pressed="${on ? 'true' : 'false'}">${d}</span>`).join('')}</div></div>
  <div class="grade" style="grid-template-columns:minmax(0,380px)">${campo('Minutos para considerar "parado"', 'Sem check-in depois do último checkout. De 15 a 480.', '45', 'min')}</div>
  <div class="acoes"><span class="btn d">Salvar</span></div></section>
  <section class="quadro"><h2>Frases do dia · 4</h2>
  <div class="hoje"><b>Frase de hoje:</b> Cada visita é uma chance de fazer o cliente voltar.</div>
  <div class="nova"><span class="input">Nova frase</span><span class="btn p">Adicionar</span></div>
  <table><colgroup><col style="width:44px"><col><col style="width:130px"><col style="width:130px"><col style="width:52px"></colgroup><thead><tr><th class="n">#</th><th>Frase</th><th>Origem</th><th>Situação</th><th class="ac"></th></tr></thead><tbody>
  ${frases.map(([t, o, a], i) => `<tr><td class="n">${i + 1}</td><td>${t}</td><td>${o}</td><td><span class="selo ${a ? 'ok' : 'ne'}">${a ? 'Ativa' : 'Desativada'}</span></td><td class="ac"><span class="dots">${pontos}</span></td></tr>`).join('')}
  </tbody></table></section>`,
  '<b>Simulação.</b> Dias úteis e minutos de "parado" saem de Análise › Metas; Frases do dia ganham lugar no menu. O prazo da etapa pendente do checkout vai para Parâmetros › Visitas. Subir, descer, editar e remover a frase ficam no "⋯".',
);

// ---------- 05: grupos dos módulos; empresa sem Pesquisa e Treinamento ----------
const SAI = [
  ['Conteúdo de campo › Pesquisas', 'Pesquisa › Pesquisas', 'pesquisa'],
  ['Conteúdo de campo › Trilhas', 'Treinamento › Trilhas', 'treinamento'],
  ['Conteúdo de campo › Trade', 'Trade › Cadastros', 'promotor'],
  ['Análise › Trade marketing', 'Trade › Indicadores', 'promotor'],
  ['Conteúdo de campo › Trade (gaveta "Parâmetros de trade")', 'Parâmetros › Trade', 'promotor'],
  ['sem tela (parâmetros da Pesquisa)', 'Parâmetros › Pesquisa', 'pesquisa'],
  ['sem tela (parâmetros do Treinamento)', 'Parâmetros › Treinamento', 'treinamento'],
  ['Conteúdo de campo (grupo)', 'some: fica sem item', '—'],
];
const ESTADOS = [
  ['Com licença', 'Título em Sol claro, seta; abre e navega.'],
  ['Sem licença', 'Cinza #8B96A3 (5,5:1 no Grafite) e cadeado; não abre nem navega; aria-disabled.'],
  ['Dica', 'No passar do mouse, no foco do teclado e no clique: "Contrate o módulo para usar".'],
  ['Perfil sem o módulo', 'Empresa tem a licença, o perfil não: o grupo some (como hoje).'],
];
const html05 = pagina(
  'Menus dos módulos — licença',
  { aberto: 'Trade', sem: ['Pesquisa', 'Treinamento'], dica: 'g-pesquisa' },
  `<div class="cab"><h1>Menus dos módulos</h1></div>
  <section class="quadro mapa"><h2>Sai de → vai para</h2><table><colgroup><col style="width:46%"><col><col style="width:130px"></colgroup>
  <thead><tr><th>Hoje</th><th>Vai para</th><th>Módulo</th></tr></thead><tbody>
  ${SAI.map(([de, para, m]) => `<tr><td class="sai">${de}</td><td class="forte">${para}</td><td>${m}</td></tr>`).join('')}
  </tbody></table></section>
  <section class="quadro mapa"><h2>Estados do grupo</h2><table><colgroup><col style="width:190px"><col></colgroup><tbody>
  ${ESTADOS.map(([e, d]) => `<tr><td class="forte">${e}</td><td>${d}</td></tr>`).join('')}
  </tbody></table></section>`,
  '<b>Simulação.</b> Empresa sem Pesquisa e Treinamento: os dois grupos aparecem com cadeado (dica visível em Pesquisa, como no passar do mouse). Trade tem licença e está aberto. As tabelas servem só para a aprovação.',
);

// ---------- 06: Parâmetros › Trade; Pesquisa e Treinamento sem licença ----------
const html06 = pagina(
  'Parâmetros — Trade',
  { ativo: 'Trade', sem: ['Pesquisa', 'Treinamento'], dica: 'p-pesquisa' },
  `${cab('Trade')}
  <section class="quadro"><h2>Validade</h2><div class="grade">
  ${campo('Validade crítica até', 'Padrão: 7 dias.', '7', 'dias')}
  ${campo('Validade em atenção até', 'Padrão: 30 dias. Acima disso, ok.', '30', 'dias')}
  </div><div class="acoes"><span class="btn d">Salvar validade</span></div></section>
  <section class="quadro"><h2>Visita e coleta</h2><div class="grade">
  ${campo('Permanência mínima da visita', 'Para contar nos indicadores. Padrão: 10 min.', '10', 'min')}
  ${campo('Variação de preço sem confirmar', 'Sobre a última coleta. Padrão: 50%.', '50', '%')}
  </div><div class="acoes"><span class="btn d">Salvar visita e coleta</span></div></section>
  <section class="quadro"><h2>Gôndola</h2><div class="grade">
  ${campo('Peso do parcial na conformidade', 'De 0 a 1. Padrão: 0.', '0', '')}
  </div><div class="acoes"><span class="btn d">Salvar gôndola</span></div></section>`,
  '<b>Simulação.</b> Empresa sem Pesquisa e Treinamento: os submenus aparecem com cadeado e não abrem (dica visível em Pesquisa). Trade reúne os 5 parâmetros do Promotor: 3 hoje na gaveta, só leitura; 2 sem tela. Salvar depende de rota nova do modulo-promotor.',
);

const TELAS = [
  ['01-menu-parametros-aberto', html01],
  ['02-parametros-clientes', html02],
  ['03-parametros-pedidos', html03],
  ['04-parametros-inicio', html04],
  ['05-menus-modulos-licenca', html05],
  ['06-parametros-modulos-licenca', html06],
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
for (const [nome, html] of TELAS) {
  const arq = join(AQUI, `${nome}.html`);
  writeFileSync(arq, html);
  await page.goto(pathToFileURL(arq).href);
  await page.waitForSelector('body[data-pronto]');
  const lista = await page.evaluate(() => {
    const l = document.querySelector('.lista');
    return { alturaLista: l.scrollHeight, visivel: l.clientHeight, rolagem: Math.round(l.scrollTop) };
  });
  await page.screenshot({ path: join(AQUI, `${nome}.png`) });
  console.log(nome, JSON.stringify(lista));
}
await browser.close();
