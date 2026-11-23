// Simulações da v1.0.30 (R-20261123-141413 e R-20261123-142306): BKO › Cadastros › Clientes › aba "Pré-cadastros recusados"
// (lista, histórico, editar e reenviar, vazio) e Parâmetros › Clientes › Campos obrigatórios (lista única, RN-CORE-16 + RN-CORE-79).
// Uso, a partir da raiz do repositório: node docs/design/telas/pre-cadastro-v1030/gerar.mjs
// Escreve os .html e .png desta pasta (1366×768, escala 2). Falha se a nota de simulação cobrir conteúdo.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gerarPranchas } from '../../_comum/navegador.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const LOGO = '../../../marca/ativos/2026-11-12-v1/macuxi-logo-negativo-grafite.svg';

const MENU = [
  { g: 'Acesso', itens: ['Aparelhos', 'Usuários'] },
  { g: 'Análise', itens: ['Indicadores', 'Metas', 'Painel da equipe', 'Ranking', 'Trajeto do dia'] },
  { g: 'Cadastros', itens: ['Carteira', 'Clientes', 'Coordenadas sugeridas', 'Filiais', 'Formas de pagamento e prazos', 'Transportadoras'] },
  { g: 'Comunicação', itens: ['Alertas', 'Recados'] },
  { g: 'Operação', itens: ['Aprovações', 'Pedidos', 'Rotas', 'Visitas'] },
  { g: 'Produtos', itens: ['Catálogo', 'Fotos em lote', 'Marcas concorrentes', 'Preço e custo', 'Tabelas de preço'] },
  { i: 'Parâmetros' },
  { g: 'Sistema', itens: ['Auditoria', 'Carga por arquivo', 'Integração ERP'] },
];
const SECOES = ['Acesso', 'Alertas', 'Calendário', 'Clientes', 'Início', 'Integração', 'Metas e RV', 'Pedidos', 'Produtos', 'Visitas'];

const seta = (aberto) =>
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${aberto ? 90 : 0}deg)"><path d="M9 6l6 6-6 6"/></svg>`;
const lupa = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4A5562" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`;
const baixo = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4A5562" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;
const alerta = (cor = 'currentColor', t = 15) =>
  `<svg width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="${cor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg>`;
const xis = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
const visto = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

function menu(ativoG, ativoI) {
  const linhas = MENU.map((e) => {
    if (e.i) return `<a class="titulo direto${ativoG === e.i ? ' ativo" aria-current="page' : ''}"><span>${e.i}</span></a>`;
    const abre = ativoG === e.g;
    const lista = abre ? e.itens.map((i) => `<a class="item${ativoI === i ? ' ativo" aria-current="page' : ''}">${i}</a>`).join('') : '';
    return `<div class="grupo"><div class="titulo" aria-expanded="${abre}"><span>${e.g}</span>${seta(abre)}</div>${lista}</div>`;
  }).join('');
  return `<nav class="menu"><div class="brand"><img src="${LOGO}" height="28" alt="Macuxi Força de Vendas"><span>Distribuidora Exemplo</span></div><div class="lista">${linhas}</div><div class="rodape"><b>Ana Souza</b><span>Administrador</span><div class="sair">↪ Trocar perfil</div></div></nav>`;
}

const SCRIPT = `<script>document.fonts.ready.then(()=>{const sobre=[...document.querySelectorAll('.nota')].map(e=>e.getBoundingClientRect());const conflitos=[];
for(const el of document.querySelectorAll('main *, aside *')){if(el.closest('.nota'))continue;if(el.children.length&&!el.matches('td,th,.selo,h1,h2,.btn,.aba'))continue;const r=el.getBoundingClientRect();if(!r.width||!r.height)continue;for(const s of sobre){if(r.left<s.right&&r.right>s.left&&r.top<s.bottom&&r.bottom>s.top)conflitos.push(el.tagName+'.'+el.className+': '+el.textContent.trim().slice(0,30));}}
document.body.dataset.info=JSON.stringify({conflitos});document.body.dataset.pronto='1';});</script>`;

const CSS = `
*{box-sizing:border-box;margin:0}
body{font-family:system-ui,'Segoe UI',Roboto,-apple-system,sans-serif;background:#F8F6F1;color:#16202A;width:1366px;min-height:768px;display:flex;position:relative;font-variant-numeric:tabular-nums}
.menu{width:240px;min-height:768px;background:#16202A;color:#fff;display:flex;flex-direction:column;padding:20px 12px 16px;flex-shrink:0}
.brand{display:flex;flex-direction:column;align-items:flex-start;padding:0 8px 16px}
.brand img{display:block;height:28px;width:auto}
.brand span{font-size:12px;line-height:16px;color:#C9CED5;margin-top:18px}
.lista{display:flex;flex-direction:column;gap:2px;flex:1}
.titulo{display:flex;justify-content:space-between;align-items:center;height:30px;padding:0 10px;border-radius:8px;color:#F59A52;font-size:12px;font-weight:600;letter-spacing:.07em;text-transform:uppercase}
.titulo.direto.ativo{background:#2B3743;color:#fff}
.item{display:flex;align-items:center;min-height:32px;padding:6px 10px 6px 20px;line-height:20px;border-radius:8px;font-size:15px;color:#C9CED5;position:relative}
.item.ativo{background:#2B3743;color:#fff;font-weight:600}
.item.ativo:before{content:'';position:absolute;left:8px;top:8px;bottom:8px;width:3px;border-radius:2px;background:#F59A52}
.rodape{margin-top:12px;border-top:1px solid #2B3743;padding:12px 8px 0;display:flex;flex-direction:column}
.rodape b{font-size:15px}.rodape span{font-size:12px;color:#C9CED5}.sair{font-size:13px;font-weight:600;color:#C9CED5;margin-top:8px}
main{flex:1;min-width:0;padding:28px 32px;display:flex;flex-direction:column;gap:16px}
h1{font-weight:700;font-size:24px;line-height:1.2;min-height:42px;display:flex;align-items:center}
h2{font-weight:700;font-size:17px}
.abas{display:flex;gap:4px;border-bottom:1px solid #DFE2E6}
.aba{height:44px;display:flex;align-items:center;padding:0 14px;font-size:15px;font-weight:500;color:#34404D;border-bottom:3px solid transparent;margin-bottom:-1px}
.aba.ativa{color:#16202A;font-weight:600;border-bottom-color:#1E3350}
.filtros{display:flex;align-items:flex-end;gap:10px}
.f{display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600;color:#4A5562}
.sel{height:44px;min-width:170px;border:1px solid #7A8593;border-radius:10px;background:#fff;font-size:15px;font-weight:500;color:#16202A;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 12px;white-space:nowrap}
.busca{width:340px;justify-content:flex-start;color:#4A5562;font-weight:400}
.quadro{background:#fff;border:1px solid #DFE2E6;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:14px;min-width:0}
table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:15px}
th{text-align:left;font-size:12px;font-weight:600;color:#4A5562;padding:8px 10px;border-bottom:1px solid #DFE2E6;white-space:nowrap}
td{padding:0 10px;height:48px;border-bottom:1px solid #ECEEF1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
tr:last-child td{border-bottom:0}
tr.sel-linha td{background:#F8F6F1}
.cod{display:flex;flex-direction:column;line-height:16px;font-size:13px}
.cod span{white-space:nowrap}.cod small{font-size:12px;font-weight:500;color:#4A5562;margin-right:4px}
.cod code,.dcab code{font-family:ui-monospace,"Cascadia Mono","Roboto Mono",monospace;font-variant-numeric:tabular-nums;font-size:13px;color:#16202A}
.nome{font-weight:600}
.selo{display:inline-flex;align-items:center;padding:3px 8px;line-height:16px;border-radius:8px;font-size:12px;font-weight:500;white-space:nowrap}
.ok{color:#1D6B4F;background:#E2F1EA}.al{color:#7A4F00;background:#FFF1D6}.pe{color:#A8261B;background:#FDE8E6}.ne{color:#34404D;background:#ECEEF1}
.vazio{border:1px dashed #DFE2E6;border-radius:16px;padding:40px 24px;text-align:center;font-size:15px;font-weight:600;color:#34404D;background:#fff}
.btn{height:44px;border-radius:10px;padding:0 18px;font-size:15px;font-weight:600;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.btn.p{background:#1E3350;color:#fff;height:42px;padding:0 18px}
.btn.s{border:1px solid #7A8593;background:#fff;color:#16202A}
.nota{font-size:12px;line-height:1.5;color:#34404D;background:#fff;border:1px solid #DFE2E6;border-left:4px solid #C9CED5;border-radius:8px;padding:8px 12px;max-width:520px}
.veu{position:absolute;inset:0;background:rgba(22,32,42,.35);z-index:4}
aside{position:absolute;top:0;right:0;width:560px;height:100%;min-height:768px;background:#F8F6F1;z-index:5;display:flex;flex-direction:column;box-shadow:-12px 0 32px rgba(22,32,42,.2)}
.dcab{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 20px;background:#fff;border-bottom:1px solid #DFE2E6}
.dcab h2{font-size:20px}
.dcab .sub{font-size:13px;color:#4A5562;display:flex;align-items:center;gap:8px;margin-top:4px}
.fechar{width:40px;height:40px;border:1px solid #7A8593;border-radius:10px;background:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.dcorpo{flex:1;padding:16px 20px;display:flex;flex-direction:column;gap:12px;overflow:hidden}
.drod{display:flex;justify-content:flex-end;gap:8px;padding:12px 20px;background:#fff;border-top:1px solid #DFE2E6}
.rot{font-size:12px;font-weight:600;color:#4A5562;letter-spacing:.06em;text-transform:uppercase}
.tent{background:#fff;border:1px solid #DFE2E6;border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.tent b{font-size:15px}
.ev{font-size:14px;color:#34404D}
.mot{font-size:15px;color:#A8261B;display:flex;gap:6px;align-items:flex-start;font-weight:600}
.mot svg{margin-top:3px;flex-shrink:0}
.erros{display:flex;flex-direction:column;gap:2px;font-size:14px;padding-left:21px}
.erros span{color:#34404D}.erros i{font-style:normal;font-weight:600;color:#16202A}
.notice{display:flex;gap:8px;align-items:flex-start;border-radius:10px;padding:10px 12px;font-size:15px}
.notice.d{background:#FDE8E6;color:#A8261B;font-weight:600}
.notice svg{margin-top:2px;flex-shrink:0}
.form{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px 12px}
.c{display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600;color:#16202A}
.c small{font-weight:400;color:#5B6673}
.c.s6{grid-column:span 6}.c.s4{grid-column:span 4}.c.s3{grid-column:span 3}.c.s2{grid-column:span 2}
.in{height:44px;border:1px solid #7A8593;border-radius:10px;background:#fff;font-size:15px;font-weight:400;display:flex;align-items:center;padding:0 12px;white-space:nowrap;overflow:hidden}
.in.erro{border:2px solid #A8261B}
.falta{font-size:13px;font-weight:600;color:#A8261B;display:flex;gap:4px;align-items:center}
.grp{grid-column:span 6;font-size:12px;font-weight:600;color:#4A5562;letter-spacing:.06em;text-transform:uppercase;margin-top:4px}
.corpo{display:flex;gap:24px}
.secoes{width:200px;flex-shrink:0;display:flex;flex-direction:column;gap:2px}
.sec{display:flex;align-items:center;height:40px;padding:0 12px 0 16px;border-radius:10px;font-size:15px;color:#34404D;position:relative}
.sec.ativo{background:#fff;color:#16202A;font-weight:600;box-shadow:0 0 0 1px #DFE2E6}
.sec.ativo:before{content:'';position:absolute;left:6px;top:10px;bottom:10px;width:3px;border-radius:2px;background:#1E3350}
.conteudo{flex:1;min-width:0;display:flex;flex-direction:column;gap:16px;max-width:760px}
.resumido{font-size:14px;color:#5B6673}
.chk{display:flex;align-items:center;gap:12px;min-height:44px;font-size:15px;font-weight:600}
.caixa{width:20px;height:20px;border-radius:4px;border:2px solid #7A8593;background:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.caixa.on{background:#1E3350;border-color:#1E3350}
.caixa.trava{background:#8B96A3;border-color:#8B96A3}
.chk.trava{color:#4A5562}
`;

const pagina = (titulo, menuAtivo, corpo, extra = '') =>
  `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${titulo}</title><style>${CSS}</style><body>${menu(...menuAtivo)}<main>${corpo}</main>${extra}${SCRIPT}</body></html>`;

// ---------- dados fictícios ----------
const SELO = { recusado: ['pe', 'Recusado'], reenviado: ['al', 'Reenviado'], aceito: ['ok', 'Aceito'] };
const LINHAS = [
  ['45.723.174/0001-10', 'Mercadinho São Jorge Ltda', 'Carlos Lima', '23/11/2026 10:05', 'Cadastro com divergência na SEFAZ', 'recusado', '00031'],
  ['08.114.392/0001-55', 'Comercial Rio Negro Eireli', 'Rita Alves', '23/11/2026 09:40', 'CEP não encontrado', 'reenviado', '00027'],
  ['321.654.987-00', 'Maria do Socorro Lima', 'Carlos Lima', '22/11/2026 16:20', 'CPF com situação irregular na Receita', 'recusado', '00029'],
  ['17.902.551/0001-03', 'Atacado Ponta Negra Ltda', 'João Mendes', '22/11/2026 11:02', 'Razão social diferente da Receita', 'aceito', '00018'],
  ['33.408.776/0001-29', 'Panificadora Aleixo Ltda', 'Rita Alves', '21/11/2026 15:47', 'Endereço incompleto', 'recusado', '00024'],
  ['52.660.118/0001-84', 'Distribuidora Tarumã Ltda', 'João Mendes', '20/11/2026 08:30', 'Telefone inválido', 'aceito', '00011'],
];
// Códigos do cliente (docs/design/telas/codigos-do-cliente.md): a consulta traz só o Código FDV.
const codigos = (fdv) => `<div class="cod"><span aria-label="Código FDV ${fdv}"><small>FDV</small><code>${fdv}</code></span></div>`;
const RECUSADOS = LINHAS.filter((l) => l[5] === 'recusado').length;

const abas = (n) =>
  `<div class="abas" role="tablist" aria-label="Clientes"><span class="aba" role="tab" aria-selected="false">Farol</span><span class="aba ativa" role="tab" aria-selected="true">Pré-cadastros recusados${n ? ` (${n})` : ''}</span></div>`;
const filtros = (situacao) =>
  `<div class="filtros"><span class="sel busca" aria-label="Buscar">${lupa}Razão social ou CPF/CNPJ</span>
  <label class="f">Situação<span class="sel">${situacao}${baixo}</span></label></div>`;
const tabela = (linhas, marcada = -1) =>
  `<section class="quadro" style="padding:8px 16px"><table><colgroup><col style="width:92px"><col style="width:190px"><col><col style="width:128px"><col style="width:168px"><col style="width:220px"><col style="width:118px"></colgroup>
  <thead><tr><th>Código</th><th>CPF/CNPJ</th><th>Razão social</th><th>Vendedor</th><th>Recusado em</th><th>Motivo da recusa</th><th>Situação</th></tr></thead><tbody>
  ${linhas.map(([d, r, v, dt, m, s, fdv], i) => `<tr${i === marcada ? ' class="sel-linha"' : ''}><td>${codigos(fdv)}</td><td>${d}</td><td class="nome" title="${r}">${r}</td><td>${v}</td><td>${dt}</td><td title="${m}">${m}</td><td><span class="selo ${SELO[s][0]}">${SELO[s][1]}</span></td></tr>`).join('')}
  </tbody></table></section>`;
const listaPagina = (situacao, linhas, marcada, nota) =>
  `<h1>Clientes</h1>${abas(RECUSADOS)}${filtros(situacao)}${tabela(linhas, marcada)}<div class="nota">${nota}</div>`;

// ---------- 01: lista ----------
const html01 = pagina('Clientes — Pré-cadastros recusados', ['Cadastros', 'Clientes'],
  listaPagina('Todas', LINHAS, -1, '<b>Simulação.</b> Dados fictícios. Filtro Situação em "Todas" para mostrar os três selos; o padrão ao abrir é "Recusado". O número da aba conta só os recusados.'));

// ---------- 02: histórico (gaveta) ----------
const gaveta = (titulo, sub, corpo, rodape) =>
  `<div class="veu"></div><aside role="dialog" aria-modal="true" aria-label="${titulo}"><div class="dcab"><div><h2>${titulo}</h2>${sub ? `<div class="sub">${sub}</div>` : ''}</div><span class="fechar" aria-label="Fechar painel">${xis}</span></div><div class="dcorpo">${corpo}</div><div class="drod">${rodape}</div></aside>`;
const tentativa = (rev, linhas, motivo, erros) =>
  `<div class="tent"><b>Revisão ${rev}</b>${linhas.map((l) => `<span class="ev">${l}</span>`).join('')}${motivo ? `<span class="mot">${alerta('#A8261B')}${motivo}</span>` : ''}${erros ? `<div class="erros">${erros.map(([c, e]) => `<span><i>${c}:</i> ${e}</span>`).join('')}</div>` : ''}</div>`;
const hist = `<span class="rot">Tentativas</span>
  ${tentativa(2, ['Corrigida por Carlos Lima, no Campo, em 23/11/2026 08:12', 'Recusada pelo ERP em 23/11/2026 10:05'], 'Cadastro com divergência na SEFAZ', [['Inscrição estadual', 'não confere com a SEFAZ'], ['CEP', 'não pertence a Manaus/AM']])}
  ${tentativa(1, ['Enviada por Carlos Lima, no Campo, em 22/11/2026 17:30', 'Recusada pelo ERP em 22/11/2026 18:02'], 'Endereço incompleto', [['Número', 'obrigatório']])}`;
const html02 = pagina('Pré-cadastro — histórico', ['Cadastros', 'Clientes'],
  listaPagina('Todas', LINHAS, 0, '<b>Simulação.</b> Clique na linha abre a gaveta com as tentativas, da mais nova para a mais antiga.'),
  gaveta('Mercadinho São Jorge Ltda', `<span><span aria-label="Código FDV 00031">FDV <code>00031</code></span> · 45.723.174/0001-10 · Carlos Lima</span><span class="selo pe">Recusado</span>`, hist, '<span class="btn p">Editar e reenviar</span>'));

// ---------- 03: editar e reenviar (mesma gaveta) ----------
const c = (rot, val, span, { opcional = false, erro = null } = {}) =>
  `<label class="c s${span}"><span>${rot}${opcional ? ' <small>(opcional)</small>' : ''}</span><span class="in${erro ? ' erro' : ''}">${val}</span>${erro ? `<span class="falta">${alerta('#A8261B', 13)}${erro}</span>` : ''}</label>`;
const form = `<div class="notice d" role="alert">${alerta('#A8261B')}<span>Cadastro com divergência na SEFAZ</span></div>
  <div class="form">
  ${c('CPF/CNPJ', '45.723.174/0001-10', 3)}${c('Inscrição estadual', '04.123.456-7', 3, { erro: 'Não confere com a SEFAZ' })}
  ${c('Razão social', 'Mercadinho São Jorge Ltda', 6)}
  ${c('Nome fantasia', 'Mercadinho São Jorge', 6, { opcional: true })}
  ${c('Telefone', '(92) 98123-4567', 3)}${c('E-mail', '', 3, { opcional: true })}
  <span class="grp">Endereço</span>
  ${c('CEP', '69050-010', 3, { erro: 'Não pertence a Manaus/AM' })}${c('Bairro', 'N. Sra. das Graças', 3)}
  ${c('Logradouro', 'Rua Rio Mar', 4)}${c('Número', '118', 2)}
  ${c('Cidade', 'Manaus', 4)}${c('UF', 'AM', 2)}
  </div>`;
const html03 = pagina('Pré-cadastro — editar e reenviar', ['Cadastros', 'Clientes'],
  listaPagina('Todas', LINHAS, 0, '<b>Simulação.</b> Editar e reenviar troca o conteúdo da gaveta pelo formulário, com os campos do erro já marcados. O corpo da gaveta rola; o rodapé fica fixo.'),
  gaveta('Editar e reenviar', '<span aria-label="Código FDV 00031">FDV <code>00031</code></span>', form, '<span class="btn s">Cancelar</span><span class="btn p">Reenviar</span>'));

// ---------- 04: vazio (filtro padrão "Recusado") ----------
const html04 = pagina('Clientes — Pré-cadastros recusados (vazio)', ['Cadastros', 'Clientes'],
  `<h1>Clientes</h1>${abas(0)}${filtros('Recusado')}<div class="vazio">Nenhum pré-cadastro recusado.</div><div class="nota"><b>Simulação.</b> Vazio com o filtro padrão. Sem recusados, a aba fica sem número.</div>`);

// ---------- 05: Parâmetros › Clientes › Campos obrigatórios ----------
const chk = (rot, on, trava = false) =>
  `<label class="chk${trava ? ' trava' : ''}"><span class="caixa${trava ? ' trava' : on ? ' on' : ''}" role="checkbox" aria-checked="${on}"${trava ? ' aria-disabled="true"' : ''}>${on ? visto : ''}</span>${rot}${trava ? ' <span class="selo ne">Sempre</span>' : ''}</label>`;
const html05 = pagina('Parâmetros — Clientes', ['Parâmetros'],
  `<h1>Parâmetros</h1><div class="corpo"><nav class="secoes" aria-label="Seções de Parâmetros">${SECOES.map((s) => `<a class="sec${s === 'Clientes' ? ' ativo" aria-current="page' : ''}">${s}</a>`).join('')}</nav>
  <div class="conteudo">
  <section class="quadro"><h2>Farol</h2><span class="resumido">(sem mudança)</span></section>
  <section class="quadro"><h2>Curvas ABC</h2><span class="resumido">(sem mudança)</span></section>
  <section class="quadro"><h2>Campos obrigatórios</h2><div>
  ${chk('Razão social', true, true)}${chk('CPF/CNPJ', true, true)}${chk('Nome fantasia', false)}${chk('Inscrição estadual', true)}${chk('Telefone', false)}${chk('E-mail', false)}${chk('Endereço', true)}
  </div><div><span class="btn p">Salvar</span></div></section>
  <div class="nota"><b>Simulação.</b> Uma lista só para o cadastro completo (RN-CORE-16) e o pré-cadastro (RN-CORE-79). Marcação inicial = padrão da RN-CORE-16. Farol e Curvas ABC resumidos.</div>
  </div></div>`);

await gerarPranchas(AQUI, {
  '01-bko-recusados-lista': [html01, 1366, 768],
  '02-bko-recusados-historico': [html02, 1366, 768],
  '03-bko-recusados-editar': [html03, 1366, 768],
  '04-bko-recusados-vazio': [html04, 1366, 768],
  '05-bko-parametros-campos-obrigatorios': [html05, 1366, 768],
});
