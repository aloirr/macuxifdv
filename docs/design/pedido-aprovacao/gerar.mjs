// Simulação da T-0184 (P-6: pedido com crédito estourado vai para aprovação) e da tabela simples de Pedidos do BKO
// (R-20261116-143000-alexandre, R-20261118-212716-alexandre). Gera os HTMLs e os PNGs desta pasta.
// Uso, a partir da raiz do repositório: node docs/design/pedido-aprovacao/gerar.mjs
// As telas do BKO partem da prancha aprovada de Parâmetros › Pedidos (docs/design/menu-parametros/03-parametros-pedidos.html):
// mesmo menu, mesmos estilos; muda só o conteúdo.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { abrirNavegador } from '../_comum/navegador.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const BASE = readFileSync(join(AQUI, '../menu-parametros/03-parametros-pedidos.html'), 'utf8');

// ---------- BKO ----------
const ini = BASE.indexOf('<div class="conteudo">');
const fim = BASE.indexOf('</main>');
if (ini < 0 || fim < 0) throw new Error('prancha base de Parâmetros › Pedidos mudou: ajuste o gerador');

const CSS_BKO = `<style>
.sel{height:44px;border:1px solid #C9CED5;border-radius:10px;background:#fff;font-size:15px;display:flex;align-items:center;justify-content:space-between;padding:0 12px;width:300px}
.sel.editado{border:2px solid #1E3350}
.sel svg{color:#4A5562}
.linha{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:16px;align-items:center;min-height:56px}
.linha b{font-size:15px;font-weight:600}
.filtros{display:flex;gap:12px;align-items:flex-end}
.filtros .campo{font-size:12px;font-weight:600;color:#4A5562}
/* MC-1746: cabeçalho de tabela em 12 px também nas Alçadas (a base de Parâmetros usa 13). */
th{font-size:12px}
.busca{height:44px;border:1px solid #C9CED5;border-radius:10px;background:#fff;width:300px;display:flex;align-items:center;gap:8px;padding:0 12px;color:#5B6673;font-size:15px}
/* Tabela de Pedidos (R-20261118-214740): 13 colunas; em 1366 rola na horizontal com Código + Cliente e Situação + Ações fixas. */
.quadro.tab{padding:0;overflow:hidden}
.rola{overflow-x:auto;scrollbar-width:none}
/* Barra de rolagem desenhada: o Chromium sem janela esconde a nativa. Polegar = área visível ÷ largura da tabela. */
.barra-rola{height:12px;background:#ECEEF1;border-top:1px solid #DFE2E6;padding:3px}
.barra-rola i{display:block;height:6px;width:66%;border-radius:999px;background:#8B96A3}
.larga .barra-rola{display:none}
table.ped{table-layout:fixed;border-collapse:separate;border-spacing:0;width:1610px}
table.ped th{font-size:12px;white-space:normal;line-height:16px;padding:10px 8px;vertical-align:bottom;background:#fff}
table.ped td{height:56px;padding:8px;line-height:20px;background:#fff;overflow:visible;text-overflow:clip}
table.ped td.qb{white-space:normal}
table.ped .tn{font-variant-numeric:tabular-nums}
table.ped .vz{color:#5B6673}
.fe1,.fe2,.fd1,.fd2{position:sticky;z-index:1}
.fe1{left:0}.fe2{left:76px}.fd1{right:300px}.fd2{right:0}
.fe2:after,.fd1:before{content:'';position:absolute;top:0;bottom:0;width:8px;pointer-events:none}
.fe2:after{right:-8px;background:linear-gradient(to right,rgba(22,32,42,.10),rgba(22,32,42,0))}
.fd1:before{left:-8px;background:linear-gradient(to left,rgba(22,32,42,.10),rgba(22,32,42,0))}
.larga .fe2:after,.larga .fd1:before{display:none}
.sit{display:inline-block;border-radius:8px;padding:3px 8px;font-size:12px;line-height:16px;font-weight:500;white-space:nowrap}
.s-pe{color:#1E3350;background:#DFE2E6}.s-ok{color:#1D6B4F;background:#E2F1EA}.s-ne{color:#34404D;background:#ECEEF1}.s-re{color:#A8261B;background:#FDE8E6}
.acs{display:flex;gap:6px;align-items:center}
.acs .sel{width:196px;height:38px;border-radius:10px;padding:0 10px}
.acs .sel.vazia span{color:#5B6673}
.b{height:38px;border-radius:10px;padding:0 14px;font-size:15px;font-weight:600;display:inline-flex;align-items:center;white-space:nowrap;border:1px solid #C9CED5;background:#fff;color:#16202A}
</style>`;

const chev = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
const lupa = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';

function bko(conteudo, nota, { pedidos = false, larga = false } = {}) {
  let h = BASE.slice(0, ini) + `<div class="conteudo">${conteudo}</div></div>` + BASE.slice(fim);
  h = h.replace('</style>', '</style>' + CSS_BKO);
  if (larga) {
    // Tela de 1920×1080: a mesma página, sem o teto de largura do conteúdo.
    h = h.replace('</style>', 'body{width:1920px;min-height:1080px}.menu{min-height:1080px}main{max-width:none}</style>');
    h = h.replace('<body>', '<body class="larga">');
  }
  h = h.replace(/<div class="nota">[\s\S]*?<\/div><\/nav>/, `<div class="nota">${nota}</div></nav>`);
  if (pedidos) {
    // Operação › Pedidos aberto e ativo; a página não tem as seções de Parâmetros.
    h = h.replace('<a class="titulo direto ativo" aria-current="page"><span>Parâmetros</span></a>', '<a class="titulo direto"><span>Parâmetros</span></a>');
    h = h.replace(
      /<div class="grupo"><div class="titulo" aria-expanded="false"><span>Operação<\/span>(<svg[\s\S]*?<\/svg>)<\/div><\/div>/,
      (_, s) => `<div class="grupo"><div class="titulo aberto" aria-expanded="true"><span>Operação</span>${s.replace('rotate(0deg)', 'rotate(90deg)')}</div><a class="item">Aprovações</a><a class="item ativo" aria-current="page">Pedidos</a><a class="item">Rotas</a><a class="item">Visitas</a></div>`,
    );
    h = h.replace('<h1>Parâmetros</h1>', '<h1>Pedidos</h1>');
    h = h.replace(/<nav class="secoes"[\s\S]*?<\/nav>/, '');
    h = h.replace('</main>', `<div class="nota solta">${nota}</div></main>`);
  }
  return h;
}

const ALCADAS = `<section class="quadro"><h2>Alçadas</h2><table><colgroup><col style="width:40%"><col></colgroup><thead><tr><th>Desconto do pedido</th><th>Quem aprova</th></tr></thead><tbody>
<tr><td>Até 5%</td><td>Vendedor (aprovado na hora)</td></tr><tr><td>Até 10%</td><td>Supervisor</td></tr><tr><td>Até 15%</td><td>Gerente</td></tr><tr><td>Acima de 15%</td><td>Analista comercial</td></tr>
</tbody></table></section>`;

const CREDITO = `<section class="quadro"><h2>Crédito e inadimplência</h2>
<div class="linha"><b>Quem aprova crédito</b><div class="sel editado" role="combobox" aria-label="Quem aprova o pedido por crédito"><span>Gerente</span>${chev}</div></div>
<div class="linha"><b>Quem aprova inadimplência</b><div class="sel editado" role="combobox" aria-label="Quem aprova o pedido de cliente inadimplente"><span>Gerente</span>${chev}</div></div>
<div class="acoes"><span class="btn s">Descartar</span><span class="btn p">Salvar</span></div></section>`;

const TELA_PARAMETROS = bko(
  ALCADAS + CREDITO,
  '<b>Simulação.</b> P2 = B: um campo para o crédito e outro para a inadimplência. P5 = B: os dois vêm com Gerente. Opções: Supervisor, Gerente, Analista comercial.',
);

const LINHAS = [
  // [código do cliente, cliente, UF, cidade, nº, vendedor, supervisor, recebido, valor, motivo, observação, ação escolhida (só no pendente), [tom, situação]]
  ['C5007', 'Mercado Bom Preço', 'RR', 'Boa Vista', '000021', 'Carla Lima', 'Marcos Dias', '18/11 09:12', 'R$ 2.480,00', 'Crédito', 'Entregar pela manhã', 'Aprovar', ['s-pe', 'Aguardando aprovação']],
  ['C5012', 'Supermercado Rio Branco', 'RR', 'Boa Vista', '000020', 'Carla Lima', 'Marcos Dias', '18/11 08:40', 'R$ 1.150,00', 'Desconto 12%', '', '', ['s-pe', 'Aguardando aprovação']],
  ['C5003', 'Atacadão Norte', 'AM', 'Manaus', '000019', 'Paulo Reis', 'Ana Prado', '17/11 16:05', 'R$ 6.900,00', '', 'Usar a doca 2', null, ['s-ok', 'Aprovado']],
  ['C5021', 'Mercearia São José', 'RR', 'Caracaraí', '000018', 'Paulo Reis', 'Ana Prado', '17/11 11:20', 'R$ 820,00', '', 'Ligar antes; portão lateral', null, ['s-ne', 'Enviado ao ERP']],
  ['C5030', 'Comercial Paricarana', 'RR', 'Boa Vista', '000016', 'Carla Lima', 'Marcos Dias', '16/11 10:02', 'R$ 540,00', '', '', null, ['s-re', 'Rejeitado']],
  ['C5009', 'Empório Caxangá', 'RR', 'Boa Vista', '000015', 'Carla Lima', 'Marcos Dias', '15/11 15:47', 'R$ 3.310,00', '', 'Nota com CNPJ da filial', null, ['s-ok', 'Faturado']],
];
const vazio = (t) => t || '<span class="vz">—</span>';
const acoes = (escolha) =>
  escolha === null
    ? ''
    : `<div class="acs"><div class="sel${escolha ? ' editado' : ' vazia'}" role="combobox" aria-label="Ação do pedido"><span>${escolha || 'Escolher ação'}</span>${chev}</div><span class="b">Aplicar</span></div>`;
const TABELA = `<div class="filtros"><div class="busca">${lupa}<span>Buscar cliente ou nº do pedido</span></div>
<label class="campo">Situação<div class="sel" style="width:220px"><span>Todas</span>${chev}</div></label>
<label class="campo">Vendedor<div class="sel" style="width:200px"><span>Todos</span>${chev}</div></label></div>
<section class="quadro tab"><div class="rola"><table class="ped"><colgroup>${[76, 160, 44, 92, 72, 100, 104, 100, 104, 116, 170, 172, 300].map((w) => `<col style="width:${w}px">`).join('')}</colgroup>
<thead><tr><th class="fe1">Código do cliente</th><th class="fe2">Cliente</th><th>UF</th><th>Cidade</th><th>Nº</th><th>Vendedor</th><th>Supervisor</th><th>Recebido</th><th class="n">Valor</th><th>Motivo</th><th>Observação do pedido</th><th class="fd1">Situação</th><th class="fd2">Ações</th></tr></thead><tbody>
${LINHAS.map(([cod, c, uf, cid, n, v, sup, r, val, m, obs, esc, [cl, s]]) => `<tr><td class="fe1 tn">${cod}</td><td class="fe2 qb">${c}</td><td>${uf}</td><td>${cid}</td><td class="tn">${n}</td><td>${v}</td><td>${sup}</td><td class="tn">${r}</td><td class="n">${val}</td><td>${vazio(m)}</td><td class="qb">${vazio(obs)}</td><td class="fd1"><span class="sit ${cl}">${s}</span></td><td class="fd2">${acoes(esc)}</td></tr>`).join('\n')}
</tbody></table></div><div class="barra-rola" aria-hidden="true"><i></i></div></section>`;
const NOTA_PEDIDOS =
  '<b>Simulação.</b> Colunas na ordem pedida (R-20261118-214740). Situação e Ações por último. Situação só com os status do sistema. Ações só no pendente: lista com Aprovar, Rejeitar e Devolver ao vendedor + Aplicar. Largura: A rolagem com as pontas fixas (recomendado).';
const TELA_PEDIDOS = bko(TABELA, NOTA_PEDIDOS, { pedidos: true });
const TELA_PEDIDOS_LARGA = bko(TABELA, '<b>Simulação.</b> Em 1920×1080 as 13 colunas cabem sem rolagem; as pontas fixas não aparecem.', { pedidos: true, larga: true });

// ---------- App (Campo e Gestão) ----------
const CSS_APP = `<style>
*{box-sizing:border-box;margin:0}
body{font-family:system-ui,'Segoe UI',Roboto,-apple-system,sans-serif;background:#ECEEF1;color:#16202A;display:flex;gap:28px;padding:28px;align-items:flex-start;width:max-content}
.col{display:flex;flex-direction:column;gap:10px;width:360px}
.leg{font-size:14px;font-weight:600;min-height:36px}
.tel{width:360px;height:760px;background:#F8F6F1;border-radius:24px;overflow:hidden;display:flex;flex-direction:column;position:relative;box-shadow:0 0 0 1px #C9CED5}
.st{height:24px;background:#1E3350;color:#fff;font-size:12px;font-weight:600;display:flex;justify-content:space-between;align-items:center;padding:0 16px}
.fx{background:#1E3350;padding:6px 16px 14px;display:flex;flex-direction:column;gap:2px}
.fx .v{color:#C9CED5;font-size:14px}.fx h1{color:#fff;font-size:22px;font-weight:700}.fx .s{color:#C9CED5;font-size:14px}
.abas{display:flex;background:#fff;border-bottom:1px solid #DFE2E6}
.aba{flex:1;height:44px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;color:#4A5562}
.aba.on{color:#1E3350;box-shadow:inset 0 -3px 0 #1E3350}
.corpo{flex:1;padding:14px 16px;display:flex;flex-direction:column;gap:12px;overflow:hidden}
.tit{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#4A5562}
.tit.al{color:#A8261B}
.cx{background:#fff;border:1px solid #DFE2E6;border-radius:12px}
.al-l{display:flex;gap:10px;align-items:center;min-height:44px;padding:0 12px;font-size:14px;border-bottom:1px solid #ECEEF1}
.al-l:last-child{border-bottom:0}
.al-l svg{color:#A8261B;flex:none}
.tl{display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:40px;padding:0 12px;font-size:14px;border-bottom:1px solid #ECEEF1}
.tl:last-child{border-bottom:0}
.tl span:last-child{font-variant-numeric:tabular-nums;text-align:right}
.tl.f{min-height:48px}
.tl.f span:first-child{font-size:16px;font-weight:600}
.tl.f span:last-child{font-size:22px;font-weight:600}
.rod{padding:12px 16px 16px;background:#fff;border-top:1px solid #DFE2E6;display:flex;flex-direction:column;gap:8px}
.bt{height:52px;border-radius:14px;background:#1E3350;color:#fff;font-size:16px;font-weight:600;display:flex;align-items:center;justify-content:center}
.bt.t{background:none;color:#1E3350;height:44px}
.scrim{position:absolute;inset:0;background:rgba(15,20,25,.45);display:flex;align-items:center;justify-content:center;padding:24px}
.dlg{background:#fff;border-radius:20px;padding:24px 20px 12px;width:100%;display:flex;flex-direction:column;gap:16px}
.dlg h2{font-size:22px;font-weight:700}
.dlg .bts{display:flex;justify-content:flex-end;gap:8px}
.dlg .bt{height:44px;padding:0 20px;border-radius:12px}
/* Tags do Histórico (packages/ui/src/comum/historico.ts): neutro, destaque (etapa atual, MC-1744), sucesso, erro; 12/600, 24 px. */
.hist{display:flex;flex-wrap:wrap;gap:6px}
.tag{height:24px;border-radius:999px;padding:0 10px;font-size:12px;display:inline-flex;align-items:center;background:#ECEEF1;color:#34404D;font-weight:600;white-space:nowrap}
.tag.at{background:#DFE2E6;color:#1E3350}
.tag.ok{background:#E2F1EA;color:#1D6B4F}
.tag.er{background:#FDE8E6;color:#A8261B}
.it{display:flex;flex-direction:column;gap:6px;padding:12px 16px;border-bottom:1px solid #ECEEF1}
.it:last-child{border-bottom:0}
.it .a{display:flex;justify-content:space-between;gap:8px;font-size:16px;font-weight:600}
.it .a span:last-child{font-variant-numeric:tabular-nums}
.it .m{font-size:14px;color:#4A5562}
.it .c{display:flex;justify-content:space-between;align-items:center}
.chip{height:24px;border-radius:999px;padding:0 8px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;background:#FFF1D6;color:#5C3B00}
.chip.ne{background:#ECEEF1;color:#34404D}
.dec{font-size:12px;font-weight:600;color:#1E3350;min-height:44px;min-width:64px;display:inline-flex;align-items:center;justify-content:flex-end}
.nota{font-size:12px;line-height:1.5;color:#34404D;background:#fff;border:1px solid #DFE2E6;border-left:4px solid #C9CED5;border-radius:8px;padding:8px 12px}
.barra{height:56px;background:#fff;border-top:1px solid #DFE2E6;display:flex}
.barra span{flex:1;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:#4A5562}
.barra span.on{color:#1E3350}
</style>`;
const alerta = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.01"/></svg>';
const st = (hora = '09:41') => `<div class="st"><span>${hora}</span><span>4G</span></div>`;

const RESUMO = `<div class="tel">${st('09:12')}<div class="fx"><span class="v">‹ Pedidos</span><h1>Novo pedido</h1><span class="s">Mercado Bom Preço · cód. C5007</span></div>
<div class="abas"><span class="aba">Venda</span><span class="aba">Itens</span><span class="aba">Entrega</span><span class="aba on">Resumo</span></div>
<div class="corpo"><span class="tit al">Alertas</span><div class="cx">
<div class="al-l">${alerta}<span>Limite de crédito excedido</span></div>
<div class="al-l">${alerta}<span>Título vencido</span></div></div>
<span class="tit">Pagamento</span><div class="cx"><div class="tl"><span>Boleto</span><span>28/56 dias</span></div></div>
<span class="tit">Totais</span><div class="cx"><div class="tl f"><span>Valor final</span><span>R$ 2.480,00</span></div></div></div>
<div class="rod"><span class="bt">Salvar e enviar pedido</span><span class="bt t">Apenas salvar</span></div>
<div class="scrim"><div class="dlg"><h2>Enviar para aprovação?</h2><div class="bts"><span class="bt t">Voltar</span><span class="bt">Enviar</span></div></div></div></div>`;

// Pedido 000021 com dois motivos (P3 B): uma aprovação por motivo, ao mesmo tempo (P7 A, decidido em 18/11).
const detalhe = (hora, hist, rodape, alertas = '') => `<div class="tel">${st(hora)}<div class="fx"><span class="v">‹ Pedidos</span><h1>Pedido 000021</h1><span class="s">Mercado Bom Preço · cód. C5007</span></div>
<div class="corpo">${alertas}<div class="cx"><div class="tl"><span>Pagamento</span><span>Boleto · 28/56 dias</span></div><div class="tl"><span>Entrega</span><span>CIF · Av. Ville Roy, 1200</span></div></div>
<span class="tit">Itens (12)</span><div class="cx"><div class="tl"><span>Arroz 5 kg · 10 CX</span><span>R$ 1.290,00</span></div><div class="tl"><span>Feijão 1 kg · 8 CX</span><span>R$ 742,00</span></div><div class="tl"><span>+ 10 itens</span><span></span></div></div>
<span class="tit">Totais</span><div class="cx"><div class="tl f"><span>Valor final</span><span>R$ 2.480,00</span></div></div>
<span class="tit">Histórico</span><div class="hist"><span class="tag">Salvo · 18/11 09:10</span><span class="tag">Enviado · 18/11 09:12</span>${hist}</div></div>
<div class="rod">${rodape}</div></div>`;
// Aprovado o motivo Inadimplente; o Crédito segue na etapa atual.
const DETALHE = detalhe(
  '10:10',
  '<span class="tag ok">Aprovado · Inadimplente · Rui Matos · 18/11 10:05</span><span class="tag at">Em aprovação · Crédito</span>',
  '<span class="bt t">PDF · Duplicar</span>',
);
// P8 A (decidido em 18/11): o Crédito devolvido encerra as outras aprovações; o pedido volta para o vendedor corrigir (P6 A).
const DEVOLVIDO = detalhe(
  '10:25',
  '<span class="tag ok">Aprovado · Inadimplente · Rui Matos · 18/11 10:05</span><span class="tag er">Rejeitado · Crédito · Rui Matos · 18/11 10:20</span>',
  '<span class="bt">Corrigir pedido</span>',
  // RN-VEN-42: o motivo da recusa do supervisor numa linha, na área Alertas logo abaixo do nome do cliente.
  `<span class="tit al">Alertas</span><div class="cx"><div class="al-l">${alerta}<span>Reduza para até R$ 1.880,00</span></div></div>`,
);

// Fila do Gerente (P2 B e P5 B: crédito e inadimplência com o Gerente; desconto de 12% pela alçada até 15%).
// Um item por motivo (P3 B): o 000021 aparece uma vez por motivo, cada um com a sua decisão.
const GESTAO = `<div class="tel">${st()}<div class="fx"><h1>Aprovações</h1><span class="s">3 aguardando</span></div>
<div class="corpo" style="padding:12px 0 0"><div class="cx" style="border-radius:0;border-left:0;border-right:0">
<div class="it"><div class="a"><span>Mercado Bom Preço</span><span>R$ 2.480,00</span></div><span class="m">Nº 000021 · Crédito disponível R$ 1.880,00</span><div class="c"><span class="chip">Vence hoje</span><span class="dec">Decidir</span></div></div>
<div class="it"><div class="a"><span>Mercado Bom Preço</span><span>R$ 2.480,00</span></div><span class="m">Nº 000021 · Inadimplente há 12 dias</span><div class="c"><span class="chip">Vence hoje</span><span class="dec">Decidir</span></div></div>
<div class="it"><div class="a"><span>Supermercado Rio Branco</span><span>R$ 1.150,00</span></div><span class="m">Nº 000020 · Desconto 12%</span><div class="c"><span class="chip ne">1 dia útil</span><span class="dec">Decidir</span></div></div>
</div></div><div class="barra"><span>Início</span><span>Equipe</span><span class="on">Aprovações</span><span>Alertas</span></div></div>`;

// Conferência de sobreposição: a legenda e a nota não podem cobrir nada do aparelho (.tel), e nada do aparelho passa da borda dele.
const CONFERIR = `<script>(()=>{const conflitos=[];
for(const col of document.querySelectorAll('.col')){const tel=col.querySelector('.tel').getBoundingClientRect();
const sobre=[...col.querySelectorAll('.leg,.nota')].map(e=>[e.className,e.getBoundingClientRect()]);
for(const el of col.querySelectorAll('.tel *')){if(el.children.length&&!el.matches('.tag,.chip,.bt,.dec,h1,h2'))continue;
const r=el.getBoundingClientRect();if(!r.width||!r.height)continue;const t=el.className+': '+el.textContent.trim().slice(0,30);
for(const [n,s] of sobre){if(r.left<s.right&&r.right>s.left&&r.top<s.bottom&&r.bottom>s.top)conflitos.push(n+' cobre '+t);}
if(r.left<tel.left-1||r.right>tel.right+1||r.top<tel.top-1||r.bottom>tel.bottom+1)conflitos.push('fora do aparelho: '+t);
if(el.scrollWidth>el.clientWidth+1&&getComputedStyle(el).overflow!=='visible')conflitos.push('cortado: '+t);}}
document.body.dataset.info=JSON.stringify({conflitos});document.body.dataset.pronto='1';})()</script>`;

const app = (cols) => `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>T-0184 · simulação</title>${CSS_APP}<body>${cols
  .map(([leg, tel, nota]) => `<div class="col"><span class="leg">${leg}</span>${tel}${nota ? `<div class="nota">${nota}</div>` : ''}</div>`)
  .join('')}${CONFERIR}</body></html>`;

const TELAS = {
  '01-bko-parametros-pedidos': [TELA_PARAMETROS, 1366, 768],
  '02-campo-enviar-e-detalhe': [
    app([
      ['Campo · Novo pedido, Resumo: os motivos em Alertas e a pergunta de sempre', RESUMO],
      ['Campo · Em aprovação: uma etapa por motivo, aprovadas ao mesmo tempo (P3 B, P7 A)', DETALHE],
      ['Campo · Crédito devolvido: a aprovação pendente se encerra e o pedido volta para corrigir (P8 A)', DEVOLVIDO],
    ]),
  ],
  '03-gestao-aprovacoes': [
    app([['Gestão · Aprovações do Gerente: um item por motivo, só os motivos dele (P3 B)', GESTAO, 'O 000020 está aqui pela alçada: desconto de 12% cabe no Gerente (até 15%).']]),
  ],
  '04-bko-pedidos-tabela': [TELA_PEDIDOS, 1366, 768],
  '04b-bko-pedidos-tabela-larga': [TELA_PEDIDOS_LARGA, 1920, 1080],
};

const browser = await abrirNavegador();
let falhou = false;
for (const [nome, [html, w, h]] of Object.entries(TELAS)) {
  const arq = join(AQUI, `${nome}.html`);
  writeFileSync(arq, html);
  const page = await browser.newPage({ viewport: { width: w || 800, height: h || 900 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(arq).href);
  await page.waitForSelector('body[data-pronto="1"]');
  const info = JSON.parse(await page.evaluate(() => document.body.dataset.info));
  if (info.conflitos.length) falhou = true;
  await page.screenshot({ path: join(AQUI, `${nome}.png`), fullPage: true });
  console.log(nome, JSON.stringify({ conflitos: info.conflitos }));
  await page.close();
}
await browser.close();
if (falhou) process.exit(1);
