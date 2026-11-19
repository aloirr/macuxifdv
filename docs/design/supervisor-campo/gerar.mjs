// Simulação do supervisor em campo no app Gestão (T-0187, v1.0.16): rota com check-in e checkout, ficha do cliente com
// Check-in, Pesquisa e Novo pedido, e o pedido em nome do vendedor da carteira com a troca na aba Venda. Sem código de produção.
// Uso, a partir da raiz do repositório: node docs/design/supervisor-campo/gerar.mjs
// O gerador falha se: a nota de simulação cobrir um aparelho; um texto for cortado (largura maior que a caixa); um texto
// ficar a menos de 4 px da borda do aparelho; um elemento sair do aparelho pelos lados; um bloco fixo (status, faixa, abas,
// rodapé, barra, folha, diálogo, aviso) estourar a própria altura; ou dois itens da mesma linha se sobrepuserem.
// docs/design/_comum não existe no main de 19/11/2026: a abertura do Chromium e o laço de captura ficam aqui, como em
// docs/design/menu-parametros/gerar.mjs. O rastreamento do supervisor é interno (R-20261119-0546) e não aparece em nenhuma tela.
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '../../..');

// ---------- Ícones: lidos de packages/ui/src/mobile/icon.tsx (o mesmo desenho do app, sem cópia) ----------
const FONTE_ICONES = readFileSync(join(RAIZ, 'packages/ui/src/mobile/icon.tsx'), 'utf8');
const ICONES = (() => {
  const corpo = FONTE_ICONES.slice(FONTE_ICONES.indexOf('switch (name)'));
  const mapa = {};
  let pendentes = [];
  for (const p of corpo.split(/\n\s*case '/).slice(1)) {
    const nome = p.slice(0, p.indexOf("'"));
    const elementos = [...p.slice(p.indexOf(':') + 1).matchAll(/<(Path|Circle|Rect)\s([^>]*?)\{\.\.\.c\}\s*\/>/g)].map(
      ([, tag, attrs]) => `<${tag.toLowerCase()} ${attrs.replace(/(\w+)=\{([\d.]+)\}/g, '$1="$2"').trim()}/>`,
    );
    pendentes.push(nome);
    if (elementos.length) {
      for (const n of pendentes) mapa[n] = elementos.join('');
      pendentes = [];
    }
  }
  return mapa;
})();
function ic(nome, tam = 18, cor = 'currentColor', traco = 2) {
  if (!ICONES[nome]) throw new Error(`ícone sem desenho no kit: ${nome}`);
  return `<svg class="ic" width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="${cor}" stroke-width="${traco}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[nome]}</svg>`;
}

// ---------- Cores (packages/ui/src/mobile/tokens.ts e comum/contraste.ts) ----------
const COR = {
  ground: '#F8F6F1', ink: '#16202A', ink2: '#4A5562', ink3: '#5B6673', line: '#DFE2E6', lineSoft: '#ECEEF1', lineStrong: '#C9CED5',
  accent: '#1E3350', accentSoft: '#DFE2E6', accentTint: '#DFE2E6', grafico: '#C2540A', graficoEscuro: '#F59A52',
  faixaSub: '#C9CED5', faixaTrilho: '#3A4D68', success: '#1D6B4F', successBg: '#E2F1EA', warning: '#7A4F00', warningBg: '#FFF1D6',
  danger: '#A8261B', dangerBg: '#FDE8E6', neutralBg: '#ECEEF1', neutralInk: '#34404D',
};

// ---------- Dados da história: quinta, 19/11/2026, Boa Vista (RR), fuso de Manaus ----------
// Supervisor Marcos Dias; equipe: Carla Lima, Paulo Reis e João Melo (vendedores). Gerente: Rui Matos.
// Cliente Mercado Bom Preço (C5007), da carteira de Carla Lima; limite R$ 8.000,00, saldo disponível R$ 1.880,00 e uma NF
// em atraso (a 004655, Cliente 360 v2): o pedido mostra o alerta "Título vencido" e vai para aprovação.
// Pedido 000022 (3 itens, desconto geral de 8,0%, dentro da alçada do supervisor de 10%, RN-VEN-10):
// 1.290,00 + 320,00 + 144,00 = 1.754,00 de tabela; −8,0% → 1.186,80 + 294,40 + 132,48 = 1.613,68 (desconto R$ 140,32).
// Variante de 12,0% (acima da alçada do supervisor): 1.135,20 + 281,60 + 126,72 = 1.543,52 (desconto R$ 210,48).
const CLIENTE = { fantasia: 'Mercado Bom Preço', codigo: 'C5007', razao: 'Mercado Bom Preço Comércio de Alimentos Ltda', cnpj: '14.382.906/0001-27', rua: 'Av. Ville Roy, 1200', bairro: 'Centro', cidade: 'Boa Vista/RR' };
const ITENS = [
  { cod: '10231', emb: 'CX', fator: 'c/ 6', qtd: '10', tabela: '1.290,00', t8: '1.186,80', t12: '1.135,20' },
  { cod: '30507', emb: 'CX', fator: 'c/ 10', qtd: '2', tabela: '320,00', t8: '294,40', t12: '281,60' },
  { cod: '41020', emb: 'FD', fator: 'c/ 10', qtd: '2', tabela: '144,00', t8: '132,48', t12: '126,72' },
];
const EQUIPE = [
  { nome: 'Carla Lima', carteira: true },
  { nome: 'João Melo' },
  { nome: 'Paulo Reis' },
];

// ---------- Peças do aparelho (360×760 dp) ----------
const status = (hora) => `<div class="sb"><span>${hora}</span><span class="dir"><i class="sinal"></i><i class="bat"></i></span></div>`;
const sino = `<span class="sino" aria-label="Notificações">${ic('bell', 22, '#fff')}<i></i></span>`;
function cabecalho({ titulo, sub = '', voltar = '' }) {
  return `<header class="cab">${voltar ? `<div class="vt">${ic('back', 18, COR.faixaSub)}<span>${voltar}</span></div>` : ''}<div class="ln"><div class="tt"><h1>${titulo}</h1>${sub ? `<span class="sub">${sub}</span>` : ''}</div>${sino}</div></header>`;
}
// Barra do Gestão com a Rota (ponto em aberto P6, opção A recomendada: 6 posições, como o Campo da T-0170).
function barra(ativa) {
  const it = [['home', 'Início'], ['users', 'Equipe'], ['pin', 'Rota'], ['check', 'Aprovações'], ['users', 'Clientes'], ['alert', 'Alertas']];
  return `<nav class="barra linha">${it.map(([i, r]) => `<span class="bi${r === ativa ? ' on' : ''}">${ic(i, 22, r === ativa ? COR.accent : COR.ink2, r === ativa ? 2.2 : 1.8)}<b>${r}</b></span>`).join('')}</nav>`;
}
const rotulo = (t, cls = '') => `<div class="rs ${cls}"><span>${t}</span></div>`;
const badge = (t, tom) => `<span class="badge t-${tom}">${t}</span>`;
const rotuloValor = (linhas, cls = '') => `<div class="cartao ${cls}">${linhas.map(([r, v]) => `<div class="rv"><span class="r">${r}</span><span class="v">${v}</span></div>`).join('')}</div>`;
const alertas = (linhas) => `<div class="bloco">${rotulo('Alertas', 'al')}<div class="cartao">${linhas.map((t) => `<div class="alin linha">${ic('alert', 18, COR.danger)}<span>${t}</span></div>`).join('')}</div></div>`;
const suspensa = (rot, valor, { aberta = false, editado = false } = {}) =>
  `<div class="campo-b"><span class="rot">${rot}</span><div class="sel linha${aberta ? ' aberta' : ''}${editado ? ' editado' : ''}"><span>${valor}</span>${aberta ? `<span class="gira">${ic('abaixo', 18, COR.ink2)}</span>` : ic('abaixo', 18, COR.ink2)}</div></div>`;

// ---------- Rota (modules/core/app/telas/rota.tsx, hoje só no Campo) ----------
// st: done | next | in_progress | pending | locked
function linhaParada(p) {
  const num =
    p.st === 'done' ? `<span class="num" style="background:${COR.successBg}">${ic('check', 14, COR.success, 2.4)}</span>`
    : p.st === 'next' || p.st === 'in_progress' ? `<span class="num cheio" style="background:${p.st === 'in_progress' ? COR.accent : COR.ink}">${p.n}</span>`
    : `<span class="num vazio">${p.n}</span>`;
  const acao =
    p.st === 'done' ? ''
    : p.st === 'in_progress' ? '<span class="bt sec">Checkout</span>'
    : p.st === 'locked' ? `<span class="bt neu" aria-label="Check-in bloqueado em ${p.nome}">${ic('lock', 16, COR.ink3)}Check-in</span>`
    : '<span class="bt sec">Check-in</span>';
  return `<div class="pa linha${p.st === 'in_progress' ? ' ativa' : ''}">${num}<div class="c"><b${p.st === 'done' ? ` style="color:${COR.ink2}"` : ''}>${p.nome}</b><span${p.st === 'in_progress' ? ` style="color:${COR.accent}"` : ''}>${p.sub}</span></div>${acao}</div>`;
}
function mapa(feitas = 1, ir = 'Ir para a parada 2') {
  const P = [[40, 116], [100, 80], [168, 62], [230, 40], [290, 92]];
  const vias = `<path d="M-10 60 C80 40 140 90 220 70 S330 30 370 50" stroke="#fff" stroke-width="10" fill="none"/><path d="M40 -10 C60 70 30 140 70 230" stroke="#fff" stroke-width="8" fill="none"/><path d="M-10 170 C90 150 180 190 260 160 S340 140 370 150" stroke="#fff" stroke-width="8" fill="none"/><path d="M250 -10 C240 60 280 120 250 230" stroke="#fff" stroke-width="6" fill="none"/><path d="M150 -10 L170 230" stroke="#fff" stroke-width="5" fill="none"/>`;
  const pts = P.slice(0, 5);
  const feito = pts.slice(0, feitas + 1).map((p) => p.join(',')).join(' ');
  const resto = pts.slice(feitas).map((p) => p.join(',')).join(' ');
  const marca = ([x, y], i) =>
    i < feitas ? `<circle cx="${x}" cy="${y}" r="12" fill="${COR.success}"/><text x="${x}" y="${y + 4}" font-size="12" font-weight="600" fill="#fff" text-anchor="middle">${i + 1}</text>`
    : i === feitas ? `<circle cx="${x}" cy="${y}" r="16" fill="${COR.ink}" stroke="#fff" stroke-width="3"/><text x="${x}" y="${y + 5}" font-size="14" font-weight="600" fill="#fff" text-anchor="middle">${i + 1}</text>`
    : `<circle cx="${x}" cy="${y}" r="11" fill="#fff" stroke="${COR.ink}" stroke-width="2"/><text x="${x}" y="${y + 4}" font-size="12" font-weight="600" fill="${COR.ink}" text-anchor="middle">${i + 1}</text>`;
  return `<div class="mapa"><svg width="318" height="200" viewBox="0 0 350 220" preserveAspectRatio="none">${vias}</svg><svg width="318" height="200"><polyline points="${feito}" stroke="${COR.ink}" stroke-width="3" fill="none" stroke-linecap="round"/><polyline points="${resto}" stroke="${COR.accent}" stroke-width="3" stroke-dasharray="6 6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>${pts.map(marca).join('')}</svg>${ir ? `<span class="bt sec ir">${ic('navigate', 18, COR.ink)}${ir}</span>` : ''}</div>`;
}
const linhaFeitas = (n) => `<div class="lc linha"><span class="badge t-suc grande">${n} ${n === 1 ? 'feita' : 'feitas'}</span><span class="fbtn" aria-label="Filtrar">${ic('filtro', 20, COR.ink)}</span></div>`;

// Rota própria do supervisor (opção A): clientes das carteiras da equipe; a 2ª linha diz de quem é o cliente.
const ROTA_A = [
  { n: 1, nome: 'Comercial Paricarana', sub: 'Sem pedido: Estoque cheio', st: 'done' },
  { n: 2, nome: CLIENTE.fantasia, sub: '09:00 · Carla Lima', st: 'next' },
  { n: 3, nome: 'Supermercado Rio Branco', sub: '10:00 · Paulo Reis', st: 'pending' },
  { n: 4, nome: 'Mercearia Caçari', sub: '10:45 · Carla Lima', st: 'pending' },
  { n: 5, nome: 'Atacadão Norte', sub: '11:30 · João Melo', st: 'pending' },
];
function rotaA({ estado = 'antes', hora = '08:52' } = {}) {
  const paradas = ROTA_A.map((p) => {
    if (estado === 'antes') return p;
    if (p.n === 2) return estado === 'visita' ? { ...p, st: 'in_progress', sub: 'Check-in 09:18' } : { ...p, st: 'done', sub: 'Pedido R$ 1.614' };
    if (p.n > 2) return estado === 'visita' ? { ...p, st: 'locked' } : p.n === 3 ? { ...p, st: 'next' } : p;
    return p;
  });
  const feitas = estado === 'depois' ? 2 : 1;
  return {
    cab: cabecalho({ titulo: 'Rota de hoje', sub: '5 visitas · 22 km · Centro-Norte' }),
    corpo: `${linhaFeitas(feitas)}${mapa(feitas, estado === 'visita' ? '' : `Ir para a parada ${feitas + 1}`)}<div class="cartao lr">${paradas.map(linhaParada).join('')}</div>`,
    barra: barra('Rota'),
    hora,
  };
}
// Rota de um vendedor acompanhada pelo supervisor (opção B): a lista "Rota de" troca o vendedor; as paradas são as dele.
function rotaB() {
  const paradas = [
    { n: 1, nome: 'Padaria Pão da Serra', sub: 'Pedido R$ 640 · Carla Lima', st: 'done' },
    { n: 2, nome: CLIENTE.fantasia, sub: '09:00', st: 'next' },
    { n: 3, nome: 'Supermercado Rio Branco', sub: '10:00', st: 'pending' },
    { n: 4, nome: 'Mercearia Caçari', sub: '10:45', st: 'pending' },
  ];
  return {
    cab: cabecalho({ titulo: 'Rota de hoje', sub: '7 visitas · 38 km · Centro-Norte' }),
    corpo: `${suspensa('Rota de', 'Carla Lima')}${linhaFeitas(1)}${mapa(1)}<div class="cartao lr">${paradas.map(linhaParada).join('')}</div>`,
    barra: barra('Rota'),
    hora: '08:52',
  };
}
// Folha do checkout (components/visit-sheets.tsx), igual à do Campo.
const folhaCheckout = `<div class="scrim"></div><div class="folha"><span class="pega"></span>
  <div class="col g2"><span class="over">Checkout</span><h2>${CLIENTE.fantasia}</h2><span class="sub-f">Check-in desde 09:18 · duração 1 h 22 min</span></div>
  <b class="t16">Como terminou a visita?</b>
  <div class="op-v on col g2"><b>Com pedido</b><small class="tn">Pedido 000022 · R$ 1.613,68 feito nesta visita</small></div>
  <div class="op-v"><b>Sem pedido</b></div>
  <span class="bt pri">Concluir checkout</span><span class="bt txt">Continuar no atendimento</span></div>`;
const aviso = (t) => `<div class="aviso">${ic('check', 18, '#fff', 2.4)}<span>${t}</span></div>`;

// ---------- Ficha do cliente (Cliente 360 v2: Resumo, Histórico, Documentação) ----------
const abasFicha = (ativa = 'Resumo') => `<nav class="abas fixas linha">${['Resumo', 'Histórico', 'Documentação'].map((a) => `<span class="${a === ativa ? 'on' : ''}"><span>${a}</span></span>`).join('')}</nav>`;
const cabFicha = (voltar = 'Rota') => cabecalho({ titulo: CLIENTE.fantasia, sub: `${CLIENTE.codigo} · ${CLIENTE.bairro} · ${CLIENTE.cidade}`, voltar }) + abasFicha();
// Rodapé (o mesmo do Campo): Check-in ou Checkout, Pesquisa (com a licença) e Novo pedido (principal, com a ação pedido.criar_em_nome).
function rodapeFicha({ checkout = false, pesquisa = true, pedido = true } = {}) {
  return `<div class="rodape linha">${`<span class="bt sec f">${checkout ? 'Checkout' : 'Check-in'}</span>`}${pesquisa ? '<span class="bt sec f">Pesquisa</span>' : ''}${pedido ? '<span class="bt pri f2">Novo pedido</span>' : ''}</div>`;
}
const resumoTopo = (emVisita = false) =>
  `${emVisita ? `<div>${badge('Em atendimento · desde 09:18', 'des')}</div>` : ''}<h3>Dados cadastrais</h3>${rotuloValor([['Razão social', CLIENTE.razao], ['CNPJ', CLIENTE.cnpj], ['Filial', 'Boa Vista · Matriz'], ['Segmento', 'Supermercado'], ['Cliente desde', '03/2019']])}${rotuloValor([['Limite', 'R$ 8.000,00'], ['Saldo disponível', 'R$ 1.880,00'], ['Prazo médio', '24 dias']], 'larga')}`;
const folhaCheckin = `<div class="scrim"></div><div class="folha"><span class="pega"></span><div class="linha g12"><span class="ok">${ic('check', 18, COR.success, 2.4)}</span><h2 class="h18">Check-in às 09:18</h2></div><span class="bt txt">Continuar</span></div>`;

// ---------- Novo pedido (modules/vendedor/app/screens/new-order-screen.tsx) ----------
const cabPedido = () => cabecalho({ titulo: 'Novo pedido', sub: `${CLIENTE.fantasia} · cód. ${CLIENTE.codigo}`, voltar: 'Voltar' });
const abasPedido = (ativa) => `<nav class="abas linha">${[['venda', 'Venda'], ['itens', 'Itens (3)'], ['entrega', 'Entrega'], ['resumo', 'Resumo']].map(([id, r]) => `<span class="${id === ativa ? 'on' : ''}"><span>${r}</span></span>`).join('')}</nav>`;
// Menu ancorado da ListaSuspensa (componentes.md §4.1): opções de 48 dp, ✓ na marcada; a 2ª linha diz de quem é a carteira.
function menuVendedores(marcado) {
  return `<div class="menu-s" role="listbox" aria-label="Em nome de">${EQUIPE.map((v) => `<div class="op-s linha${v.nome === marcado ? ' on' : ''}" role="option" aria-selected="${v.nome === marcado}"><div class="col g2"><b>${v.nome}</b>${v.carteira ? '<small>Carteira deste cliente</small>' : ''}</div>${v.nome === marcado ? ic('check', 18, COR.accent, 2.4) : ''}</div>`).join('')}</div>`;
}
function venda({ vendedor = 'Carla Lima', aberta = false, editado = false } = {}) {
  return [
    `<div class="ancora">${suspensa('Em nome de', vendedor, { aberta, editado })}${aberta ? menuVendedores(vendedor) : ''}</div>`,
    `<div class="bloco">${rotulo('Cliente')}${rotuloValor([['Endereço', `${CLIENTE.rua} · ${CLIENTE.bairro} · ${CLIENTE.cidade}`], ['CNPJ', CLIENTE.cnpj]])}</div>`,
    `<div class="linha g8 topo-a">${suspensa('Forma de pagamento', 'Boleto')}${suspensa('Prazo', '28/56 dias')}</div>`,
    `<div class="bloco">${rotulo('Crédito do cliente')}<div class="cartao">${[['Limite', 'R$ 8.000,00'], ['Disponível', 'R$ 1.880,00']].map(([r, v]) => `<div class="tv linha"><span class="r">${r}</span><span class="v">${v}</span></div>`).join('')}</div><div class="tv-rod linha">${ic('sync', 14, COR.ink2)}<span>Atualizado hoje às 09:05</span></div></div>`,
    '<span class="bt pri">Avançar</span>',
  ].join('');
}
function tabelaItens(pct = 8) {
  const cab = `<div class="cb linha"><span class="cod">Código</span><span class="e">Emb.</span><span class="q">Qtd</span><span class="t">Valor tabela</span><span class="a">Desc./ Acrésc.</span><span class="to">Total</span><span class="lp"></span></div>`;
  const linhas = ITENS.map((i) => `<div class="li linha"><span class="cod"><a>${i.cod}</a></span><span class="e">${i.emb}<small>${i.fator}</small></span><span class="q">${i.qtd}</span><span class="t">${i.tabela}</span><span class="a">−${pct},0%</span><span class="to">${pct === 8 ? i.t8 : i.t12}</span><span class="lapis">${ic('edit', 16, COR.accent)}</span></div>`).join('');
  return `<div class="cartao ti">${cab}${linhas}</div>`;
}
const totais = (pct = 8) =>
  `<div class="cartao">${[['Valor de tabela', 'R$ 1.754,00'], ['Desconto (%)', `${pct},0%`], ['Desconto (R$)', pct === 8 ? '− R$ 140,32' : '− R$ 210,48']].map(([r, v]) => `<div class="tt linha"><span class="r">${r}</span><span class="v">${v}</span></div>`).join('')}<div class="tt fim linha"><span class="r">Valor final</span><span class="v">${pct === 8 ? 'R$ 1.613,68' : 'R$ 1.543,52'}</span></div></div>`;
// Resumo: o bloco "Condição de pagamento" vira "Venda", com "Em nome de" na primeira linha (pedido-v4 §4).
function resumoTopo2({ vendedor = 'Carla Lima', pct = 8 } = {}) {
  const al = pct > 10 ? ['Título vencido', 'Desconto acima da sua alçada'] : ['Título vencido'];
  return [
    alertas(al),
    `<div class="bloco">${rotulo('Cliente')}${rotuloValor([['Razão social', CLIENTE.razao], ['CNPJ', CLIENTE.cnpj]])}</div>`,
    `<div class="bloco">${rotulo('Venda')}${rotuloValor([['Em nome de', `<b>${vendedor}</b>`], ['Forma', 'Boleto'], ['Prazo', '28/56 dias']])}</div>`,
    `<div class="bloco">${rotulo('Itens')}${tabelaItens(pct)}</div>`,
  ].join('');
}
const resumoFim = (pct = 8) =>
  [
    `<div class="bloco">${rotulo('Entrega')}${rotuloValor([['Frete', 'CIF'], ['Endereço', `${CLIENTE.rua} · ${CLIENTE.bairro} · ${CLIENTE.cidade}`]])}</div>`,
    `<div class="bloco">${rotulo('Totais')}${totais(pct)}</div>`,
    '<div class="bloco g10"><span class="bt pri">Salvar e enviar pedido</span><div class="linha g8"><span class="bt sec alto f">Apenas salvar</span><span class="bt sec alto f">Salvar como orçamento</span></div><span class="bt txt">Cancelar</span></div>',
  ].join('');
const dialogoAprovacao = `<div class="scrim"></div><div class="dlg"><h2>Enviar para aprovação?</h2><div class="bts linha"><span class="bt lnk">Voltar</span><span class="bt pri curto">Enviar</span></div></div>`;
// Detalhe do pedido (pedido-v4 §2): no Gestão, a linha Vendedor; o autor aparece na tag porque não é o vendedor (RN-VEN-30).
function detalhePedido() {
  const linhas = ITENS.map((i) => `<div class="li linha"><span class="cod"><a>${i.cod}</a></span><span class="e">${i.emb}<small>${i.fator}</small></span><span class="q">${i.qtd}</span><span class="t">${i.tabela}</span><span class="a">−8,0%</span><span class="to">${i.t8}</span></div>`).join('');
  const cab = `<div class="cb linha"><span class="cod">Código</span><span class="e">Emb.</span><span class="q">Qtd</span><span class="t">Valor tabela</span><span class="a">Desc./ Acrésc.</span><span class="to">Total</span></div>`;
  return [
    rotuloValor([['Vendedor', 'Carla Lima'], ['Pagamento', 'Boleto · 28/56 dias'], ['Entrega', `CIF · ${CLIENTE.rua}`]]),
    `<div class="bloco">${rotulo('Itens (3)')}<div class="cartao ti">${cab}${linhas}</div></div>`,
    totais(8),
    `<div class="bloco">${rotulo('Histórico')}<div class="hist">${badge('Salvo · 19/11 10:38', 'neu')}${badge('Enviado · Marcos Dias · 19/11 10:40', 'neu')}${badge('Em aprovação · Inadimplente', 'des')}</div></div>`,
  ].join('');
}

// ---------- Tela e prancha ----------
function tela({ legenda, hora = '09:02', cab = '', corpo = '', classe = '', rodape = '', barra: b = '', sobre = '', rolar = 0 }) {
  return `<figure class="col-ap"><figcaption>${legenda}</figcaption><div class="tela">${status(hora)}${cab}<main class="corpo ${classe}" data-rolar="${rolar}"><div class="pilha">${corpo}</div></main>${rodape}${b}${sobre}</div></figure>`;
}

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Roboto,Inter,system-ui,'Segoe UI',-apple-system,sans-serif;background:${COR.ground};color:${COR.ink};padding:28px 32px 32px;display:flex;flex-direction:column;gap:20px;-webkit-font-smoothing:antialiased}
svg text{font-family:Roboto,Inter,system-ui,sans-serif}
.tn,.v,.to,.t,.q,.a,.tt .v,.tv .v{font-variant-numeric:tabular-nums}
.nota{font-size:14px;line-height:1.45;color:${COR.neutralInk};background:#fff;border:1px solid ${COR.line};border-left:4px solid ${COR.accent};border-radius:8px;padding:10px 14px;box-shadow:0 4px 12px rgba(22,32,42,.08)}
.nota b{color:${COR.ink}}
.fila{display:flex;gap:32px;align-items:flex-start}
.col-ap{display:flex;flex-direction:column;gap:10px;width:360px}
figcaption{font-size:16px;font-weight:700;text-align:center;line-height:1.3;min-height:42px;display:flex;align-items:center;justify-content:center}
.tela{width:360px;height:760px;border-radius:28px;overflow:hidden;background:${COR.ground};border:1px solid ${COR.lineStrong};box-shadow:0 10px 28px rgba(22,32,42,.14);display:flex;flex-direction:column;position:relative}
.ic{flex:none;display:block}
.linha{display:flex;align-items:center}
.col{display:flex;flex-direction:column;min-width:0}
.g2{gap:2px}.g8{gap:8px}.g10{gap:10px}.g12{gap:12px}
.sb{height:24px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 20px;font-size:13px;font-weight:500;background:${COR.accent};color:#fff;font-variant-numeric:tabular-nums}
.sb .dir{display:flex;gap:6px;align-items:center}
.sinal{display:block;width:14px;height:10px;background:linear-gradient(90deg,#fff 0 3px,transparent 3px 5px,#fff 5px 8px,transparent 8px 10px,#fff 10px);clip-path:polygon(0 100%,100% 0,100% 100%)}
.bat{display:block;width:20px;height:10px;border:1.5px solid #fff;border-radius:3px;box-shadow:inset 0 0 0 1.5px ${COR.accent},inset 14px 0 0 #fff}
.cab{background:${COR.accent};padding:8px 20px 16px;flex:none}
.cab .vt{display:flex;align-items:center;gap:4px;height:32px;color:${COR.faixaSub};font-size:14px;font-weight:500;margin-left:-4px}
.cab .ln{display:flex;align-items:center;gap:8px}
.cab .tt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.cab h1{font-size:22px;line-height:28px;font-weight:700;color:#fff}
.cab .sub{font-size:14px;line-height:18px;color:${COR.faixaSub}}
.sino{width:48px;height:48px;border-radius:12px;border:1px solid ${COR.faixaTrilho};display:flex;align-items:center;justify-content:center;position:relative;flex:none}
.sino i{position:absolute;top:10px;right:10px;width:12px;height:12px;border-radius:6px;background:${COR.graficoEscuro};border:2px solid ${COR.accent}}
.abas{flex:none;background:${COR.ground};border-bottom:1px solid ${COR.line}}
.abas>span{flex:1;min-height:48px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:500;color:${COR.ink2};border-bottom:3px solid transparent;margin-bottom:-1px;white-space:nowrap}
.abas>span.on{font-weight:600;color:${COR.ink};border-bottom-color:${COR.accent}}
.abas.fixas>span{flex:1 1 auto;padding:0 10px;font-size:16px;font-weight:400}
.abas.fixas>span.on{font-weight:600}
.corpo{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;position:relative}
.corpo::-webkit-scrollbar{display:none}
.pilha{padding:16px 20px 20px;display:flex;flex-direction:column;gap:14px}
.np .pilha{padding:12px 12px 16px;gap:12px}
.pilha>*{flex:none}
h3{font-size:18px;font-weight:700;line-height:22px}
.rs{display:flex;align-items:center;min-height:20px}
.rs span{font-size:12px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:${COR.ink2}}
.rs.al span{color:${COR.danger}}
.bloco{display:flex;flex-direction:column;gap:6px}
.cartao{background:#fff;border:1px solid ${COR.line};border-radius:14px;overflow:hidden}
.rv{display:flex;gap:12px;padding:10px 12px;min-height:44px;align-items:center}
.rv+.rv{border-top:1px solid ${COR.lineSoft}}
.rv .r{width:92px;flex:none;font-size:14px;line-height:19px;color:${COR.ink2}}
.larga .rv .r{width:136px}
.rv .v{flex:1;min-width:0;font-size:14px;line-height:19px}
.rv .v b{font-weight:600}
.alin{gap:10px;min-height:44px;padding:8px 12px;font-size:14px;line-height:19px}
.alin+.alin{border-top:1px solid ${COR.lineSoft}}
.alin span{flex:1}
.badge{display:inline-flex;align-self:flex-start;align-items:center;min-height:24px;padding:0 10px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.badge.grande{min-height:28px;padding:0 12px;font-size:14px}
.t-suc{color:${COR.success};background:${COR.successBg}}.t-av{color:${COR.warning};background:${COR.warningBg}}
.t-err{color:${COR.danger};background:${COR.dangerBg}}.t-neu{color:${COR.neutralInk};background:${COR.neutralBg}}
.t-des{color:${COR.accent};background:${COR.accentSoft}}
.bt{display:flex;align-items:center;justify-content:center;gap:6px;padding:0 14px;font-weight:600;text-align:center;white-space:nowrap}
.bt.pri{height:52px;border-radius:14px;background:${COR.accent};color:#fff;font-size:16px}
.bt.sec{min-height:44px;border-radius:12px;background:#fff;color:${COR.ink};border:1.5px solid ${COR.ink};font-size:14px}
.bt.sec.alto{min-height:52px;line-height:18px;white-space:normal}
.bt.neu{min-height:44px;border-radius:12px;background:${COR.lineSoft};color:${COR.ink3};font-size:14px;padding:0 12px}
.bt.txt{min-height:48px;color:${COR.ink2};font-size:14px}
.bt.lnk{height:44px;color:${COR.accent};font-size:14px}
.bt.pri.curto{height:44px;border-radius:12px;font-size:14px;padding:0 20px}
.f{flex:1 1 0;min-width:0}.f2{flex:1.4 1 0;min-width:0}
.fbtn{width:48px;height:48px;border-radius:10px;border:1px solid ${COR.line};background:#fff;display:flex;align-items:center;justify-content:center;flex:none}
.lc{justify-content:space-between}
.mapa{height:200px;border-radius:18px;overflow:hidden;background:${COR.neutralBg};border:1px solid ${COR.lineStrong};position:relative}
.mapa svg{position:absolute;inset:0}
.ir{position:absolute;left:12px;bottom:12px}
.pa{gap:10px;padding:8px 12px 8px 14px;min-height:60px}
.pa+.pa{border-top:1px solid ${COR.lineSoft}}
.pa.ativa{background:${COR.accentTint}}
.num{width:28px;height:28px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex:none}
.num.cheio{color:#fff;font-size:14px}
.num.vazio{background:#fff;border:2px solid ${COR.ink}}
.pa .c{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.pa .c b{font-size:16px;font-weight:600;line-height:20px}
.pa .c span{font-size:12px;line-height:16px;color:${COR.ink2}}
.pa .bt{flex:none;padding:0 12px}
.campo-b{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
.campo-b .rot{font-size:12px;font-weight:600;color:${COR.ink2}}
.sel{min-height:48px;justify-content:space-between;gap:6px;padding:0 12px;border-radius:10px;border:1px solid ${COR.lineStrong};background:#fff;font-size:16px;font-weight:600}
.sel.aberta,.sel.editado{border:2px solid ${COR.accent};padding:0 11px}
.topo-a{align-items:flex-start}
.ancora{position:relative;z-index:3}
.menu-s{position:absolute;left:0;right:0;top:76px;background:#fff;border:1px solid ${COR.line};border-radius:12px;box-shadow:0 8px 20px rgba(15,20,25,.18);overflow:hidden;z-index:4}
.gira{transform:rotate(180deg)}
.op-s{min-height:48px;padding:6px 14px;justify-content:space-between;gap:8px}
.op-s+.op-s{border-top:1px solid ${COR.lineSoft}}
.op-s b{font-size:16px;font-weight:600;line-height:20px}
.op-s small{font-size:12px;line-height:16px;color:${COR.ink2}}
.op-s.on{background:${COR.accentSoft}}
.op-s.on b{color:${COR.accent}}
.tv{justify-content:space-between;gap:12px;min-height:48px;padding:8px 14px}
.tv+.tv{border-top:1px solid ${COR.lineSoft}}
.tv .r{font-size:14px;color:${COR.ink2}}
.tv .v{font-size:18px;font-weight:600}
.tv-rod{gap:6px;font-size:12px;color:${COR.ink2}}
.ti .cb,.ti .li{gap:4px;padding:0 8px}
.ti .cb{padding-top:10px;padding-bottom:6px;align-items:flex-end}
.ti .li{min-height:44px;border-top:1px solid ${COR.lineSoft}}
.ti .cb span{font-size:12px;font-weight:600;color:${COR.ink2};text-align:right;line-height:15px}
.ti .cod{width:44px;flex:none;text-align:left!important}
.ti .cod a{font-family:'Roboto Mono','JetBrains Mono',ui-monospace,monospace;font-size:12px;color:${COR.accent};text-decoration:underline}
.ti .e{flex:26 1 0;min-width:0;text-align:right}.ti .q{flex:20 1 0;min-width:0;text-align:right}.ti .t{flex:50 1 0;min-width:0;text-align:right}
.ti .a{flex:42 1 0;min-width:0;text-align:right}.ti .to{flex:64 1 0;min-width:0;text-align:right}.ti .lp,.ti .lapis{width:32px;flex:none}
.ti .li span{font-size:12px}
.ti .li .e{display:flex;flex-direction:column;align-items:flex-end;line-height:15px;padding:8px 0}
.ti .li .e small{font-size:12px;color:${COR.ink2}}
.ti .li .to{font-size:14px;font-weight:600}
.lapis{height:32px;border-radius:9px;border:1.5px solid ${COR.accent};background:${COR.accentSoft};display:flex;align-items:center;justify-content:center}
.tt{justify-content:space-between;padding:12px 14px;min-height:48px}
.tt+.tt{border-top:1px solid ${COR.lineSoft}}
.tt .r{font-size:14px;color:${COR.ink2}}.tt .v{font-size:16px;font-weight:600}
.tt.fim{border-top:1px solid ${COR.line}}
.tt.fim .r{font-size:16px;font-weight:600;color:${COR.ink}}.tt.fim .v{font-size:22px}
.hist{display:flex;flex-wrap:wrap;gap:6px}
.rodape{flex:none;gap:6px;padding:8px 20px;background:${COR.ground};border-top:1px solid ${COR.line}}
.rodape .bt{height:48px;min-height:48px;padding:0 6px;font-size:14px}
.rodape .bt.sec{border-radius:12px}
.rodape .bt.pri{border-radius:12px}
.barra{height:64px;flex:none;background:#fff;border-top:1px solid ${COR.line}}
.barra .bi{flex:1 1 auto;min-width:0;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:${COR.ink2}}
.barra .bi b{font-size:12px;font-weight:600;white-space:nowrap}
.barra .bi.on{color:${COR.accent}}
.scrim{position:absolute;inset:0;background:rgba(15,20,25,.45);z-index:10}
.folha{position:absolute;left:0;right:0;bottom:0;background:#fff;border-radius:22px 22px 0 0;padding:10px 20px 16px;z-index:11;display:flex;flex-direction:column;gap:12px;box-shadow:0 -4px 16px rgba(15,20,25,.18)}
.pega{width:40px;height:4px;border-radius:2px;background:${COR.lineStrong};align-self:center}
.folha h2{font-size:22px;line-height:28px;font-weight:700}
.folha h2.h18{font-size:18px;line-height:24px}
.over{font-size:12px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:${COR.ink2}}
.sub-f{font-size:14px;line-height:19px;color:${COR.ink2}}
.t16{font-size:16px;font-weight:600}
.op-v{min-height:52px;border-radius:12px;border:1px solid ${COR.lineStrong};padding:8px 14px;display:flex;flex-direction:column;justify-content:center}
.op-v b{font-size:16px;font-weight:600}
.op-v small{font-size:12px;color:${COR.ink2}}
.op-v.on{border:2px solid ${COR.success};background:${COR.successBg};padding:7px 13px}
.ok{width:40px;height:40px;border-radius:12px;background:${COR.successBg};display:flex;align-items:center;justify-content:center;flex:none}
.dlg{position:absolute;left:24px;right:24px;top:50%;transform:translateY(-50%);background:#fff;border-radius:20px;padding:24px 20px 16px;display:flex;flex-direction:column;gap:12px;z-index:11;box-shadow:0 4px 10px rgba(15,20,25,.2)}
.dlg h2{font-size:22px;line-height:28px;font-weight:700}
.dlg .bts{justify-content:flex-end;gap:8px}
.aviso{position:absolute;left:16px;right:16px;bottom:76px;z-index:9;background:${COR.ink};color:#fff;border-radius:12px;padding:12px 14px;display:flex;align-items:flex-start;gap:10px;font-size:14px;line-height:19px;box-shadow:0 6px 16px rgba(15,20,25,.25)}
.aviso span{flex:1}
`;

// Checagens no navegador (depois das fontes): rola cada aparelho e grava os problemas em body[data-info].
const SCRIPT = `<script>document.fonts.ready.then(()=>{
for(const c of document.querySelectorAll('.corpo')){const r=c.dataset.rolar;c.scrollTop=r==='fim'?c.scrollHeight:Number(r||0);}
const p=[];
const nome=(e)=>(e instanceof SVGElement?'svg':e.tagName.toLowerCase()+'.'+e.className)+' "'+(e.textContent||'').trim().slice(0,32)+'"';
const notas=[...document.querySelectorAll('.nota')].map(n=>n.getBoundingClientRect());
for(const t of document.querySelectorAll('.tela')){const T=t.getBoundingClientRect();
 for(const n of notas){if(n.left<T.right&&n.right>T.left&&n.top<T.bottom&&n.bottom>T.top)p.push('nota cobre aparelho');}
 for(const e of t.querySelectorAll('*')){if(e instanceof SVGElement&&!(e instanceof SVGSVGElement))continue;const r=e.getBoundingClientRect();if(!r.width||!r.height)continue;
  if(!e.closest('.scrim')&&(r.left<T.left-0.5||r.right>T.right+0.5))p.push('sai do aparelho: '+nome(e));
  if(!(e instanceof SVGElement)&&e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).overflowX!=='visible'&&!e.matches('.corpo,.cartao,.tela,.mapa'))p.push('texto cortado: '+nome(e));
  if(!(e instanceof SVGElement)&&e.children.length===0&&e.textContent.trim()){if(r.left<T.left+4||r.right>T.right-4)p.push('texto colado na borda: '+nome(e));if(e.scrollWidth>Math.ceil(r.width)+1)p.push('texto cortado: '+nome(e));}}
 for(const f of t.querySelectorAll('.sb,.cab,.abas,.rodape,.barra,.folha,.dlg,.aviso,.menu-s')){const F=f.getBoundingClientRect();for(const e of f.querySelectorAll('*')){const r=e.getBoundingClientRect();if(!r.height)continue;if(r.bottom>F.bottom+0.5||r.top<F.top-0.5||r.right>F.right+0.5||r.left<F.left-0.5)p.push('estoura '+f.className+': '+nome(e));}}
 for(const l of t.querySelectorAll('.linha')){const k=[...l.children].map(x=>x.getBoundingClientRect()).filter(r=>r.width&&r.height);for(let i=0;i<k.length;i++)for(let j=i+1;j<k.length;j++){const a=k[i],b=k[j];if(a.left<b.right-0.5&&a.right>b.left+0.5&&a.top<b.bottom-0.5&&a.bottom>b.top+0.5)p.push('sobreposição na linha: '+nome(l));}}
}
document.body.dataset.info=JSON.stringify(p);document.body.dataset.pronto='1';});</script>`;

function prancha(titulo, nota, telas) {
  const largura = 64 + telas.length * 360 + (telas.length - 1) * 32;
  return { largura, html: `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${titulo}</title><style>${CSS}body{width:${largura}px}</style><body><div class="nota">${nota}</div><div class="fila">${telas.join('')}</div>${SCRIPT}</body></html>` };
}

// ---------- 01: Rota com check-in e checkout ----------
const p01 = prancha(
  'Supervisor em campo · Rota',
  '<b>Simulação, sem código (T-0187).</b> Rota do supervisor (Marcos Dias) no app Gestão, com a mesma lista, mapa, check-in único e checkout do Campo (RN-CORE-13). <b>A:</b> rota própria, com clientes das carteiras da equipe; a 2ª linha da parada diz o horário e de quem é o cliente. <b>B:</b> acompanha a rota de um vendedor, escolhido em "Rota de". Recomendação: A (ponto P1). Em visita, os outros check-ins ficam com cadeado, como no Campo. Barra com a Rota em 6 posições (ponto P6). O rastreamento é interno e não aparece em nenhuma tela. Dados fictícios.',
  [
    tela({ legenda: 'A · rota própria (recomendada)', ...rotaA() }),
    tela({ legenda: 'B · acompanha a rota de um vendedor', ...rotaB() }),
    tela({ legenda: 'A · em visita: Checkout na parada', ...rotaA({ estado: 'visita', hora: '09:31' }) }),
    tela({ legenda: 'Checkout, igual ao do Campo', ...rotaA({ estado: 'visita', hora: '10:40' }), sobre: folhaCheckout }),
    tela({ legenda: 'Depois do checkout', ...rotaA({ estado: 'depois', hora: '10:41' }), sobre: aviso(`Checkout feito em ${CLIENTE.fantasia}. Check-in liberado para o próximo cliente.`) }),
  ],
);

// ---------- 02: Ficha do cliente com o rodapé ----------
const p02 = prancha(
  'Supervisor em campo · Ficha do cliente',
  '<b>Simulação.</b> A ficha do Gestão é o Cliente 360 v2 (Resumo, Histórico e Documentação; <code>docs/design/cliente-360-v2/spec.md</code>, com a tabela Carteira e "Visitada por" do Gestão) e passa a ter o rodapé do Campo: <b>Check-in · Pesquisa · Novo pedido</b> (muda o P13 daquela spec, que era "sem rodapé"). Depois do check-in, a ficha mostra "Em atendimento" e o rodapé troca Check-in por Checkout, como no Campo. Sem a licença de Pesquisa, o botão some; sem a permissão de pedido em nome, "Novo pedido" some.',
  [
    tela({ legenda: 'Fora de visita (aberta da Rota)', cab: cabFicha(), corpo: resumoTopo(), rodape: rodapeFicha(), barra: barra('Rota') }),
    tela({ legenda: 'Check-in feito', hora: '09:18', cab: cabFicha(), corpo: resumoTopo(true), rodape: rodapeFicha({ checkout: true }), barra: barra('Rota'), sobre: folhaCheckin }),
    tela({ legenda: 'Em visita: Checkout no rodapé', hora: '09:20', cab: cabFicha(), corpo: resumoTopo(true), rodape: rodapeFicha({ checkout: true }), barra: barra('Rota') }),
    tela({ legenda: 'Sem a licença de Pesquisa', cab: cabFicha('Clientes'), corpo: resumoTopo(), rodape: rodapeFicha({ pesquisa: false }), barra: barra('Clientes') }),
  ],
);

// ---------- 03: Novo pedido · aba Venda ----------
const p03 = prancha(
  'Supervisor em campo · Novo pedido · Venda',
  '<b>Simulação.</b> Novo pedido aberto da ficha: o mesmo do Campo, com o campo <b>"Em nome de"</b> no topo da aba Venda (<code>ListaSuspensa</code>), preenchido com o vendedor da carteira do cliente. A lista traz só os vendedores ativos da equipe do supervisor (RN-CORE-04), em ordem alfabética; a 2ª linha marca quem tem o cliente na carteira. Trocar muda só o dono do pedido: preço, forma, prazo e crédito são do cliente e não mudam; a alçada e os limites são os do supervisor (RN-VEN-10 e RN-VEN-11a). O nome escolhido aparece no Resumo ("Em nome de").',
  [
    tela({ legenda: 'Vendedor da carteira preenchido', hora: '09:31', cab: cabPedido() + abasPedido('venda'), classe: 'np', corpo: venda(), barra: barra('Rota') }),
    tela({ legenda: 'Lista aberta: a equipe do supervisor', hora: '09:31', cab: cabPedido() + abasPedido('venda'), classe: 'np', corpo: venda({ aberta: true }), barra: barra('Rota') }),
    tela({ legenda: 'Trocado para Paulo Reis', hora: '09:32', cab: cabPedido() + abasPedido('venda'), classe: 'np', corpo: venda({ vendedor: 'Paulo Reis' }), barra: barra('Rota') }),
    tela({ legenda: 'Efeito no Resumo: "Em nome de"', hora: '09:38', cab: cabPedido() + abasPedido('resumo'), classe: 'np', corpo: resumoTopo2({ vendedor: 'Paulo Reis' }), barra: barra('Rota') }),
  ],
);

// ---------- 04: Resumo e envio ----------
const p04 = prancha(
  'Supervisor em campo · Resumo e envio',
  '<b>Simulação.</b> Pedido em nome de Carla Lima, com desconto de 8,0%: acima da alçada da vendedora (5%) e dentro da do supervisor (10%), por isso não há alerta de alçada (RN-VEN-10: o pedido feito pelo gestor usa a alçada do gestor). O "Título vencido" leva o pedido à aprovação do gerente (ponto P4). Com 12,0%, entra "Desconto acima da sua alçada" nos Alertas (RN-VEN-42) e o pedido também vai ao gerente. No detalhe, a linha Vendedor e o autor na tag "Enviado" (RN-VEN-30).',
  [
    tela({ legenda: 'Resumo: "Em nome de Carla Lima"', hora: '09:38', cab: cabPedido() + abasPedido('resumo'), classe: 'np', corpo: resumoTopo2(), barra: barra('Rota') }),
    tela({ legenda: 'Fim do Resumo: 8,0%, na alçada', hora: '09:39', cab: cabPedido() + abasPedido('resumo'), classe: 'np', corpo: resumoTopo2() + resumoFim(8), barra: barra('Rota'), rolar: 'fim' }),
    tela({ legenda: 'Título vencido: vai ao gerente', hora: '09:40', cab: cabPedido() + abasPedido('resumo'), classe: 'np', corpo: resumoTopo2() + resumoFim(8), barra: barra('Rota'), sobre: dialogoAprovacao, rolar: 'fim' }),
    tela({ legenda: 'Com 12,0%: acima da alçada', hora: '09:38', cab: cabPedido() + abasPedido('resumo'), classe: 'np', corpo: resumoTopo2({ pct: 12 }), barra: barra('Rota') }),
    tela({ legenda: 'Detalhe rolado: o autor no Histórico', hora: '10:42', cab: cabecalho({ titulo: 'Pedido 000022', sub: `${CLIENTE.fantasia} · cód. ${CLIENTE.codigo}`, voltar: 'Pedidos' }), classe: 'np', corpo: detalhePedido(), barra: barra('Rota'), rolar: 'fim' }),
  ],
);

const TELAS = [
  ['01-rota', p01],
  ['02-ficha-cliente', p02],
  ['03-novo-pedido-venda', p03],
  ['04-resumo-e-envio', p04],
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
let falhou = false;
for (const [nome, { html, largura }] of TELAS) {
  const page = await browser.newPage({ viewport: { width: largura, height: 900 }, deviceScaleFactor: 2 });
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
  console.error('Falha: nota cobrindo aparelho, texto cortado ou colado na borda, elemento fora do aparelho, bloco fixo estourado ou sobreposição.');
  process.exit(1);
}
