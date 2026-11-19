// Simulação do Cliente 360 v2 (R-20261119-030234): três abas (Resumo, Financeiro, Documentação) no Campo e no Gestão,
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
// Em aberto = 2.380 + 1.560 + 1.540 + 640 = R$ 6.120 (saldo); limite R$ 8.000 → crédito disponível R$ 1.880.
// Compras de novembro = 2.380 + 1.560 = R$ 3.940. Pedidos 000017, 000013 e 000009 viraram as NFs 004817, 004790 e 004702.
const NFS = [
  { mes: 'Novembro de 2026', data: '07/11/2026', nf: '004817', valor: 'R$ 2.380,00', forma: 'Boleto 28 dias', st: 'Em aberto' },
  { data: '03/11/2026', nf: '004790', valor: 'R$ 1.560,00', forma: 'Boleto 28 dias', st: 'Em aberto' },
  { mes: 'Outubro de 2026', data: '31/10/2026', nf: '004744', valor: 'R$ 1.540,00', forma: 'Boleto 28 dias', st: 'Em aberto' },
  { data: '24/10/2026', nf: '004702', valor: 'R$ 2.870,00', forma: 'Boleto 7/14 dias', st: 'Devolvido parcial', extra: 'Devolvido R$ 330,00' },
  { data: '10/10/2026', nf: '004655', valor: 'R$ 1.280,00', forma: 'Boleto 14/21 dias', st: 'Em aberto', venc: 'R$ 640,00 vencido desde 01/11' },
  { mes: 'Setembro de 2026', data: '26/09/2026', nf: '004530', valor: 'R$ 1.990,00', forma: 'PIX', st: 'Pago' },
  { data: '12/09/2026', nf: '004471', valor: 'R$ 860,00', forma: 'Boleto 28 dias', st: 'Devolvido' },
  { mes: 'Agosto de 2026', data: '29/08/2026', nf: '004402', valor: 'R$ 2.150,00', forma: 'Boleto 28 dias', st: 'Pago' },
];
const TOM = { 'Em aberto': 'warning', Pago: 'success', Devolvido: 'neutral', 'Devolvido parcial': 'accent' };

// ---------- Peças do aparelho (360×760) ----------
const chip = (txt, tom = 'neutral') => `<span class="chip ${tom}">${txt}</span>`;
const stat = (rot, val, sub = '') => `<div class="stat"><span class="rot">${rot}</span><span class="num">${val}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</div>`;
const secao = (t, dir = '') => `<div class="secao linha" data-ancora="${t}"><h3>${t}</h3>${dir}</div>`;

function cabecalho({ voltar, titulo = 'Mercado Bom Preço', sub = 'C5007 · Centro · Boa Vista/RR', hora = '09:02' }) {
  return `<div class="status"><span>${hora}</span><span class="st-ic">▾ ▮▮▮ ▭</span></div>
  <header class="faixa"><div class="voltar">${ic('voltar', 18, 2.2)}<span>${voltar}</span></div>
  <div class="linha topo"><div class="tt"><h1>${titulo}</h1><p>${sub}</p></div><span class="sino" aria-label="Notificações">${ic('sino', 22)}<i></i></span></div></header>`;
}
function abas(ativa) {
  return `<nav class="abas" role="tablist">${['Resumo', 'Financeiro', 'Documentação'].map((a) => `<span role="tab" class="aba${a === ativa ? ' on' : ''}" aria-selected="${a === ativa}"><span>${a}</span></span>`).join('')}</nav>`;
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

// Alertas (RN-VEN-42): área única no topo do conteúdo, em todas as abas.
const ALERTA_TITULO = `<div class="alerta warning" role="alert">${ic('relogio', 20, 2)}<div class="al-txt"><b>1 título vencido</b><span>R$ 640,00 · venceu em 01/11</span></div><span class="link">Ver</span></div>`;

const contato = `<div class="acoes linha">${[['phone', 'Ligar'], ['chat', 'WhatsApp'], ['mapa', 'Mapa']].map(([i, r]) => `<span class="acao">${ic(i, 20)}<b>${r}</b></span>`).join('')}</div>`;

function resumo({ gestao = false } = {}) {
  const ultimaVisita = gestao ? 'Carla Lima' : 'Você';
  return `${ALERTA_TITULO}
  ${contato}
  ${gestao ? `<div class="card"><div class="lin linha"><div class="col"><span class="rot">Vendedora da carteira</span><b>Carla Lima</b></div><span class="mini" aria-label="Ligar para Carla Lima">${ic('phone', 18)}</span><span class="mini" aria-label="WhatsApp de Carla Lima">${ic('chat', 18)}</span></div></div>` : ''}
  ${secao('Compras')}
  <div class="chips linha">${chip('Faturamento A', 'accent')}${chip('Volume B', 'accent')}${chip('Frequência A', 'accent')}</div>
  <div class="grade">${stat('Última compra', 'há 12 dias')}${stat('Compra média/mês', 'R$ 5.210')}${stat('Ticket médio', 'R$ 2.605')}${stat('Frequência', 'a cada 14 dias')}</div>
  ${secao('Visitas')}
  <div class="grade">${stat('Visitas', '46')}${stat('Última visita', '12/11/2026', ultimaVisita)}</div>
  ${secao('Últimos itens comprados')}
  <div class="card">
    ${[['Arroz tipo 1 5 kg', '10 CX · 07/11/2026', 'R$ 129,00'], ['Feijão carioca 1 kg', '6 FD · 07/11/2026', 'R$ 92,75'], ['Óleo de soja 900 ml', '3 CX · 03/11/2026', 'R$ 148,00']].map(([n, s, v]) => `<div class="lin linha"><div class="col"><b>${n}</b><span class="sub">${s}</span></div><b class="val">${v}</b></div>`).join('')}
    <div class="lin linha mais-itens"><span class="link">Ver os 20 itens</span>${ic('seta', 18, 2)}</div>
  </div>
  ${gestao ? '' : `${secao('Sugestão de mix')}
  <div class="card"><div class="lin linha"><div class="col"><b>Café torrado 500 g</b><span class="sub">Compra em clientes parecidos</span></div></div><div class="lin linha"><div class="col"><b>Açúcar cristal 5 kg</b><span class="sub">Compra em clientes parecidos</span></div></div></div>`}
  ${secao('Dados cadastrais')}
  <div class="card">
    ${[['CNPJ', '14.382.906/0001-27'], ['Razão social', 'Bom Preço Comércio de Alimentos Ltda'], ['Filial', 'Boa Vista · Matriz'], ['Segmento', 'Supermercado'], ['Cliente desde', '03/2019']].map(([r, v]) => `<div class="lin dado"><span class="rot">${r}</span><b>${v}</b></div>`).join('')}
  </div>
  ${secao('Contatos')}
  <div class="card">
    <div class="lin linha"><div class="col"><b>Antônio Ferreira</b><span class="sub">Comprador · principal</span></div><span class="mini">${ic('phone', 18)}</span><span class="mini">${ic('chat', 18)}</span></div>
    <div class="lin linha"><div class="col"><b>Luciana Souza</b><span class="sub">Financeiro</span></div><span class="mini">${ic('phone', 18)}</span><span class="mini">${ic('chat', 18)}</span></div>
  </div>
  ${secao('Endereços de entrega')}
  <div class="card">
    <div class="lin linha"><div class="col"><span class="linha g6"><b>Loja</b>${chip('Padrão', 'success')}</span><span class="sub">Av. Ville Roy, 1200 · Centro · 69301-000</span></div><span class="mini">${ic('mapa', 18)}</span></div>
    <div class="lin linha"><div class="col"><b>Depósito</b><span class="sub">R. Cecília Brasil, 455 · São Francisco</span></div><span class="mini">${ic('mapa', 18)}</span></div>
  </div>
  ${secao('Observações')}
  <div class="card"><div class="lin"><span class="corpo">Recebe das 7h às 11h. Descarga pela rua lateral.</span></div></div>`;
}

function linhaNF(n) {
  return `${n.mes ? `<div class="mes">${n.mes}</div>` : ''}<div class="lin nf linha" role="button" aria-label="NF ${n.nf}, ${n.valor}, ${n.st}">
    <div class="col"><span class="linha entre"><b>NF ${n.nf}</b><b class="val">${n.valor}</b></span>
    <span class="linha entre"><span class="sub">${n.data.slice(0, 5)} · ${n.forma}</span>${chip(n.st, TOM[n.st])}</span>
    ${n.venc ? `<span class="perigo">${n.venc}</span>` : ''}${n.extra ? `<span class="sub">${n.extra}</span>` : ''}</div>${ic('seta', 18, 2, ' style="color:#5B6673"')}</div>`;
}
// Bloco de crédito como no Novo pedido (RF-VEN, novo-pedido-itens.md §2.1): uma tabela compacta 2×2, valores em destaque.
const celula = (r, v) => `<div class="cel"><span class="rot">${r}</span><b>${v}</b></div>`;
const resumoFin = `<div class="card credito">${celula('Limite', 'R$ 8.000')}${celula('Crédito disponível', 'R$ 1.880')}${celula('Em aberto', 'R$ 6.120')}${celula('Prazo médio', '24 dias')}</div>`;
function barraFiltro(qtd = 0) {
  return `<div class="ferramentas linha" data-ancora="filtro"><span class="busca">${ic('busca', 20)}<span>Nº da NF</span></span><span class="bt-filtro" aria-label="Filtrar${qtd ? `, ${qtd} filtro aplicado` : ''}">${ic('filtro', 22, 2.2)}${qtd ? `<i>${qtd}</i>` : ''}</span></div>`;
}
function financeiro({ filtrado = false } = {}) {
  const lista = filtrado ? NFS.filter((n) => n.st === 'Em aberto') : NFS;
  // o mês aparece na primeira nota de cada mês da lista filtrada
  const vistos = new Set();
  const comMes = lista.map((n) => {
    const mes = NFS.slice(0, NFS.indexOf(n) + 1).reverse().find((x) => x.mes).mes;
    const r = { ...n, mes: vistos.has(mes) ? undefined : mes };
    vistos.add(mes);
    return r;
  });
  return `${ALERTA_TITULO}${resumoFin}${barraFiltro(filtrado ? 1 : 0)}
  ${filtrado ? `<div class="chips linha"><span class="chip-ap">Em aberto ${ic('x', 14, 2.4)}</span></div>` : ''}
  <div class="contagem">${filtrado ? '4 notas em aberto · últimos 90 dias' : '8 notas · últimos 90 dias'}</div>
  <div class="card">${comMes.map(linhaNF).join('')}</div>`;
}

function folhaFiltro() {
  const grupo = (t, ops, on) => `<div class="fgrupo"><span class="rot-f">${t}</span><div class="chips linha wrap">${ops.map((o) => `<span class="op${on.includes(o) ? ' on' : ''}">${on.includes(o) ? ic('check', 14, 2.6) : ''}${o}</span>`).join('')}</div></div>`;
  return `<div class="scrim"></div><div class="folha"><span class="pega"></span><div class="linha entre"><h2>Filtrar</h2>${ic('x', 24, 2)}</div>
  ${grupo('Período', ['30 dias', '90 dias', '12 meses', 'Escolher datas'], ['90 dias'])}
  ${grupo('Status', ['Em aberto', 'Pago', 'Devolvido', 'Devolvido parcial'], ['Em aberto'])}
  ${grupo('Forma de pagamento', ['Boleto', 'PIX', 'Cartão', 'Dinheiro'], [])}
  <div class="linha g8 botoes"><span class="btn sec f1">Limpar</span><span class="btn pri f2">Ver 4 notas</span></div></div>`;
}
function folhaNF() {
  const l = (r, v, cls = '') => `<div class="lin dado2 linha entre"><span class="rot2">${r}</span><b class="${cls}">${v}</b></div>`;
  return `<div class="scrim"></div><div class="folha"><span class="pega"></span><div class="linha entre"><div class="col"><h2>NF 004702</h2><span class="sub">24/10/2026 · pedido 000009</span></div>${ic('x', 24, 2)}</div>
  <div>${chip('Devolvido parcial', 'accent')}</div>
  <div class="card">${l('Valor da nota', 'R$ 2.870,00', 'val')}${l('Devolvido em 29/10', '− R$ 330,00', 'val')}${l('Valor final', 'R$ 2.540,00', 'val')}${l('Forma de pagamento', 'Boleto 7/14 dias')}</div>
  <span class="rot-f">Parcelas</span>
  <div class="card">
    <div class="lin linha entre"><div class="col"><b>1/2 · venceu 31/10</b><span class="sub">Paga em 31/10</span></div><span class="col dir"><b class="val">R$ 1.270,00</b>${chip('Pago', 'success')}</span></div>
    <div class="lin linha entre"><div class="col"><b>2/2 · venceu 07/11</b><span class="sub">Paga em 06/11</span></div><span class="col dir"><b class="val">R$ 1.270,00</b>${chip('Pago', 'success')}</span></div>
  </div>
  <span class="btn sec cheio">Ver itens da nota (12)</span></div>`;
}

// Documentação: documentos por tipo. `perfil`: 'vendedora' (Campo) ou 'supervisor' (Gestão).
function documentacao({ perfil = 'vendedora' } = {}) {
  const doc = (nome, meta, tranca = false, tom = null, chipTxt = null) =>
    `<div class="lin linha${tranca ? ' tranc' : ''}" ${tranca ? 'aria-disabled="true"' : 'role="button"'} aria-label="${nome}${tranca ? ', sem permissão para abrir' : ''}">${ic(tranca ? 'cadeado' : 'doc', 20, 1.9, ' style="color:' + (tranca ? '#5B6673' : '#1E3350') + '"')}<div class="col"><b>${nome}</b><span class="sub">${meta}</span></div>${chipTxt ? chip(chipTxt, tom) : ''}${tranca ? '' : ic('seta', 18, 2, ' style="color:#5B6673"')}</div>`;
  const sup = perfil === 'supervisor';
  return `${ALERTA_TITULO}
  ${secao('Fotos do PDV')}
  <div class="card">
    <div class="lin linha">${ic('foto', 20, 1.9, ' style="color:#1E3350"')}<div class="col"><b>Fachada</b><span class="sub">Foto · 12/11/2026</span></div>${ic('seta', 18, 2, ' style="color:#5B6673"')}</div>
    <div class="lin linha">${ic('foto', 20, 1.9, ' style="color:#5B6673"')}<div class="col"><b>Gôndola</b><span class="sub perigo">Falta</span></div>${sup ? '' : `<span class="adicionar">${ic('camera', 16, 2)}Adicionar</span>`}</div>
  </div>
  ${secao('Cadastro')}
  <div class="card">
    ${doc('Alvará de funcionamento', 'PDF · válido até 03/2027')}
    ${doc('Cartão CNPJ', 'PDF · 05/08/2026')}
    ${doc('Comprovante de endereço', 'PDF · 05/08/2026')}
  </div>
  ${secao('Contratos')}
  <div class="card">
    ${doc('Contrato de comodato nº 112', sup ? 'PDF · 18/06/2025' : 'Sem permissão para abrir', !sup)}
    ${sup ? doc('Contrato social', 'PDF · 22/03/2019') : ''}
  </div>`;
}
const docVazio = `${ALERTA_TITULO}<div class="vazio">${ic('doc', 40, 1.6)}<b>Nenhum documento deste cliente</b></div>`;
const folhaSemRede = `<div class="scrim"></div><div class="folha"><span class="pega"></span><div class="linha entre"><h2>Comprovante de endereço</h2>${ic('x', 24, 2)}</div>
  <div class="linha g8 aviso-rede">${ic('semRede', 22, 2)}<span class="corpo">Sem internet. Este arquivo ainda não está no aparelho.</span></div>
  <span class="btn pri cheio">Tentar de novo</span></div>`;

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
.g6{gap:6px}.g8{gap:8px}.wrap{flex-wrap:wrap}
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
h3{font-size:18px;font-weight:700;line-height:22px}
.alerta{display:flex;align-items:center;gap:10px;border-radius:14px;padding:6px 6px 6px 14px;min-height:60px}
.alerta.warning{background:#FFF1D6;color:#5C3B00}
.al-txt{flex:1;display:flex;flex-direction:column;gap:1px;min-width:0}
.al-txt b{font-size:16px;font-weight:600;line-height:20px}
.al-txt span{font-size:14px;line-height:18px}
.alerta .link{min-width:48px;height:48px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;color:#5C3B00;text-decoration:underline}
.acoes{gap:8px}
.acao{flex:1;height:64px;border-radius:12px;border:1px solid #C9CED5;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px}
.acao b{font-size:12px;font-weight:600}
.grade{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.stat{background:#fff;border:1px solid #DFE2E6;border-radius:14px;padding:10px 12px;display:flex;flex-direction:column;gap:2px;min-width:0}
.rot{font-size:12px;line-height:16px;color:#4A5562}
.num{font-size:18px;line-height:24px;font-weight:600;white-space:nowrap;overflow:hidden}
.chips{gap:6px}
.chip{display:inline-flex;align-items:center;height:24px;padding:0 10px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;flex-shrink:0}
.chip.success{color:#1D6B4F;background:#E2F1EA}.chip.warning{color:#7A4F00;background:#FFF1D6}.chip.danger{color:#A8261B;background:#FDE8E6}
.chip.neutral{color:#34404D;background:#ECEEF1}.chip.accent{color:#1E3350;background:#DFE2E6}
.card{background:#fff;border:1px solid #DFE2E6;border-radius:14px;overflow:hidden}
.lin{min-height:52px;padding:8px 6px 8px 14px;gap:10px;border-bottom:1px solid #ECEEF1}
.lin:last-child{border-bottom:0}
.col{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.col.dir{flex:0 0 auto;align-items:flex-end}
.col b,.dado b{font-size:16px;font-weight:600;line-height:20px}
.sub{font-size:14px;line-height:18px;color:#4A5562}
.val{font-size:16px;font-weight:600;white-space:nowrap;padding-right:8px}
.perigo{font-size:14px;line-height:18px;color:#A8261B;font-weight:600}
.mini{width:48px;height:48px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.mais-itens{justify-content:space-between;color:#1E3350;padding-right:14px}
.link{font-size:14px;font-weight:600;color:#1E3350}
.dado{display:flex;flex-direction:column;justify-content:center;gap:2px;padding-right:14px}
.corpo{font-size:16px;line-height:22px;padding-right:8px}
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
.contagem{font-size:14px;color:#4A5562;margin-top:-2px}
.mes{font-size:12px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:#4A5562;background:#F8F6F1;padding:8px 14px;border-bottom:1px solid #ECEEF1}
.nf{min-height:64px}
.credito{display:grid;grid-template-columns:1fr 1fr}
.cel{padding:8px 14px;display:flex;flex-direction:column;gap:1px;border-bottom:1px solid #ECEEF1}
.cel:nth-child(odd){border-right:1px solid #ECEEF1}
.cel:nth-child(n+3){border-bottom:0}
.cel b{font-size:16px;font-weight:600;line-height:20px}
.nf .col{gap:3px}
.nf .val{padding-right:0}
.scrim{position:absolute;inset:0;background:rgba(15,20,25,.45)}
.folha{position:absolute;left:0;right:0;bottom:0;background:#fff;border-radius:22px 22px 0 0;padding:10px 20px 20px;display:flex;flex-direction:column;gap:14px;max-height:92%}
.pega{align-self:center;width:40px;height:4px;border-radius:2px;background:#C9CED5}
.folha h2{font-size:22px;font-weight:700;line-height:28px}
.fgrupo{display:flex;flex-direction:column;gap:8px}
.rot-f{font-size:14px;font-weight:600;color:#4A5562}
.op{display:inline-flex;align-items:center;gap:6px;height:40px;padding:0 14px;border-radius:999px;border:1px solid #C9CED5;font-size:14px;font-weight:600;color:#16202A;background:#fff;white-space:nowrap}
.op.on{background:#DFE2E6;border-color:#DFE2E6;color:#1E3350}
.botoes{margin-top:4px}
.dado2{min-height:44px;padding:6px 14px;border-bottom:1px solid #ECEEF1}
.dado2:last-child{border-bottom:0}
.rot2{font-size:14px;color:#4A5562}
.dado2 b{font-size:16px;font-weight:600}
.dado2 .val{padding-right:0}
.tranc .col b{color:#4A5562}
.adicionar{display:inline-flex;align-items:center;gap:4px;min-height:48px;padding:0 8px;font-size:14px;font-weight:600;color:#1E3350;flex-shrink:0}
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
  '<b>Simulação, sem código (R-20261119-030234).</b> Campo, aba Resumo: junta o Resumo, o Cadastro e a Performance de hoje, nesta ordem: Alertas, contato, Compras (curvas e 4 indicadores da RN-CORE-40), Visitas, últimos itens, sugestão de mix, dados cadastrais, contatos, endereços e observações. O endereço fica só em Endereços de entrega; o código, o bairro e a cidade, na faixa. Dados fictícios.',
  [
    tela({ legenda: 'Resumo · topo', aba: 'Resumo', conteudo: resumo() }),
    tela({ legenda: 'Rolado: Performance de hoje', aba: 'Resumo', conteudo: resumo(), rolar: '#Visitas' }),
    tela({ legenda: 'Rolado: Cadastro de hoje', aba: 'Resumo', conteudo: resumo(), rolar: '#Dados cadastrais' }),
    tela({ legenda: 'Fim do Resumo', aba: 'Resumo', conteudo: resumo(), rolar: 'fim' }),
  ],
);

// ---------- 02: Campo · Financeiro ----------
const p02 = prancha(
  'Cliente 360 v2 · Campo · Financeiro',
  '<b>Simulação.</b> Aba Financeiro: limite, crédito, em aberto e prazo médio; depois as notas por data (mais recente primeiro), com Data, Nº NF, Valor, Forma de pagamento e Status em chip. Padrão: últimos 90 dias, todos os status (o padrão não conta no número do filtro). Cada linha abre a nota com as parcelas. O vencido fica só nos Alertas.',
  [
    tela({ legenda: 'Filtros fechados (padrão)', aba: 'Financeiro', conteudo: financeiro() }),
    tela({ legenda: 'Rolado: os quatro status', aba: 'Financeiro', conteudo: financeiro(), rolar: 'fim' }),
    tela({ legenda: 'Filtros abertos', aba: 'Financeiro', conteudo: financeiro(), sobre: folhaFiltro() }),
    tela({ legenda: 'Filtro aplicado: Em aberto', aba: 'Financeiro', conteudo: financeiro({ filtrado: true }), rolar: '#filtro' }),
    tela({ legenda: 'Toque na linha: a nota', aba: 'Financeiro', conteudo: financeiro(), sobre: folhaNF() }),
  ],
);

// ---------- 03: Campo · Documentação ----------
const p03 = prancha(
  'Cliente 360 v2 · Campo · Documentação',
  '<b>Simulação.</b> Aba Documentação, no lugar de Compras: os documentos do cliente por tipo (Fotos do PDV, Cadastro, Contratos). O tipo que o perfil não vê não aparece (aqui, Contrato social); o documento com exceção aparece com cadeado e não abre (a linha já diz o porquê; sem aviso extra). Estado vazio e arquivo ainda não baixado sem internet.',
  [
    tela({ legenda: 'Lista por tipo (vendedora)', aba: 'Documentação', conteudo: documentacao() }),
    tela({ legenda: 'Rolado: documento sem permissão', aba: 'Documentação', conteudo: documentacao(), rolar: 'fim' }),
    tela({ legenda: 'Estado vazio', aba: 'Documentação', conteudo: docVazio }),
    tela({ legenda: 'Sem internet, arquivo não baixado', aba: 'Documentação', conteudo: documentacao(), sobre: folhaSemRede, hora: '09:05' }),
  ],
);

// ---------- 04: Gestão ----------
const p04 = prancha(
  'Cliente 360 v2 · Gestão',
  '<b>Simulação.</b> O mesmo Cliente 360 no Gestão (supervisora, vinda de Equipe › Carla Lima). Muda: a vendedora da carteira no Resumo (ligar e WhatsApp para ela), a última visita com o nome de quem visitou, sem sugestão de mix e sem rodapé (sem check-in; o pedido em nome sai da ficha da vendedora, RF-GES-05). Na Documentação, o que o perfil Supervisor vê.',
  [
    tela({ legenda: 'Resumo · topo', voltar: 'Carla Lima', aba: 'Resumo', conteudo: resumo({ gestao: true }), rodape: '', barra: barraGestao() }),
    tela({ legenda: 'Resumo · rolado', voltar: 'Carla Lima', aba: 'Resumo', conteudo: resumo({ gestao: true }), rodape: '', barra: barraGestao(), rolar: '#Visitas' }),
    tela({ legenda: 'Documentação (supervisora)', voltar: 'Carla Lima', aba: 'Documentação', conteudo: documentacao({ perfil: 'supervisor' }), rodape: '', barra: barraGestao(), rolar: 'fim' }),
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
  ['02-campo-financeiro', p02.html, { width: p02.largura, height: 900 }],
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
