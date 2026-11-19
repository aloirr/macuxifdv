// Simulação do Cliente 360 v2 (R-20261119-030234; pranchas 01 a 04 refeitas em 19/11, R-20261119-0440 e R-20261119-0530): três abas (Resumo, Histórico, Documentação) no Campo e no Gestão,
// e a permissão de documentos em BKO › Parâmetros. Gera os HTMLs e os PNGs desta pasta. Sem código de produção.
// Uso, a partir da raiz do repositório: node docs/design/cliente-360-v2/gerar.mjs
// O gerador falha se: a nota de simulação cobrir um aparelho ou o conteúdo do BKO; um texto for cortado (largura maior que
// a caixa); um elemento sair do aparelho pelos lados; um bloco fixo (faixa, abas, rodapé, barra, folha) estourar a própria
// altura; dois itens da mesma linha se sobrepuserem; ou o menu do BKO passar da lista visível.
// docs/design/_comum/navegador.mjs não existe no main (19/11/2026): a abertura do Chromium e o laço ficam aqui, como em
// docs/design/menu-parametros/gerar.mjs.
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const AQUI = dirname(fileURLToPath(import.meta.url));
const LOGO = '../../marca/ativos/2026-11-12-v1/macuxi-logo-negativo-grafite.svg';

// ---------- Ícones (traço 24×24, como o Icon do packages/ui) ----------
const P = {
  voltar: '<path d="M15 18l-6-6 6-6"/>',
  seta: '<path d="M9 6l6 6-6 6"/>',
  baixo: '<path d="M6 9l6 6 6-6"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  mapa: '<path d="M3 11l19-9-9 19-2-8-8-2z"/>',
  sino: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  filtro: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  busca: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  cadeado: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  foto: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  semRede: '<path d="M1 1l22 22M16.7 11.1A11 11 0 0 1 19 12.6M5 12.6a11 11 0 0 1 5.2-2.4M10.7 5.1A16 16 0 0 1 22.6 9M1.4 9a16 16 0 0 1 4.7-2.9M8.5 16.1a6 6 0 0 1 7 0M12 20h.01"/>',
  inicio: '<path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  rota: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  clientes: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  pedidos: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6"/>',
  alvo: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  mais: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  alerta: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
};
const ic = (n, t = 20, w = 1.9, extra = '') =>
  `<svg class="ic" width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${P[n]}</svg>`;

// ---------- Dados de exemplo (coerentes entre as telas; hoje = 19/11/2026, fuso de Manaus) ----------
// Em aberto = 2.380 + 1.560 + 1.540 + 640 = R$ 6.120 (saldo); limite R$ 8.000, sem pedido aprovado não faturado → saldo
// disponível R$ 1.880 (RN-VEN-12).
// A NF 004655 tem a parcela 2/2 (R$ 640,00, vencimento 31/10) em atraso. Pedidos 000017, 000013 e 000009 viraram as
// NFs 004817, 004790 e 004702.
const NFS = [
  { mes: 'Novembro de 2026', data: '07/11', nf: '004817', valor: '2.380,00', forma: 'Boleto 28 dias', st: 'Em aberto' },
  { data: '03/11', nf: '004790', valor: '1.560,00', forma: 'Boleto 28 dias', st: 'Em aberto' },
  { mes: 'Outubro de 2026', data: '31/10', nf: '004744', valor: '1.540,00', forma: 'Boleto 28 dias', st: 'Em aberto' },
  { data: '24/10', nf: '004702', valor: '2.870,00', forma: 'Boleto 7/14 dias', st: 'Devolvido parcial', extra: '− 330,00' },
  { data: '10/10', nf: '004655', valor: '1.280,00', forma: 'Boleto 14/21 dias', st: 'Em atraso' },
  { mes: 'Setembro de 2026', data: '26/09', nf: '004530', valor: '1.990,00', forma: 'PIX', st: 'Pago' },
  { data: '12/09', nf: '004471', valor: '860,00', forma: 'Boleto 28 dias', st: 'Devolvido' },
  { mes: 'Agosto de 2026', data: '29/08', nf: '004402', valor: '2.150,00', forma: 'Boleto 28 dias', st: 'Pago' },
];
const TOM = { 'Em aberto': 'warning', 'Em atraso': 'danger', Pago: 'success', Devolvido: 'neutral', 'Devolvido parcial': 'accent' };

// ---------- Peças do aparelho (360×760) ----------
const chip = (txt, tom = 'neutral') => `<span class="chip ${tom}">${txt}</span>`;
const secao = (t, dir = '') => `<div class="secao linha" data-ancora="${t}"><h3>${t}</h3>${dir}</div>`;

// Tabela com cabeçalho, no padrão da TabelaDeItens do Novo pedido (print 15-pedido-resumo): cabeçalho 12/600 em #4A5562,
// linhas de no mínimo 44 dp separadas por fio, números tabulares e alinhados à direita. `cols`: [título, largura em dp ou
// 'f' (flexível), 'd' (direita), 'e' (esquerda), 's' (esquerda, afastada 8 dp da coluna anterior) ou 'm' (centro)]. Linha: lista de células (HTML), { grupo } para a faixa do mês ou do
// tipo, ou { cls, celulas, rotulo } para destacar ou dar o rótulo de acessibilidade.
function tabela(cols, linhas) {
  const st = ([, w]) => (w === 'f' ? 'flex:1 1 0;min-width:0' : `width:${w}px;flex:none`);
  const cel = (c, i, conteudo) => `<span class="c ${cols[i][2] === 'd' ? 'd' : cols[i][2] === 'm' ? 'm' : cols[i][2] === 's' ? 's' : ''}" style="${st(c)}">${conteudo}</span>`;
  const cab = `<div class="cb" role="row">${cols.map((c, i) => cel(c, i, c[0])).join('')}</div>`;
  const corpo = linhas
    .map((l) => {
      if (l.grupo) return `<div class="gr">${l.grupo}</div>`;
      const { cls = '', celulas = l, rotulo } = Array.isArray(l) ? { celulas: l } : l;
      return `<div class="li ${cls}" role="row"${rotulo ? ` aria-label="${rotulo}"` : ''}>${celulas.map((x, i) => cel(cols[i], i, x)).join('')}</div>`;
    })
    .join('');
  return `<div class="card tb" role="table">${cab}${corpo}</div>`;
}
// Tabela rótulo-valor (TabelaRotuloValor do Novo pedido): rótulo à esquerda, valor à direita da coluna.
const rotuloValor = (linhas, ancora = '', cls = '') => `<div class="card${cls ? ` ${cls}` : ''}"${ancora ? ` data-ancora="${ancora}"` : ''}>${linhas.map(([r, v]) => `<div class="rv"><span class="r">${r}</span><span class="v">${v}</span></div>`).join('')}</div>`;
const duas = (a, b, cls = '') => `<b>${a}</b><small class="${cls}">${b}</small>`;
const cod = (c) => `<a class="cod">${c}</a>`;
const btIc = (n, rot) => `<span class="mini" role="button" aria-label="${rot}">${ic(n, 18)}</span>`;

function cabecalho({ voltar, titulo = 'Mercado Bom Preço', sub = 'C5007 · Centro · Boa Vista/RR', hora = '09:02' }) {
  return `<div class="status"><span>${hora}</span><span class="st-ic">▾ ▮▮▮ ▭</span></div>
  <header class="faixa"><div class="voltar">${ic('voltar', 18, 2.2)}<span>${voltar}</span></div>
  <div class="linha topo"><div class="tt"><h1>${titulo}</h1><p>${sub}</p></div><span class="sino" aria-label="Notificações">${ic('sino', 22)}<i></i></span></div></header>`;
}
function abas(ativa) {
  return `<nav class="abas" role="tablist">${['Resumo', 'Histórico', 'Documentação'].map((a) => `<span role="tab" class="aba${a === ativa ? ' on' : ''}" aria-selected="${a === ativa}"><span>${a}</span></span>`).join('')}</nav>`;
}
function barraCampo() {
  const it = [['inicio', 'Início'], ['rota', 'Rota'], ['clientes', 'Clientes'], ['pedidos', 'Pedidos'], ['alvo', 'Performance'], ['mais', 'Mais']];
  return `<nav class="barra linha">${it.map(([i, r]) => `<span class="bi${r === 'Clientes' ? ' on' : ''}">${ic(i, 22)}<b>${r}</b></span>`).join('')}</nav>`;
}
function barraGestao() {
  const it = [['inicio', 'Início'], ['clientes', 'Equipe'], ['check', 'Aprovações'], ['alerta', 'Alertas']];
  return `<nav class="barra linha">${it.map(([i, r]) => `<span class="bi${r === 'Equipe' ? ' on' : ''}">${ic(i, 22)}<b>${r}</b></span>`).join('')}</nav>`;
}
const rodapeCampo = `<div class="rodape"><span class="btn sec"><span>Check-in</span></span><span class="btn sec"><span>Pesquisa</span></span><span class="btn pri"><span>Novo pedido</span></span></div>`;

// Resumo (R-20261119-0440): cadastro e endereços no topo; sem alerta financeiro, sem Última compra e sem Sugestão de mix.
// Decisão de 19/11 (R-20261119-0458, P7): sem o bloco Visitas; visitas, última visita e, no Gestão, "Visitada por" vão
// para o bloco de compras. Ajustes de 19/11 (R-20261119-0530): Limite, Saldo disponível e Prazo médio logo depois de Dados
// cadastrais; o bloco de compras vira "Performance", com as três curvas em linhas da tabela rótulo-valor.
function resumo({ gestao = false } = {}) {
  return `${secao('Dados cadastrais')}
  ${rotuloValor([['Razão social', 'Bom Preço Comércio de Alimentos Ltda'], ['CNPJ', '14.382.906/0001-27'], ['Filial', 'Boa Vista · Matriz'], ['Segmento', 'Supermercado'], ['Cliente desde', '03/2019']])}
  ${rotuloValor([['Limite', 'R$ 8.000,00'], ['Saldo disponível', 'R$ 1.880,00'], ['Prazo médio', '24 dias']], 'Crédito', 'larga')}
  ${secao('Endereços')}
  ${tabela([['Local', 76, 'e'], ['Endereço', 'f', 'e'], ['Mapa', 44, 'm']], [
    { celulas: [duas('Loja', 'Padrão'), duas('Av. Ville Roy, 1200', 'Centro · 69301-000'), btIc('mapa', 'Mapa da Loja')], rotulo: 'Loja, padrão, Av. Ville Roy, 1200, Centro' },
    [duas('Depósito', ''), duas('R. Cecília Brasil, 455', 'São Francisco · 69305-080'), btIc('mapa', 'Mapa do Depósito')],
  ])}
  ${secao('Contatos')}
  ${tabela([['Nome', 'f', 'e'], ['Cargo', 76, 'e'], ['Ligar', 44, 'm'], ['WhatsApp', 60, 'm']], [
    [duas('Antônio Ferreira', 'Principal'), 'Comprador', btIc('phone', 'Ligar para Antônio Ferreira'), btIc('chat', 'WhatsApp de Antônio Ferreira')],
    [duas('Luciana Souza', ''), 'Financeiro', btIc('phone', 'Ligar para Luciana Souza'), btIc('chat', 'WhatsApp de Luciana Souza')],
  ])}
  ${gestao ? `${secao('Carteira')}
  ${tabela([['Vendedora', 'f', 'e'], ['Ligar', 44, 'm'], ['WhatsApp', 60, 'm']], [['<b>Carla Lima</b>', btIc('phone', 'Ligar para Carla Lima'), btIc('chat', 'WhatsApp de Carla Lima')]])}` : ''}
  ${secao('Performance')}
  ${rotuloValor([['Curva Faturamento', 'A'], ['Curva Frequência', 'A'], ['Curva Volume', 'B'], ['Compra média/mês', 'R$ 5.210,00'], ['Ticket médio', 'R$ 2.605,00'], ['Frequência', 'a cada 14 dias'], ['Visitas', '46'], ['Última visita', '12/11/2026'], ...(gestao ? [['Visitada por', 'Carla Lima']] : [])], '', 'larga')}
  ${secao('Últimos itens comprados')}
  ${tabela([['Produto', 'f', 'e'], ['Qtd', 44, 'd'], ['Data', 40, 'd'], ['Total (R$)', 68, 'd']], [
    [duas('Arroz tipo 1 5 kg', cod('10231')), '10 CX', '07/11', '<b>1.290,00</b>'],
    [duas('Feijão carioca 1 kg', cod('10418')), '6 FD', '07/11', '<b>556,50</b>'],
    [duas('Óleo de soja 900 ml', cod('20480')), '3 CX', '03/11', '<b>444,00</b>'],
  ])}
  <div class="link-tab linha" role="button"><span class="link">Ver os 20 itens</span>${ic('seta', 18, 2)}</div>
  ${secao('Observações')}
  <div class="card"><div class="lin"><span class="corpo">Recebe das 7h às 11h. Descarga pela rua lateral.</span></div></div>`;
}

// Decisão de 19/11 (P14): sem o campo de busca na aba; a contagem fica à esquerda do botão de filtro e a busca pelo
// Nº da NF fica no topo da folha Filtrar.
function barraFiltro(qtd = 0, contagem = '') {
  return `<div class="ferramentas linha" data-ancora="filtro"><span class="contagem">${contagem}</span><span class="bt-filtro" role="button" aria-label="Filtrar${qtd ? `, ${qtd} filtro aplicado` : ''}">${ic('filtro', 22, 2.2)}${qtd ? `<i>${qtd}</i>` : ''}</span></div>`;
}
// Notas: Data · Nº NF · Valor (R$) · Status. A forma de pagamento é a 2ª linha da célula Nº NF; a devolução, a 2ª linha do
// Valor. A linha em atraso leva o destaque (fundo e fio vermelhos à esquerda); "Em atraso" vai sem data (R-20261119-0530).
const COLS_NF = [['Data', 36, 'e'], ['Nº NF', 'f', 'e'], ['Valor (R$)', 64, 'd'], ['Status', 92, 's']];
function linhaNF(n) {
  return {
    cls: n.st === 'Em atraso' ? 'atraso' : '',
    rotulo: `NF ${n.nf}, ${n.data}, ${n.valor} reais, ${n.st}`,
    celulas: [n.data, duas(cod(n.nf), n.forma), n.extra ? duas(n.valor, n.extra) : `<b>${n.valor}</b>`, chip(n.st, TOM[n.st])],
  };
}
// Aba Histórico (R-20261119-0530): só a contagem, o botão de filtro e a tabela; o crédito foi para o Resumo.
function historico({ filtrado = false } = {}) {
  const lista = filtrado ? NFS.filter((n) => n.st === 'Em atraso') : NFS;
  // o mês aparece antes da primeira nota de cada mês da lista filtrada
  const vistos = new Set();
  const linhas = lista.flatMap((n) => {
    const mes = NFS.slice(0, NFS.indexOf(n) + 1).reverse().find((x) => x.mes).mes;
    const r = vistos.has(mes) ? [linhaNF(n)] : [{ grupo: mes }, linhaNF(n)];
    vistos.add(mes);
    return r;
  });
  return `${barraFiltro(filtrado ? 1 : 0, filtrado ? '1 nota em atraso · últimos 90 dias' : '8 notas · últimos 90 dias')}
  ${filtrado ? `<div class="chips linha"><span class="chip-ap">Em atraso ${ic('x', 14, 2.4)}</span></div>` : ''}
  ${tabela(COLS_NF, linhas)}`;
}

function folhaFiltro() {
  const grupo = (t, ops, on) => `<div class="fgrupo"><span class="rot-f">${t}</span><div class="chips linha wrap">${ops.map((o) => `<span class="op${on.includes(o) ? ' on' : ''}">${on.includes(o) ? ic('check', 14, 2.6) : ''}${o}</span>`).join('')}</div></div>`;
  return `<div class="scrim"></div><div class="folha"><span class="pega"></span><div class="linha entre"><h2>Filtrar</h2>${ic('x', 24, 2)}</div>
  <div class="fgrupo"><span class="rot-f">Nº da NF</span><span class="busca">${ic('busca', 20)}<span>Buscar pelo número</span></span></div>
  ${grupo('Período', ['30 dias', '90 dias', '12 meses', 'Escolher datas'], ['90 dias'])}
  ${grupo('Status', ['Em atraso', 'Em aberto', 'Pago', 'Devolvido', 'Devolvido parcial'], ['Em atraso'])}
  ${grupo('Forma de pagamento', ['Boleto', 'PIX', 'Cartão', 'Dinheiro'], [])}
  <div class="linha g8 botoes"><span class="btn sec f1">Limpar</span><span class="btn pri f2">Ver 1 nota</span></div></div>`;
}
// Decisão de 19/11 (P17): a NF vem do servidor ao tocar, só com a autorização do vendedor, e não fica no aparelho.
const folhaBaixarNF = `<div class="scrim"></div><div class="folha"><span class="pega"></span><h2>Baixar a NF 004655?</h2>
  <div class="linha g8 botoes"><span class="btn sec f1">Agora não</span><span class="btn pri f1">Baixar</span></div></div>`;
const semInternet = (titulo) => `<div class="scrim"></div><div class="folha"><span class="pega"></span><div class="linha entre"><h2>${titulo}</h2>${ic('x', 24, 2)}</div>
  <div class="linha g8 aviso-rede">${ic('semRede', 22, 2)}<span class="corpo">Sem internet</span></div>
  <span class="btn pri cheio">Tentar de novo</span></div>`;
// Detalhe da NF em atraso (do servidor): os valores, as parcelas em tabela, os itens e o PDF.
function folhaNF() {
  return `<div class="scrim"></div><div class="folha"><span class="pega"></span><div class="linha entre"><div class="col"><h2>NF 004655</h2><span class="sub">10/10/2026 · Boleto 14/21 dias</span></div>${ic('x', 24, 2)}</div>
  <div>${chip('Em atraso', 'danger')}</div>
  ${rotuloValor([['Valor da nota', 'R$ 1.280,00'], ['Em atraso', '<span class="perigo-v">R$ 640,00</span>']])}
  <span class="rot-f">Parcelas</span>
  ${tabela([['Parcela', 48, 'e'], ['Vencimento', 'f', 'e'], ['Valor (R$)', 64, 'd'], ['Status', 84, 's']], [
    ['1/2', '24/10<small>paga em 23/10</small>', '<b>640,00</b>', chip('Pago', 'success')],
    { cls: 'atraso', celulas: ['2/2', '31/10', '<b>640,00</b>', chip('Em atraso', 'danger')] },
  ])}
  <div class="linha g8"><span class="btn sec f1">Ver itens (4)</span><span class="btn sec f1">Ver PDF</span></div></div>`;
}
// Itens comprados (detalhe da nota): Produto (nome e código) · Emb. · Qtd · Total, como a TabelaDeItens.
// 645,00 + 371,00 + 144,00 + 120,00 = 1.280,00 (o valor da NF 004655).
function folhaItens() {
  return `<div class="scrim"></div><div class="folha"><span class="pega"></span><div class="linha entre"><div class="col"><h2>Itens da NF 004655</h2><span class="sub">4 itens · R$ 1.280,00</span></div>${ic('x', 24, 2)}</div>
  ${tabela([['Produto', 'f', 'e'], ['Emb.', 44, 'd'], ['Qtd', 32, 'd'], ['Total (R$)', 68, 'd']], [
    [duas('Arroz tipo 1 5 kg', cod('10231')), 'CX<small>c/ 6</small>', '5', '<b>645,00</b>'],
    [duas('Feijão carioca 1 kg', cod('10418')), 'FD<small>c/ 10</small>', '4', '<b>371,00</b>'],
    [duas('Açúcar cristal 2 kg', cod('41020')), 'FD<small>c/ 10</small>', '2', '<b>144,00</b>'],
    [duas('Sal refinado 1 kg', cod('50210')), 'FD<small>c/ 10</small>', '3', '<b>120,00</b>'],
  ])}</div>`;
}

// Documentação: uma tabela com a faixa de cada tipo. `perfil`: 'vendedora' (Campo) ou 'supervisor' (Gestão).
// Colunas: Documento (nome; 2ª linha: formato e, quando houver, a validade) · Data · Abrir (seta, cadeado ou câmera).
function documentacao({ perfil = 'vendedora' } = {}) {
  const sup = perfil === 'supervisor';
  const seta = `<span class="mini" aria-hidden="true">${ic('seta', 18, 2)}</span>`;
  const doc = (nome, fmt, data) => ({ rotulo: `${nome}, ${fmt}, ${data}`, celulas: [duas(nome, fmt), data, seta] });
  const tranc = (nome) => ({ cls: 'tranc', rotulo: `${nome}, sem permissão para abrir`, celulas: [duas(nome, 'Sem permissão para abrir'), '—', `<span class="mini" aria-hidden="true">${ic('cadeado', 18, 2)}</span>`] });
  return tabela([['Documento', 'f', 'e'], ['Data', 76, 'd'], ['Abrir', 44, 'm']], [
    { grupo: 'Fotos do PDV' },
    doc('Fachada', 'Foto', '12/11/2026'),
    { rotulo: 'Gôndola, falta a foto', celulas: [duas('Gôndola', 'Falta', 'perigo'), '—', sup ? '' : `<span class="mini cam" role="button" aria-label="Adicionar foto da gôndola">${ic('camera', 18, 2)}</span>`] },
    { grupo: 'Cadastro' },
    doc('Alvará de funcionamento', 'PDF · válido até 03/2027', '03/03/2026'),
    doc('Cartão CNPJ', 'PDF', '05/08/2026'),
    doc('Comprovante de endereço', 'PDF', '05/08/2026'),
    { grupo: 'Contratos' },
    sup ? doc('Contrato de comodato nº 112', 'PDF', '18/06/2025') : tranc('Contrato de comodato nº 112'),
    ...(sup ? [doc('Contrato social', 'PDF', '22/03/2019')] : []),
  ]);
}
const docVazio = `<div class="vazio">${ic('doc', 40, 1.6)}<b>Nenhum documento deste cliente</b></div>`;
// Decisão de 19/11 (P15): o documento só abre para ver, do servidor; não baixa nem fica no aparelho.
const folhaSemRede = semInternet('Comprovante de endereço');

// tela: um aparelho. `rolar`: posição de rolagem do conteúdo ('fim' = até o fim).
function tela({ legenda, voltar = 'Clientes', aba, conteudo, rodape = rodapeCampo, barra = barraCampo(), sobre = '', rolar = 0, hora }) {
  return `<figure class="col-ap"><figcaption>${legenda}</figcaption><div class="tela">${cabecalho({ voltar, hora })}${abas(aba)}
  <main class="conteudo" data-rolar="${rolar}"><div class="pilha">${conteudo}</div></main>${rodape}${barra}${sobre}</div></figure>`;
}

const CSS_AP = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,'Segoe UI',Roboto,-apple-system,sans-serif;background:#F8F6F1;color:#16202A;padding:28px 32px 32px;display:flex;flex-direction:column;gap:20px;font-variant-numeric:tabular-nums}
.nota{font-size:14px;line-height:1.45;color:#34404D;background:#fff;border:1px solid #DFE2E6;border-left:4px solid #1E3350;border-radius:8px;padding:10px 14px;box-shadow:0 4px 12px rgba(22,32,42,.08)}
.nota b{color:#16202A}
.fila{display:flex;gap:32px;align-items:flex-start}
.col-ap{display:flex;flex-direction:column;gap:10px;width:360px}
figcaption{font-size:16px;font-weight:700;text-align:center;line-height:1.3;min-height:42px;display:flex;align-items:center;justify-content:center}
.tela{width:360px;height:760px;border-radius:28px;overflow:hidden;background:#F8F6F1;border:1px solid #C9CED5;box-shadow:0 10px 28px rgba(22,32,42,.14);display:flex;flex-direction:column;position:relative}
.linha{display:flex;align-items:center}
.entre{justify-content:space-between;gap:8px}
.g8{gap:8px}.wrap{flex-wrap:wrap}
.status{height:24px;flex-shrink:0;background:#1E3350;color:#fff;font-size:12px;font-weight:600;display:flex;justify-content:space-between;align-items:center;padding:0 20px}
.st-ic{font-size:10px;letter-spacing:1px;color:#fff}
.faixa{background:#1E3350;color:#fff;padding:4px 20px 14px;flex-shrink:0;display:flex;flex-direction:column;gap:4px}
.voltar{display:flex;align-items:center;gap:4px;height:32px;color:#C9CED5;font-size:14px;font-weight:500;margin-left:-4px}
.topo{gap:12px}
.tt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.faixa h1{font-size:22px;line-height:28px;font-weight:700;white-space:nowrap;overflow:hidden}
.faixa p{font-size:14px;line-height:18px;color:#C9CED5;white-space:nowrap;overflow:hidden}
.sino{width:44px;height:44px;border-radius:12px;border:1px solid rgba(201,206,213,.45);display:flex;align-items:center;justify-content:center;position:relative;flex-shrink:0}
.sino i{position:absolute;top:9px;right:10px;width:8px;height:8px;border-radius:50%;background:#F59A52}
.abas{height:48px;flex-shrink:0;display:flex;border-bottom:1px solid #DFE2E6;background:#F8F6F1}
.aba{flex:1 1 auto;padding:0 10px;display:flex;align-items:center;justify-content:center;font-size:16px;color:#4A5562;position:relative;white-space:nowrap}
.aba.on{color:#16202A;font-weight:600}
.aba.on:after{content:'';position:absolute;left:8px;right:8px;bottom:-1px;height:3px;border-radius:2px;background:#1E3350}
.conteudo{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;scrollbar-width:none}
.conteudo::-webkit-scrollbar{display:none}
.pilha{padding:14px 20px 18px;display:flex;flex-direction:column;gap:12px}
.secao{margin-top:6px;justify-content:space-between}
.pilha>.secao:first-child{margin-top:0}
h3{font-size:18px;font-weight:700;line-height:22px}
.chips{gap:6px}
.chip{display:inline-flex;align-items:center;height:24px;padding:0 10px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;flex-shrink:0}
.chip.success{color:#1D6B4F;background:#E2F1EA}.chip.warning{color:#7A4F00;background:#FFF1D6}.chip.danger{color:#A8261B;background:#FDE8E6}
.chip.neutral{color:#34404D;background:#ECEEF1}.chip.accent{color:#1E3350;background:#DFE2E6}
.card{background:#fff;border:1px solid #DFE2E6;border-radius:14px;overflow:hidden}
.lin{min-height:52px;padding:8px 6px 8px 14px;display:flex;align-items:center}
.col{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.sub{font-size:14px;line-height:18px;color:#4A5562}
.perigo{font-size:14px;line-height:18px;color:#A8261B;font-weight:600}
.mini{width:48px;height:48px;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#1E3350}
.link{font-size:14px;font-weight:600;color:#1E3350}
.corpo{font-size:16px;line-height:22px;padding-right:8px}
/* TabelaRotuloValor (Novo pedido): rótulo 14 em #4A5562 à esquerda, valor 16 à direita da coluna */
.rv{display:flex;gap:12px;align-items:center;min-height:48px;padding:10px 14px;border-bottom:1px solid #ECEEF1}
.rv:last-child{border-bottom:0}
.larga .rv .r{width:136px}
.rv .r{width:104px;flex:none;font-size:14px;line-height:18px;color:#4A5562}
.rv .v{flex:1;min-width:0;font-size:16px;line-height:21px}
.perigo-v{color:#A8261B;font-weight:600}
/* Tabela (TabelaDeItens do Novo pedido, print 15): cabeçalho 12/600, linhas ≥ 44 dp, gap 4, padding 8, números tabulares */
.tb .cb,.tb .li{display:flex;gap:4px;padding:0 8px;align-items:center}
.tb .cb{padding-top:10px;padding-bottom:6px;align-items:flex-end}
.tb .cb .c{font-size:12px;font-weight:600;line-height:15px;color:#4A5562}
.tb .li{min-height:44px;border-top:1px solid #ECEEF1;padding-top:6px;padding-bottom:6px}
.tb .c{display:flex;flex-direction:column;align-items:flex-start;gap:2px;font-variant-numeric:tabular-nums}
.tb .c.d{align-items:flex-end;text-align:right}
.tb .c.m{align-items:center;text-align:center}
.tb .c.s{padding-left:8px}
.tb .li .c{font-size:12px;line-height:16px;color:#16202A}
.tb .li .c b{font-size:14px;font-weight:600;line-height:18px}
.tb .li .c small{font-size:12px;line-height:15px;color:#4A5562}
.tb .li .c small.perigo{color:#A8261B;font-weight:600}
.tb .gr{font-size:12px;font-weight:600;letter-spacing:.6px;line-height:15px;text-transform:uppercase;color:#4A5562;background:#F8F6F1;padding:7px 8px;border-top:1px solid #ECEEF1}
.tb .cod{font-family:'Roboto Mono',ui-monospace,monospace;font-size:12px;line-height:15px;color:#1E3350;text-decoration:underline}
.tb .li .c b .cod{font-size:12px}
.tb .li.atraso{background:#FDF1EF;box-shadow:inset 3px 0 0 #A8261B}
.tb .chip{height:auto;min-height:22px;padding:3px 8px;line-height:15px;white-space:normal}
.tb .li.tranc .c b{color:#4A5562}
.tb .li.tranc .mini{color:#5B6673}
.tb .mini{width:44px;height:44px;margin:-6px 0}
.link-tab{justify-content:flex-end;gap:2px;min-height:44px;margin-top:-8px;color:#1E3350}
.rodape{flex-shrink:0;display:flex;gap:6px;padding:8px 20px;background:#F8F6F1;border-top:1px solid #DFE2E6}
.btn{height:48px;border-radius:14px;display:inline-flex;align-items:center;justify-content:center;gap:6px;font-size:16px;font-weight:600;white-space:nowrap;padding:0 10px}
.btn.sec{padding:0 8px;border:1.5px solid #16202A;background:#fff;color:#16202A}
.btn.pri{background:#1E3350;color:#fff;flex:1}
.btn.cheio{width:100%;flex:none}
.f1{flex:1}.f2{flex:1.6}
.barra{height:60px;flex-shrink:0;display:flex;background:#fff;border-top:1px solid #DFE2E6}
.bi{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:#4A5562;min-width:0}
.bi b{font-size:12px;font-weight:500;white-space:nowrap}
.bi.on{color:#1E3350}.bi.on b{font-weight:700}
.ferramentas{gap:8px}
.busca{flex:1;height:48px;border:1px solid #C9CED5;border-radius:12px;background:#fff;display:flex;align-items:center;gap:8px;padding:0 12px;color:#4A5562;font-size:16px}
.bt-filtro{width:48px;height:48px;border:1.5px solid #16202A;border-radius:12px;background:#fff;display:flex;align-items:center;justify-content:center;position:relative;flex-shrink:0}
.bt-filtro i{position:absolute;top:-7px;right:-7px;min-width:20px;height:20px;border-radius:10px;background:#C2540A;color:#fff;font-size:12px;font-weight:700;font-style:normal;display:flex;align-items:center;justify-content:center}
.chip-ap{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px;border-radius:999px;background:#DFE2E6;color:#1E3350;font-size:14px;font-weight:600}
.contagem{flex:1;min-width:0;font-size:14px;line-height:18px;color:#4A5562}
.fgrupo .busca{flex:none}
.scrim{position:absolute;inset:0;background:rgba(15,20,25,.45)}
.folha{position:absolute;left:0;right:0;bottom:0;background:#fff;border-radius:22px 22px 0 0;padding:10px 20px 20px;display:flex;flex-direction:column;gap:14px;max-height:92%}
.folha .tb{border-color:#DFE2E6}
.pega{align-self:center;width:40px;height:4px;border-radius:2px;background:#C9CED5}
.folha h2{font-size:22px;font-weight:700;line-height:28px}
.fgrupo{display:flex;flex-direction:column;gap:8px}
.rot-f{font-size:14px;font-weight:600;color:#4A5562}
.op{display:inline-flex;align-items:center;gap:6px;height:40px;padding:0 14px;border-radius:999px;border:1px solid #C9CED5;font-size:14px;font-weight:600;color:#16202A;background:#fff;white-space:nowrap}
.op.on{background:#DFE2E6;border-color:#DFE2E6;color:#1E3350}
.botoes{margin-top:4px}
.vazio{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:80px 16px;color:#5B6673;text-align:center}
.vazio b{font-size:16px;color:#16202A}
.aviso-rede{color:#34404D;align-items:flex-start}
`;

// Checagens no navegador (depois das fontes): rola cada aparelho e grava os problemas em body[data-info].
const SCRIPT_AP = `<script>document.fonts.ready.then(()=>{
for(const c of document.querySelectorAll('.conteudo')){const r=c.dataset.rolar;const a=r&&r.startsWith('#')?c.querySelector('[data-ancora="'+r.slice(1)+'"]'):null;c.scrollTop=a?a.getBoundingClientRect().top-c.getBoundingClientRect().top-6:r==='fim'?c.scrollHeight:Number(r||0);}
const p=[];
const nome=(e)=>(e.className&&e.className.baseVal!==undefined?'svg':e.tagName.toLowerCase()+'.'+e.className)+' "'+(e.textContent||'').trim().slice(0,32)+'"';
const notas=[...document.querySelectorAll('.nota')].map(n=>n.getBoundingClientRect());
for(const t of document.querySelectorAll('.tela')){const T=t.getBoundingClientRect();
 for(const n of notas){if(n.left<T.right&&n.right>T.left&&n.top<T.bottom&&n.bottom>T.top)p.push('nota cobre aparelho');}
 for(const e of t.querySelectorAll('*')){const r=e.getBoundingClientRect();if(!r.width||!r.height)continue;
  if(!e.closest('.scrim')&&(r.left<T.left-0.5||r.right>T.right+0.5))p.push('sai do aparelho: '+nome(e));
  if(e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).overflowX!=='visible'&&!e.matches('.conteudo,.card,.tela'))p.push('texto cortado: '+nome(e));
  if(e.children.length===0&&e.textContent.trim()&&!(e instanceof SVGElement)){if(r.left<T.left+4||r.right>T.right-4)p.push('texto colado na borda: '+nome(e));if(e.scrollWidth>Math.ceil(r.width)+1)p.push('texto cortado: '+nome(e));}}
 for(const f of t.querySelectorAll('.status,.faixa,.abas,.rodape,.barra,.folha')){const F=f.getBoundingClientRect();for(const e of f.querySelectorAll('*')){const r=e.getBoundingClientRect();if(!r.height)continue;if(r.bottom>F.bottom+0.5||r.top<F.top-0.5)p.push('estoura '+f.className+': '+nome(e));}}
 for(const l of t.querySelectorAll('.linha')){const k=[...l.children].map(x=>x.getBoundingClientRect()).filter(r=>r.width&&r.height);for(let i=0;i<k.length;i++)for(let j=i+1;j<k.length;j++){const a=k[i],b=k[j];if(a.left<b.right-0.5&&a.right>b.left+0.5&&a.top<b.bottom-0.5&&a.bottom>b.top+0.5)p.push('sobreposição na linha: '+nome(l));}}
}
document.body.dataset.info=JSON.stringify(p);document.body.dataset.pronto='1';});</script>`;

function prancha(titulo, nota, telas) {
  const n = telas.length;
  const largura = 64 + n * 360 + (n - 1) * 32;
  return {
    largura,
    html: `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${titulo}</title><style>${CSS_AP}body{width:${largura}px}</style><body><div class="nota">${nota}</div><div class="fila">${telas.join('')}</div>${SCRIPT_AP}</body></html>`,
  };
}

// ---------- 01: Campo · Resumo ----------
const p01 = prancha(
  'Cliente 360 v2 · Campo · Resumo',
  '<b>Simulação, sem código (R-20261119-030234; refeita pelo comentário de 19/11, R-20261119-0440; decisões de 19/11, R-20261119-0458).</b> Campo, aba Resumo, nesta ordem: Dados cadastrais, crédito (Limite, Saldo disponível e Prazo médio; ajustes de 05h30, R-20261119-0530), Endereços, Contatos, Performance (Curva Faturamento, Curva Frequência e Curva Volume, 3 indicadores, visitas e última visita), Últimos itens comprados e Observações. As listas são tabelas com cabeçalho, como a de itens do Novo pedido. Sem alerta financeiro na ficha (o atraso fica no Histórico); saem Última compra e Sugestão de mix. Dados fictícios.',
  [
    tela({ legenda: 'Resumo · topo: Dados cadastrais', aba: 'Resumo', conteudo: resumo() }),
    tela({ legenda: 'Rolado: crédito, Endereços e Contatos', aba: 'Resumo', conteudo: resumo(), rolar: '#Crédito' }),
    tela({ legenda: 'Rolado: Performance, com as curvas', aba: 'Resumo', conteudo: resumo(), rolar: '#Performance' }),
    tela({ legenda: 'Fim do Resumo', aba: 'Resumo', conteudo: resumo(), rolar: 'fim' }),
  ],
);

// ---------- 02: Campo · Histórico ----------
const p02 = prancha(
  'Cliente 360 v2 · Campo · Histórico',
  '<b>Simulação.</b> Aba Histórico (era Financeiro; R-20261119-0530): só a contagem, o filtro e a tabela de notas (Data · Nº NF · Valor · Status; a forma de pagamento é a 2ª linha do Nº NF), da mais recente para a mais antiga. A nota em atraso fica em destaque na tabela e tem o status "Em atraso", sem data, e o filtro: é aqui, e só aqui, que o atraso aparece. Padrão: últimos 90 dias, todos os status (o padrão não conta no número do filtro). Decisões de 19/11 (R-20261119-0458): a busca pelo Nº da NF fica no topo da folha Filtrar (P14); ao tocar na linha, o app pergunta se baixa a NF, busca no servidor a nota, as parcelas, os itens e o PDF, e não guarda nada no aparelho (P17).',
  [
    tela({ legenda: 'Filtros fechados (padrão)', aba: 'Histórico', conteudo: historico() }),
    tela({ legenda: 'Rolado: os cinco status', aba: 'Histórico', conteudo: historico(), rolar: 'fim' }),
    tela({ legenda: 'Filtrar: Nº da NF no topo', aba: 'Histórico', conteudo: historico(), sobre: folhaFiltro() }),
    tela({ legenda: 'Filtro aplicado: Em atraso', aba: 'Histórico', conteudo: historico({ filtrado: true }), rolar: '#filtro' }),
    tela({ legenda: 'Toque na linha: autorização', aba: 'Histórico', conteudo: historico({ filtrado: true }), sobre: folhaBaixarNF }),
    tela({ legenda: 'Baixar: a nota, do servidor', aba: 'Histórico', conteudo: historico({ filtrado: true }), sobre: folhaNF() }),
    tela({ legenda: 'Ver itens (do servidor)', aba: 'Histórico', conteudo: historico({ filtrado: true }), sobre: folhaItens() }),
    tela({ legenda: 'Baixar sem internet', aba: 'Histórico', conteudo: historico({ filtrado: true }), sobre: semInternet('NF 004655'), hora: '09:05' }),
  ],
);

// ---------- 03: Campo · Documentação ----------
const p03 = prancha(
  'Cliente 360 v2 · Campo · Documentação',
  '<b>Simulação.</b> Aba Documentação, no lugar de Compras: uma tabela (Documento · Data · Abrir; o formato e a validade na 2ª linha do Documento) com a faixa de cada tipo (Fotos do PDV, Cadastro, Contratos). O tipo que o perfil não vê não aparece (aqui, Contrato social); o documento com exceção aparece com cadeado e não abre (a linha já diz o porquê; sem aviso extra). Decisão de 19/11 (R-20261119-0458, P15): o documento só abre para ver, vindo do servidor; não há baixar nem cópia no aparelho, e sem internet a folha mostra "Sem internet" e "Tentar de novo". Estado vazio e sem internet.',
  [
    tela({ legenda: 'Tabela por tipo (vendedora)', aba: 'Documentação', conteudo: documentacao() }),
    tela({ legenda: 'Rolado: documento sem permissão', aba: 'Documentação', conteudo: documentacao(), rolar: 'fim' }),
    tela({ legenda: 'Estado vazio', aba: 'Documentação', conteudo: docVazio }),
    tela({ legenda: 'Abrir sem internet', aba: 'Documentação', conteudo: documentacao(), sobre: folhaSemRede, hora: '09:05' }),
  ],
);

// ---------- 04: Gestão ----------
const p04 = prancha(
  'Cliente 360 v2 · Gestão',
  '<b>Simulação.</b> O mesmo Cliente 360 no Gestão (supervisora, vinda de Equipe › Carla Lima). Muda: a tabela Carteira no Resumo (ligar e WhatsApp para a vendedora), "Visitada por" no bloco Performance, junto da última visita (P7, R-20261119-0458). Como no Campo: crédito logo depois de Dados cadastrais e Performance com as três curvas (R-20261119-0530), e sem rodapé (sem check-in; o pedido em nome sai da ficha da vendedora, RF-GES-05). Na Documentação, o que o perfil Supervisor vê, sem a câmera. O Histórico é igual ao do Campo.',
  [
    tela({ legenda: 'Resumo · topo', voltar: 'Carla Lima', aba: 'Resumo', conteudo: resumo({ gestao: true }), rodape: '', barra: barraGestao() }),
    tela({ legenda: 'Resumo · rolado: Contatos e Carteira', voltar: 'Carla Lima', aba: 'Resumo', conteudo: resumo({ gestao: true }), rodape: '', barra: barraGestao(), rolar: '#Contatos' }),
    tela({ legenda: 'Resumo · rolado: Performance', voltar: 'Carla Lima', aba: 'Resumo', conteudo: resumo({ gestao: true }), rodape: '', barra: barraGestao(), rolar: '#Performance' }),
    tela({ legenda: 'Documentação (supervisora)', voltar: 'Carla Lima', aba: 'Documentação', conteudo: documentacao({ perfil: 'supervisor' }), rodape: '', barra: barraGestao() }),
  ],
);

// ---------- 05: BKO · Parâmetros › Documentos (opção A) ----------
const MENU = [
  { g: 'Acesso' }, { g: 'Análise' }, { g: 'Cadastros' }, { g: 'Comunicação' }, { g: 'Operação' }, { i: 'Pesquisa', bloq: true },
  { g: 'Produtos' }, { g: 'Trade' }, { i: 'Treinamento', bloq: true }, { i: 'Parâmetros', ativo: true }, { g: 'Sistema' },
];
const SECOES = ['Acesso', 'Alertas', 'Calendário', 'Clientes', 'Documentos', 'Início', 'Integração', 'Metas e RV', 'Pedidos', 'Pesquisa', 'Produtos', 'Trade', 'Treinamento', 'Visitas'];
const SEM = ['Pesquisa', 'Treinamento'];
const cad = (t = 14) => ic('cadeado', t, 2.2);
const menuBko = `<nav class="menu"><div class="brand"><img src="${LOGO}" height="28" alt="Macuxi Força de Vendas"><span>Distribuidora Exemplo</span></div><div class="lista">${MENU.map((e) =>
  e.i ? `<div class="titulo${e.ativo ? ' direto ativo' : ''}${e.bloq ? ' bloq' : ''}"><span>${e.i}</span>${e.bloq ? cad() : ''}</div>` : `<div class="titulo"><span>${e.g}</span>${ic('seta', 14, 2.2)}</div>`).join('')}</div>
  <div class="rodape-m"><b>Ana Souza</b><span>Administrador</span><div class="sair">↪ Trocar perfil</div></div></nav>`;
const sel = (v, editado = false) => `<span class="input${editado ? ' editado' : ''}${v === 'Não vê' ? ' nao' : ''}">${v}${ic('baixo', 16, 2)}</span>`;
const TIPOS = [
  ['Alvará de funcionamento', 'ERP', ['Vê', 'Não vê', 'Vê', 'Vê'], 1],
  ['Cartão CNPJ', 'ERP', ['Vê', 'Vê', 'Vê', 'Vê']],
  ['Comprovante de endereço', 'Escritório', ['Vê', 'Não vê', 'Vê', 'Vê']],
  ['Contrato de comodato', 'Escritório', ['Vê', 'Não vê', 'Vê', 'Vê']],
  ['Contrato social', 'Escritório', ['Não vê', 'Não vê', 'Vê', 'Vê']],
  ['Fotos do PDV', 'App', ['Vê e envia', 'Vê e envia', 'Vê', 'Vê']],
];
const html05 = () => `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Parâmetros › Documentos</title><style>${CSS_BKO}</style><body>${menuBko}
<main><h1>Parâmetros</h1><div class="corpo"><nav class="secoes">${SECOES.map((s) => `<div class="sec${s === 'Documentos' ? ' ativo' : ''}${SEM.includes(s) ? ' bloq' : ''}"><span>${s}</span>${SEM.includes(s) ? cad() : ''}</div>`).join('')}</nav>
<div class="conteudo">
<section class="quadro"><div class="topo"><h2>Quem vê cada tipo de documento</h2><span class="btn s">Adicionar tipo</span></div>
<table><colgroup><col style="width:32%"><col><col><col><col></colgroup><thead><tr><th>Tipo</th><th>Vendedor</th><th>Promotor</th><th>Supervisor</th><th>Gerente</th></tr></thead><tbody>
${TIPOS.map(([t, o, v, ed]) => `<tr><td class="tipo"><b>${t}</b><small>Origem: ${o}</small></td>${v.map((x, i) => `<td class="cs">${sel(x, ed === i)}</td>`).join('')}</tr>`).join('')}
</tbody></table>
<div class="acoes"><span class="btn s">Descartar</span><span class="btn p">Salvar permissões</span></div></section>
<section class="quadro"><div class="topo"><div><h2>Exceções por documento</h2><small>A exceção só tira acesso do que o tipo libera.</small></div><span class="btn s">Adicionar exceção</span></div>
<table><colgroup><col style="width:30%"><col style="width:30%"><col><col style="width:52px"></colgroup><thead><tr><th>Documento</th><th>Cliente</th><th>Quem vê</th><th class="ac"></th></tr></thead><tbody>
<tr><td class="forte">Contrato de comodato nº 112</td><td>Mercado Bom Preço · C5007</td><td>Supervisor, Gerente</td><td class="ac"><span class="dots">⋯</span></td></tr>
<tr><td class="forte">Comprovante de endereço</td><td>Atacadão Roraima · C5120</td><td>Gerente</td><td class="ac"><span class="dots">⋯</span></td></tr>
</tbody></table></section>
<div class="nota"><b>Simulação.</b> Opção A (esta): seção nova Documentos em Parâmetros. Opção B: os dois quadros dentro de Parâmetros › Clientes. A origem vem do cadastro do tipo. As colunas são os perfis do app da empresa (os derivados entram como coluna); Administrador e Analista do BKO veem tudo. "Alvará de funcionamento · Promotor" está editado e ainda não salvo (por isso "Salvar permissões" está ligado).</div>
</div></div></main>${SCRIPT_BKO}</body></html>`;

// CSS e checagem do BKO (mesmo padrão de docs/design/menu-parametros).
const CSS_BKO = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,'Segoe UI',Roboto,-apple-system,sans-serif;background:#F8F6F1;color:#16202A;width:1366px;min-height:768px;display:flex;position:relative;font-variant-numeric:tabular-nums}
.menu{width:240px;min-height:768px;background:#16202A;color:#fff;display:flex;flex-direction:column;padding:20px 12px 16px;flex-shrink:0}
.brand{display:flex;flex-direction:column;align-items:flex-start;padding:0 8px 16px}
.brand img{display:block;height:28px;width:auto}
.brand span{font-size:12px;line-height:16px;color:#C9CED5;margin-top:18px}
.lista{display:flex;flex-direction:column;gap:2px;flex:1;min-height:0;overflow:hidden}
.titulo{display:flex;justify-content:space-between;align-items:center;height:30px;padding:0 10px;border-radius:8px;color:#F59A52;font-size:12px;font-weight:600;letter-spacing:.07em;text-transform:uppercase}
.titulo.direto.ativo{background:#2B3743;color:#fff}
.titulo.bloq{color:#8B96A3}
.rodape-m{margin-top:12px;border-top:1px solid #2B3743;padding:12px 8px 0;display:flex;flex-direction:column}
.rodape-m b{font-size:15px}.rodape-m span{font-size:12px;color:#C9CED5}.sair{font-size:13px;font-weight:600;color:#C9CED5;margin-top:8px}
main{flex:1;min-width:0;padding:28px 32px;display:flex;flex-direction:column;gap:20px}
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
.topo small{display:block;font-size:13px;color:#4A5562;margin-top:2px}
h2{font-weight:700;font-size:17px}
table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:15px}
th{text-align:left;font-size:13px;font-weight:600;color:#4A5562;padding:8px 10px;border-bottom:1px solid #DFE2E6;white-space:nowrap}
td{padding:0 10px;height:52px;border-bottom:1px solid #ECEEF1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
tr:last-child td{border-bottom:0}
.forte{font-weight:600}
.input{height:40px;border:1px solid #C9CED5;border-radius:10px;background:#fff;font-size:15px;font-weight:500;display:flex;align-items:center;justify-content:space-between;gap:4px;padding:0 8px 0 10px;color:#16202A;white-space:nowrap;overflow:hidden}
.input .ic{flex-shrink:0}
td.cs{padding:0 6px}
td.tipo{height:60px;line-height:1.25}td.tipo b{display:block;font-weight:600}td.tipo small{display:block;font-size:13px;color:#4A5562}
.input.nao{color:#4A5562;font-weight:400}
.input.editado{border:2px solid #1E3350}
.acoes{display:flex;justify-content:flex-end;gap:8px}
.btn{height:44px;border-radius:10px;padding:0 18px;font-size:15px;font-weight:600;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.btn.p{background:#1E3350;color:#fff}
.btn.s{border:1px solid #C9CED5;background:#fff;color:#16202A}
.ac{width:52px;text-align:center;padding:0}
.dots{display:inline-flex;width:36px;height:36px;align-items:center;justify-content:center;border-radius:10px;color:#4A5562;font-size:18px}
.nota{font-size:12px;line-height:1.5;color:#34404D;background:#fff;border:1px solid #DFE2E6;border-left:4px solid #C9CED5;border-radius:8px;padding:8px 12px;box-shadow:0 4px 12px rgba(22,32,42,.08)}
`;
const SCRIPT_BKO = `<script>document.fonts.ready.then(()=>{const p=[];
const notas=[...document.querySelectorAll('.nota')].map(n=>n.getBoundingClientRect());
for(const el of document.querySelectorAll('main *')){if(el.closest('.nota'))continue;const r=el.getBoundingClientRect();if(!r.width||!r.height)continue;
 for(const s of notas){if(r.left<s.right&&r.right>s.left&&r.top<s.bottom&&r.bottom>s.top&&!el.contains(document.querySelector('.nota')))p.push('nota cobre: '+el.tagName+' '+el.textContent.trim().slice(0,30));}
 if(el.scrollWidth>el.clientWidth+1&&getComputedStyle(el).overflowX!=='visible')p.push('texto cortado: '+el.tagName+' '+el.textContent.trim().slice(0,30));}
const l=document.querySelector('.lista');const fundo=Math.max(...[...l.children].map(x=>x.getBoundingClientRect().bottom));
if(fundo>l.getBoundingClientRect().bottom+0.5)p.push('menu passa da lista visível');
if(document.querySelector('main').getBoundingClientRect().right>1366.5)p.push('conteúdo passa de 1366');
document.body.dataset.info=JSON.stringify(p);document.body.dataset.pronto='1';});</script>`;

const TELAS = [
  ['01-campo-resumo', p01.html, { width: p01.largura, height: 900 }],
  ['02-campo-historico', p02.html, { width: p02.largura, height: 900 }],
  ['03-campo-documentacao', p03.html, { width: p03.largura, height: 900 }],
  ['04-gestao', p04.html, { width: p04.largura, height: 900 }],
  ['05-bko-parametros-documentos', html05(), { width: 1366, height: 768 }],
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
if (!existsSync(join(AQUI, LOGO))) throw new Error(`Logo não encontrado: ${LOGO}`);
const browser = await abrirNavegador();
let falhou = false;
for (const [nome, html, viewport] of TELAS) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  const arq = join(AQUI, `${nome}.html`);
  writeFileSync(arq, html);
  await page.goto(pathToFileURL(arq).href);
  await page.waitForSelector('body[data-pronto]');
  const problemas = [...new Set(JSON.parse(await page.evaluate(() => document.body.dataset.info)))];
  if (problemas.length) falhou = true;
  await page.screenshot({ path: join(AQUI, `${nome}.png`), fullPage: true });
  console.log(nome, problemas.length ? JSON.stringify(problemas) : 'ok');
  await page.close();
}
await browser.close();
if (falhou) {
  console.error('Falha: nota cobrindo conteúdo, texto cortado, elemento fora do aparelho, bloco fixo estourado ou sobreposição.');
  process.exit(1);
}
