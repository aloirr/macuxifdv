// Começo do dia da Carla (Macuxi Campo): abertura, Início, Rota, Clientes, ficha do cliente (5 abas) e check-in.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { badge, barraAbas, barraDeStatus, busca, cabecalho, COR, ic, pagina, sino, seloSync, tela } from './base.mjs';
import { CLIENTE, ENDERECO_UMA_LINHA, VENDEDORA } from './dados.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
// Logo empilhado da entrada, lido do shell (apps/mobile/src/lib/logo-marca.ts): o mesmo desenho da splash.
const LOGO_NEGATIVO = readFileSync(join(AQUI, '../../../apps/mobile/src/lib/logo-marca.ts'), 'utf8').match(/LOGO_EMPILHADO_NEGATIVO = `([^`]+)`/)[1];

/** Abertura do Campo (components/tela-entrada.tsx, tema faixa): o logo parado no centro e o nome do app no rodapé. */
function abertura() {
  const altura = Math.round(136 / (353.4 / 327.9));
  const css = `.tel{background:${COR.faixa}}
.logo{position:absolute;left:0;right:0;top:${Math.round((760 - altura) / 2)}px;display:flex;justify-content:center}
.logo svg{width:136px;height:${altura}px}
.nome{position:absolute;left:32px;right:32px;bottom:32px;text-align:center;font-size:14px;color:${COR.faixaSub}}`;
  return pagina(`<div class="tel">${barraDeStatus('08:01')}<div class="logo">${LOGO_NEGATIVO}</div><div class="nome">Macuxi Campo</div></div>`, css);
}

/** Início do Campo (modules/core/app/telas/inicio/tela-inicio-campo.tsx): painel, Metas do mês, Produtividade e Sincronizar. */
function inicio() {
  const css = `
.painel{background:${COR.faixa};padding:12px 20px 16px;display:flex;align-items:center;gap:12px;flex:none}
.av{width:72px;height:72px;border-radius:16px;background:${COR.neutralBg};display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:${COR.accentInk};flex:none}
.tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.ls{display:flex;align-items:center;gap:4px;margin-right:-12px}
.ls b{flex:1;font-size:22px;font-weight:700;color:#fff;white-space:nowrap}
.ls .sino{margin:-10px 0}
.tx .d{font-size:14px;color:${COR.faixaSub};padding-right:28px}
.tx i{font-size:14px;color:${COR.faixaSub}}
.corpo.ini{padding:8px 20px 8px;gap:8px}
.h2{font-size:18px;font-weight:700;display:flex;align-items:center;justify-content:space-between;min-height:32px}
.grade{display:flex;flex-direction:column;gap:8px}
.par{display:flex;gap:8px}
.cm{flex:1;min-width:0;background:#fff;border:1px solid ${COR.line};border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:4px}
.cm .lb{display:flex;align-items:center;gap:8px}
.cm .lb span{flex:1;font-size:12px;font-weight:600;color:${COR.ink2}}
.cm .lb b{font-size:14px;font-weight:600}
.cm .vl{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:4px}
.cm .vl b{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
.cm .vl span{font-size:14px;color:${COR.ink2}}
.barra-m{height:6px;border-radius:3px;background:${COR.lineSoft};overflow:hidden}
.barra-m i{display:block;height:100%;background:${COR.grafico};border-radius:3px}
.cm .rd{display:flex;justify-content:space-between;align-items:center;font-size:14px;color:${COR.ink2}}
.cm .rd b{font-weight:600;color:${COR.ink};font-variant-numeric:tabular-nums}
.prod{background:#fff;border:1px solid ${COR.line};border-radius:14px;padding:12px 8px;display:flex;flex-wrap:wrap;row-gap:8px}
.prod>div{width:33.333%;padding:0 4px;display:flex;flex-direction:column;gap:2px}
.prod>div:not(:nth-child(3n+1)){border-left:1px solid ${COR.line}}
.prod span{font-size:14px;color:${COR.ink2};padding-left:4px}
.prod b{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums;display:flex;align-items:center;gap:4px;padding-left:4px}
.prod b i{width:8px;height:8px;border-radius:4px;display:inline-block}
.sinc{display:flex;align-items:center;gap:12px;padding:8px 20px 12px;flex:none}
.sinc .bt{flex:1;height:52px;border-radius:12px;background:${COR.ink};color:#fff;font-size:14px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:8px}
.sinc small{font-size:12px;color:${COR.ink2};white-space:pre;line-height:16px}`;
  const meta = (t, pct, real, meta, cor, rot, val, barra) =>
    `<div class="cm"><div class="lb"><span>${t}</span><b style="color:${cor}">${pct}</b></div><div class="vl"><b>${real}</b><span>/ ${meta}</span></div><div class="barra-m"><i style="width:${barra}%"></i></div><div class="rd"><span>${rot}</span><b>${val}</b></div></div>`;
  const prod = [['Jornada', '0h12', null], ['1º check-in', '—', null], ['Almoço', '—', null], ['Últ. check-in', '—', null], ['Fora de rota', '0', COR.success], ['TMA', '—', null]];
  return pagina(`<div class="tel">${barraDeStatus('08:14')}
<div class="painel"><div class="av">CL</div><div class="tx"><div class="ls"><b>Bom dia, ${VENDEDORA.primeiro}</b>${sino()}</div><span class="d">Quinta, 19 de novembro · DU 14 de 21</span><i>“Cliente bem atendido volta e indica.”</i></div></div>
<div class="corpo ini"><div class="h2">Metas do mês</div><div class="grade">
<div class="par">${meta('Vendas', '71%', 'R$ 84,6 k', 'R$ 120 k', COR.danger, 'Meta/dia', 'R$ 5,1 k', 71)}${meta('Positivação', '77%', '46', '60', COR.danger, 'Meta/dia', '2', 77)}</div>
<div class="par">${meta('Visitas', '74%', '118', '160', COR.danger, 'Meta/dia', '6', 74)}${meta('Itens/pedido', '93%', '8,40', '9,00', COR.danger, 'Meta/pedido', '9,00', 93)}</div></div>
<div class="h2">Produtividade${ic('chevron', 22, COR.ink)}</div>
<div class="prod">${prod.map(([t, v, p]) => `<div><span>${t}</span><b>${p ? `<i style="background:${p}"></i>` : ''}${v}</b></div>`).join('')}</div></div>
<div class="sinc"><span class="bt">${ic('sync', 18, '#fff')}Sincronizar</span><small>Últ. sincronização\n08:03</small></div>
${barraAbas('campo', 'inicio')}</div>`, css);
}

// Rota do dia de hoje: 7 paradas, a 1ª feita, a 2ª (Mercado Bom Preço) é a próxima.
const PARADAS = [
  { n: 1, nome: 'Padaria Pão da Serra', sub: 'Pedido R$ 640', st: 'done' },
  { n: 2, nome: CLIENTE.fantasia, sub: '09:00', st: 'next' },
  { n: 3, nome: 'Supermercado Rio Branco', sub: '10:00', st: 'pending' },
  { n: 4, nome: 'Mercearia Caçari', sub: '10:45', st: 'pending' },
  { n: 5, nome: 'Empório Caxangá', sub: '11:30', st: 'pending' },
  { n: 6, nome: 'Comercial Paricarana', sub: '14:00', st: 'pending' },
  { n: 7, nome: 'Atacarejo São Vicente', sub: '15:30', st: 'pending' },
];

/** Rota de hoje (modules/core/app/telas/rota.tsx): chip das feitas, filtro, mapa da rota e a lista das paradas. */
function rota() {
  const css = `
.lc{display:flex;justify-content:space-between;align-items:center}
.mapa{height:220px;border-radius:18px;overflow:hidden;background:${COR.neutralBg};border:1px solid ${COR.lineStrong};position:relative}
.mapa svg{position:absolute;inset:0}
.ir{position:absolute;left:12px;bottom:12px}
.lr{background:#fff;border:1px solid ${COR.line};border-radius:14px;overflow:hidden}
.pa{display:flex;align-items:center;gap:10px;padding:8px 12px 8px 14px;min-height:56px}
.pa+.pa{border-top:1px solid ${COR.lineSoft}}
.num{width:28px;height:28px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex:none}
.pa .c{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.pa .c b{font-size:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pa .c span{font-size:12px;color:${COR.ink2}}
.pa .bt.sec{padding:0 12px}`;
  // pontos já projetados no mapa (projectPoints faz isso no app a partir de lat/lng); a 1ª parada feita, a 2ª é a próxima
  const P = [[40, 112], [100, 72], [162, 62], [226, 46], [282, 82], [292, 134], [226, 150]];
  const svgMapa = `<svg width="318" height="220" viewBox="0 0 350 220" preserveAspectRatio="none"><path d="M-10 60 C80 40 140 90 220 70 S330 30 370 50" stroke="#fff" stroke-width="10" fill="none"/><path d="M40 -10 C60 70 30 140 70 230" stroke="#fff" stroke-width="8" fill="none"/><path d="M-10 170 C90 150 180 190 260 160 S340 140 370 150" stroke="#fff" stroke-width="8" fill="none"/><path d="M250 -10 C240 60 280 120 250 230" stroke="#fff" stroke-width="6" fill="none"/><path d="M150 -10 L170 230" stroke="#fff" stroke-width="5" fill="none"/></svg>
<svg width="318" height="220"><polyline points="${P.slice(0, 2).map((p) => p.join(',')).join(' ')}" stroke="${COR.ink}" stroke-width="3" fill="none" stroke-linecap="round"/><polyline points="${P.slice(1).map((p) => p.join(',')).join(' ')}" stroke="${COR.accent}" stroke-width="3" stroke-dasharray="6 6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
${P.map(([x, y], i) => (i === 0 ? `<circle cx="${x}" cy="${y}" r="12" fill="${COR.success}"/><text x="${x}" y="${y + 4}" font-size="12" font-weight="600" fill="#fff" text-anchor="middle" font-family="Roboto">1</text>` : i === 1 ? `<circle cx="${x}" cy="${y}" r="16" fill="${COR.ink}" stroke="#fff" stroke-width="3"/><text x="${x}" y="${y + 5}" font-size="14" font-weight="600" fill="#fff" text-anchor="middle" font-family="Roboto">2</text>` : `<circle cx="${x}" cy="${y}" r="11" fill="#fff" stroke="${COR.ink}" stroke-width="2"/><text x="${x}" y="${y + 4}" font-size="12" font-weight="600" fill="${COR.ink}" text-anchor="middle" font-family="Roboto">${i + 1}</text>`)).join('')}</svg>`;
  const linha = (p) => {
    const num = p.st === 'done' ? `<span class="num" style="background:${COR.successBg}">${ic('check', 14, COR.success, 2.4)}</span>` : p.st === 'next' ? `<span class="num" style="background:${COR.ink};color:#fff;font-size:14px">${p.n}</span>` : `<span class="num" style="background:#fff;border:2px solid ${COR.ink}">${p.n}</span>`;
    return `<div class="pa">${num}<div class="c"><b${p.st === 'done' ? ` style="color:${COR.ink2}"` : ''}>${p.nome}</b><span>${p.sub}</span></div>${p.st === 'done' ? '' : '<span class="bt sec">Check-in</span>'}</div>`;
  };
  return tela({
    hora: '08:52',
    estilo: css,
    cab: cabecalho({ titulo: 'Rota de hoje', subtitulo: '7 visitas · 38 km · Centro-Norte' }),
    corpo: [
      `<div class="lc"><span class="badge t-suc" style="min-height:28px;padding:0 12px;font-size:14px">1 feita</span><span class="fbtn">${ic('filtro', 20, COR.ink)}</span></div>`,
      `<div class="mapa">${svgMapa}<span class="bt sec ir">${ic('navigate', 18, COR.ink)}Ir para a parada 2</span></div>`,
      `<div class="lr">${PARADAS.map(linha).join('')}</div>`,
    ].join(''),
    barra: barraAbas('campo', 'rota'),
  });
}

/** Clientes (modules/core/app/telas/clientes.tsx), no filtro padrão (#437): sem filtro marcado, a carteira inteira. */
export function clientes({ variante = 'campo', hora = '08:55', total = 38, sync = '08:03', lista: listaDada = null } = {}) {
  const css = `
.topo{padding:12px 20px 12px;display:flex;gap:8px;flex:none}
.corpo.cl{padding:0 20px 20px}
.lc{background:#fff;border:1px solid ${COR.line};border-radius:14px;overflow:hidden}
.lc .r{display:flex;align-items:center;gap:12px;padding:11px 14px}
.lc .r+.r{border-top:1px solid ${COR.lineSoft}}
.lc .c{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.lc b{font-size:16px;font-weight:600}.lc span.v{font-size:14px;color:${COR.ink2}}`;
  const lista = listaDada ?? [
    ['Atacarejo São Vicente', 'Visitado há 2 dias', 'Em dia', 'suc'],
    ['Comercial Paricarana', 'Visitado há 2 dias', 'Em dia', 'suc'],
    ['Empório Caxangá', 'Visitado ontem', 'Em dia', 'suc'],
    [CLIENTE.fantasia, 'Visitado há 7 dias', 'Devendo', 'err'],
    ['Mercearia Caçari', 'Visitado há 3 dias', 'Em dia', 'suc'],
    ['Mercearia Santa Luzia', 'Visitado há 9 dias', 'Em dia', 'suc'],
    ['Padaria Pão da Serra', 'Visitado hoje', 'Em dia', 'suc'],
    ['Supermercado Rio Branco', 'Visitado há 6 dias', 'Em dia', 'suc'],
    ['Varejão Pricumã', 'Visitado há 12 dias', 'Em dia', 'suc'],
  ];
  return tela({
    hora,
    estilo: css,
    cab: cabecalho({ titulo: 'Clientes', subtitulo: `${total} na carteira`, direita: seloSync(sync) }) + `<div class="topo">${busca('Nome, documento ou cidade')}<span class="fbtn">${ic('filtro', 20, COR.ink)}</span></div>`,
    classeCorpo: 'cl',
    corpo: `<div class="lc">${lista.map(([n, v, s, t]) => `<div class="r"><div class="c"><b>${n}</b><span class="v">${v}</span></div>${badge(s, t)}${ic('chevron', 16, COR.ink3)}</div>`).join('')}</div>`,
    barra: barraAbas(variante, 'clientes'),
  });
}

// ---------- Ficha do cliente (modules/core/app/telas/cliente.tsx e components/cliente360.tsx) ----------
const CSS_FICHA = `
.abas.rol{justify-content:flex-start;overflow:hidden}
.abas.rol div{flex:none;padding:0 16px}
.acs{display:flex;gap:8px}
.acs div{flex:1;height:64px;border-radius:12px;border:1px solid ${COR.lineStrong};background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font-size:12px;font-weight:600}
.grid{display:flex;flex-wrap:wrap;gap:8px}
.st{flex:1 1 40%;background:#fff;border:1px solid ${COR.line};border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:2px;min-width:0}
.st.cheio{flex-basis:100%}
.st small{font-size:12px;color:${COR.ink2}}
.st b{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.st b.t16{font-size:16px;white-space:normal}
.h2s{font-size:18px;font-weight:700}
.cd{background:#fff;border:1px solid ${COR.line};border-radius:14px;overflow:hidden}
.cd .r{display:flex;align-items:center;gap:8px;padding:8px 4px 8px 14px;min-height:48px}
.cd .r+.r{border-top:1px solid ${COR.lineSoft}}
.cd .c{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.cd b{font-size:16px;font-weight:600}.cd small{font-size:12px;color:${COR.ink2}}.cd p{font-size:16px}
.cd .mini{width:48px;height:48px;display:flex;align-items:center;justify-content:center;flex:none}
.cd .v{font-size:16px;font-weight:600;padding-right:10px;font-variant-numeric:tabular-nums}
.rodape-f{display:flex;gap:6px;padding:10px 20px 12px;background:${COR.ground};flex:none}
.rodape-f span{flex:1 1 auto;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;gap:6px;padding:0 6px;font-size:14px;font-weight:600;border:1.5px solid ${COR.ink};background:#fff}
.rodape-f span.pri{background:${COR.accent};border-color:${COR.accent};color:#fff}`;

const ABAS_FICHA = ['Resumo', 'Cadastro', 'Financeiro', 'Compras', 'Performance', 'Anexos'];
const rodapeFicha = (checkout = false) =>
  `<div class="rodape-f"><span>${checkout ? 'Checkout' : 'Check-in'}</span><span>Pesquisa</span><span class="pri">${ic('plus', 18, '#fff')}Novo pedido</span></div>`;

function ficha(aba, corpo, { hora = '09:02', extra = '', checkout = false } = {}) {
  // as abas roláveis acompanham a ativa (rolagemAteAba): Performance e Anexos aparecem quando a ativa está à direita
  const desloca = { Compras: 96, Performance: 150 }[aba] ?? 0;
  return tela({
    hora,
    estilo: CSS_FICHA,
    cab:
      cabecalho({ titulo: CLIENTE.fantasia, subtitulo: `${ENDERECO_UMA_LINHA} · cliente desde 2019`, voltar: 'Clientes' }) +
      `<div class="abas rol"><div style="display:flex;margin-left:-${desloca}px">${ABAS_FICHA.map((a) => `<div${a === aba ? ' class="on"' : ''} style="flex:none;padding:0 16px">${a}</div>`).join('')}</div></div>`,
    corpo,
    barra: rodapeFicha(checkout) + barraAbas('campo', 'clientes'),
    extra,
  });
}

const stat = (rot, val, { aviso = false, sub = '', cheio = false, t16 = false } = {}) =>
  `<div class="st${cheio ? ' cheio' : ''}"><small>${rot}</small><b class="${t16 ? 't16' : ''}"${aviso ? ` style="color:${COR.danger}"` : ''}>${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;

function fichaResumo() {
  return ficha('Resumo', [
    `<div class="acs"><div>${ic('phone', 20, COR.ink, 1.9)}Ligar</div><div>${ic('chat', 20, COR.ink, 1.9)}WhatsApp</div><div>${ic('navigate', 20, COR.ink, 1.9)}Mapa</div></div>`,
    `<div class="grid">${stat('Compras no mês', 'R$ 3.940')}${stat('Última compra', 'há 12 dias')}</div>`,
  ].join(''));
}

function fichaCadastro() {
  return ficha('Cadastro', [
    `<div class="grid">${stat('CNPJ', CLIENTE.cnpj, { cheio: true, t16: true })}${stat('Endereço', ENDERECO_UMA_LINHA, { cheio: true, t16: true })}${stat('Filial', 'Boa Vista · Matriz', { cheio: true, t16: true })}${stat('Segmento', 'Supermercado', { cheio: true, t16: true })}</div>`,
    `<div class="h2s">Contatos</div>`,
    `<div class="cd"><div class="r"><div class="c"><b>Antônio Ferreira · principal</b><small>Comprador</small></div><span class="mini">${ic('phone', 18, COR.ink, 1.9)}</span><span class="mini">${ic('chat', 18, COR.ink, 1.9)}</span></div><div class="r"><div class="c"><b>Luciana Souza</b><small>Financeiro</small></div><span class="mini">${ic('phone', 18, COR.ink, 1.9)}</span><span class="mini">${ic('chat', 18, COR.ink, 1.9)}</span></div></div>`,
    `<div class="h2s">Endereços de entrega</div>`,
    `<div class="cd"><div class="r"><div class="c"><div style="display:flex;gap:6px;align-items:center"><b>Loja</b>${badge('Padrão', 'suc')}</div><b>${CLIENTE.rua} · ${CLIENTE.bairro} · ${CLIENTE.cidade}</b></div><span class="mini">${ic('navigate', 18, COR.ink, 1.9)}</span></div></div>`,
  ].join(''));
}

function fichaFinanceiro() {
  return ficha('Financeiro', `<div class="grid">${stat('Limite', 'R$ 8.000')}${stat('Saldo em aberto', 'R$ 6.120')}${stat('Crédito disponível', 'R$ 1.880')}${stat('Vencidos', '1 · R$ 640', { aviso: true })}</div>`);
}

function fichaCompras() {
  const pedidos = [['000017', '07/11', 'Faturado', 'R$ 2.380'], ['000013', '03/11', 'Faturado', 'R$ 1.560'], ['000009', '24/10', 'Faturado', 'R$ 2.870']];
  const meses = [['11/2026', '2 pedidos · 17 itens', 'R$ 3.940'], ['10/2026', '2 pedidos · 18 itens', 'R$ 5.610'], ['09/2026', '2 pedidos · 16 itens', 'R$ 4.980']];
  return ficha('Compras', [
    `<div class="grid">${stat('Compra média/mês', 'R$ 5.210')}${stat('Ticket médio', 'R$ 2.605')}${stat('Frequência média', 'a cada 14 dias')}${stat('Compras em 12 meses', 'R$ 62.520')}</div>`,
    `<div class="h2s">Histórico de Pedidos</div>`,
    `<div class="cd">${pedidos.map(([n, d, s, v]) => `<div class="r" style="min-height:52px"><div class="c" style="gap:2px"><small><span class="tn">${n}</span> · ${d}</small>${badge(s, 'suc').replace('class="badge', 'style="align-self:flex-start" class="badge')}</div><span class="v">${v}</span></div>`).join('')}</div>`,
    `<div class="cd">${meses.map(([m, q, v]) => `<div class="r"><div class="c"><b>${m}</b><small>${q}</small></div><span class="v">${v}</span></div>`).join('')}</div>`,
  ].join(''));
}

function fichaPerformance() {
  const itens = [['Arroz tipo 1 5 kg', '10 CX · 07/11/2026', 'R$ 129,00'], ['Feijão carioca 1 kg', '6 FD · 07/11/2026', 'R$ 92,75'], ['Óleo de soja 900 ml', '3 CX · 03/11/2026', 'R$ 148,00']];
  const mix = [['Macarrão espaguete 500 g', '8 de 10 clientes parecidos compram'], ['Leite em pó integral 400 g', '7 de 10 clientes parecidos compram']];
  return ficha('Performance', [
    `<div class="grid">${stat('Visitas', '46')}${stat('Última visita', '12/11/2026', { sub: 'Você' })}</div>`,
    `<div style="display:flex;flex-direction:column;gap:8px"><div class="h2s">Curvas</div><div style="display:flex;gap:6px;flex-wrap:wrap">${badge('Faturamento A', 'des')}${badge('Volume B', 'neu')}${badge('Frequência A', 'des')}</div></div>`,
    `<div class="h2s">Últimos itens comprados</div>`,
    `<div class="cd">${itens.map(([n, q, v]) => `<div class="r"><div class="c"><b>${n}</b><small>${q}</small></div><span class="v">${v}</span></div>`).join('')}</div>`,
    `<div class="h2s">Sugestão de mix</div>`,
    `<div class="cd"><small style="display:block;padding:10px 14px 0">Compra em clientes parecidos</small>${mix.map(([n, m]) => `<div class="r"><div class="c"><b>${n}</b><small>${m}</small></div><span class="mini">${ic('plus', 18, COR.ink)}</span></div>`).join('')}</div>`,
  ].join(''));
}

/** Check-in na ficha (components/checkin-sheet.tsx): a folha confirma o horário; o rodapé vira Checkout. */
function checkin() {
  return ficha('Resumo', [
    `<div>${badge('Em atendimento · desde 09:18', 'des')}</div>`,
    `<div class="acs"><div>${ic('phone', 20, COR.ink, 1.9)}Ligar</div><div>${ic('chat', 20, COR.ink, 1.9)}WhatsApp</div><div>${ic('navigate', 20, COR.ink, 1.9)}Mapa</div></div>`,
    `<div class="grid">${stat('Compras no mês', 'R$ 3.940')}${stat('Última compra', 'há 12 dias')}</div>`,
  ].join(''), {
    hora: '09:18',
    checkout: true,
    extra: `<div class="scrim"></div><div class="folha" style="padding:8px 16px 12px;gap:9px"><span class="pega"></span><div style="display:flex;gap:12px;align-items:center;padding-top:8px"><span style="width:40px;height:40px;border-radius:12px;background:${COR.successBg};display:flex;align-items:center;justify-content:center">${ic('check', 18, COR.success, 2.4)}</span><span style="font-size:18px;font-weight:700">Check-in às 09:18</span></div><div style="min-height:48px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;color:${COR.ink2};margin-top:5px">Continuar</div></div>`,
  });
}

// Fotos dos produtos: desenhos simples no lugar da foto do cadastro (a miniatura do app mostra a foto enviada).
const FOTO = {
  arroz: '<svg width="70" height="92" viewBox="0 0 70 92"><path d="M10 10h50l4 74a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4z" fill="#F3EBD6" stroke="#D9C9A0" stroke-width="2"/><rect x="6" y="34" width="58" height="26" fill="#2F7A4D"/><text x="35" y="52" text-anchor="middle" font-family="Roboto" font-weight="700" font-size="12" fill="#fff">ARROZ</text><text x="35" y="76" text-anchor="middle" font-family="Roboto" font-weight="700" font-size="11" fill="#7A6A3A">5 kg</text></svg>',
  feijao: '<svg width="66" height="90" viewBox="0 0 66 90"><path d="M8 8h50l3 76a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z" fill="#FFF8EC" stroke="#E2CDA6" stroke-width="2"/><rect x="5" y="30" width="56" height="24" fill="#A8261B"/><text x="33" y="47" text-anchor="middle" font-family="Roboto" font-weight="700" font-size="11" fill="#fff">FEIJÃO</text><circle cx="22" cy="70" r="5" fill="#8A5A3C"/><circle cx="33" cy="73" r="5" fill="#9C6A48"/><circle cx="44" cy="69" r="5" fill="#7E5034"/></svg>',
  cafe: '<svg width="60" height="92" viewBox="0 0 60 92"><rect x="8" y="14" width="44" height="74" rx="6" fill="#5A3A22"/><rect x="8" y="38" width="44" height="28" fill="#E9D8B4"/><text x="30" y="56" text-anchor="middle" font-family="Roboto" font-weight="700" font-size="11" fill="#5A3A22">CAFÉ</text><rect x="14" y="4" width="32" height="12" rx="3" fill="#3E2716"/></svg>',
  oleo: '<svg width="44" height="96" viewBox="0 0 44 96"><rect x="16" y="2" width="12" height="10" rx="2" fill="#C2540A"/><path d="M14 12h16l6 14v62a5 5 0 0 1-5 5H13a5 5 0 0 1-5-5V26z" fill="#F7D774" stroke="#E0B94A" stroke-width="2"/><rect x="8" y="44" width="28" height="22" fill="#1E3350"/><text x="22" y="59" text-anchor="middle" font-family="Roboto" font-weight="700" font-size="8" fill="#fff">SOJA</text></svg>',
};

/** Catálogo pela ficha do cliente (modules/catalogo/app/telas/catalogo.tsx e comum.tsx): busca, chips e a grade de 2 colunas. */
function catalogo() {
  const css = `
.corpo.cat{gap:14px}
.linha-chips{display:flex;gap:8px;margin:0 -20px;padding:0 20px;overflow:hidden}
.grade{display:flex;flex-direction:column;gap:8px}
.gl{display:flex;gap:8px}
.cg{flex:1;min-width:0;background:#fff;border:1px solid ${COR.line};border-radius:16px;padding:10px;display:flex;flex-direction:column;gap:6px}
.cg .ft{height:112px;border-radius:12px;background:${COR.neutralBg};display:flex;align-items:center;justify-content:center}
.cg b{font-size:16px;font-weight:600;line-height:20px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cg .esp{flex:1}
.cg .mc{font-size:14px;color:${COR.ink2}}
.cg .pr{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
.cg .rd{display:flex;align-items:center}
.cg .cp{margin-left:auto;width:28px;height:28px;border-radius:14px;display:flex;align-items:center;justify-content:center}`;
  const card = ([foto, n, m, p, est, tom]) => `<div class="cg"><div class="ft">${FOTO[foto]}</div><b>${n}</b><span class="mc">${m}</span><span class="esp"></span><span class="pr">${p}</span><div class="rd">${badge(est, tom)}<span class="cp">${ic('copy', 16, COR.ink)}</span></div></div>`;
  const itens = [
    ['arroz', 'Arroz tipo 1 5 kg', 'Tio Nortista', 'R$ 129,00', '84 em estoque', 'suc'],
    ['feijao', 'Feijão carioca 1 kg', 'Kicaldo', 'R$ 92,75', '57 em estoque', 'suc'],
    ['cafe', 'Café torrado 500 g', 'Serra Alta', 'R$ 160,00', '31 em estoque', 'suc'],
    ['oleo', 'Óleo de soja 900 ml', 'Soya', 'R$ 148,00', 'Pouco estoque', 'av'],
  ];
  return tela({
    hora: '09:24',
    estilo: css,
    cab: cabecalho({ titulo: 'Catálogo', subtitulo: '412 produtos', voltar: CLIENTE.fantasia, direita: seloSync('08:03') }),
    classeCorpo: 'cat',
    corpo: [
      `<div style="display:flex">${busca('Produto, código ou aplicação')}</div>`,
      `<div class="linha-chips">${['Todos', 'Mercearia', 'Bebidas', 'Limpeza', 'Higiene'].map((c, i) => `<span class="chip${i === 0 ? ' on' : ''}">${c}</span>`).join('')}</div>`,
      `<div class="grade"><div class="gl">${card(itens[0])}${card(itens[1])}</div><div class="gl">${card(itens[2])}${card(itens[3])}</div></div>`,
    ].join(''),
    barra: barraAbas('campo', 'clientes'),
  });
}

/** Performance (modules/core/app/telas/performance/tela-performance.tsx), no fim do dia: Resultados do mês. */
function performance() {
  const css = `
.lv{display:flex;align-items:center;gap:8px}.lv .seg{flex:1}
.lp{display:flex;justify-content:space-between;align-items:center;font-size:14px;color:${COR.ink2}}
.cr{background:#fff;border:1px solid ${COR.line};border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:12px}
.cr .tt{display:flex;flex-direction:column;gap:2px}
.cr .tt b{font-size:16px;font-weight:600}
.cr .tt .rl{font-size:28px;font-weight:600;font-variant-numeric:tabular-nums}
.cr .tt .rl span{font-size:22px;font-weight:400;color:${COR.ink2}}
.cr .lb{display:flex;align-items:center;gap:12px}
.cr .lb .barra-m{flex:1;height:8px;border-radius:4px;background:${COR.lineSoft};overflow:hidden}
.cr .lb .barra-m i{display:block;height:100%;background:${COR.grafico}}
.cr .lb b{font-size:16px;font-weight:600;color:${COR.danger};font-variant-numeric:tabular-nums}
.cr .cols{display:flex;border-top:1px solid ${COR.line};padding-top:12px}
.cr .cols div{flex:1;display:flex;flex-direction:column;gap:2px}
.cr .cols div+div{border-left:1px solid ${COR.line};padding-left:12px}
.cr .cols span{font-size:14px;color:${COR.ink2}}.cr .cols strong{font-size:16px;font-weight:600;font-variant-numeric:tabular-nums}`;
  const cartao = (t, real, meta, pct, cols) => `<div class="cr"><div class="tt"><b>${t}</b><span class="rl">${real}<span> / ${meta}</span></span></div><div class="lb"><span class="barra-m"><i style="width:${pct}%"></i></span><b>${pct}%</b></div><div class="cols">${cols.map(([r, v]) => `<div><span>${r}</span><strong>${v}</strong></div>`).join('')}</div></div>`;
  return tela({
    hora: '17:42',
    estilo: css,
    cab: cabecalho({ titulo: 'Performance' }),
    corpo: [
      `<div class="lv"><div class="seg"><div class="on">Resultados</div><div>Produtividade</div></div><span class="fbtn">${ic('filtro', 20, COR.ink)}</span></div>`,
      `<div class="lp"><span>Novembro de 2026</span><span>DU 14 de 21 · 7 restantes</span></div>`,
      cartao('Vendas', 'R$ 88,9 k', 'R$ 120 k', 74, [['Gap', 'R$ 31,1 k'], ['Meta/dia', 'R$ 4,4 k'], ['Real/dia', 'R$ 6,4 k']]),
      cartao('Positivação', '49', '60', 82, [['Gap', '11'], ['Meta/dia', '2'], ['Real/dia', '4']]),
      cartao('Visitas', '125', '160', 78, [['Gap', '35'], ['Meta/dia', '5'], ['Real/dia', '9']]),
    ].join(''),
    barra: barraAbas('campo', 'performance'),
  });
}

export const TELAS_DIA = {
  '01-abertura': abertura(),
  '02-inicio': inicio(),
  '03-rota': rota(),
  '04-clientes': clientes(),
  '05-cliente-resumo': fichaResumo(),
  '06-cliente-cadastro': fichaCadastro(),
  '07-cliente-financeiro': fichaFinanceiro(),
  '08-cliente-compras': fichaCompras(),
  '09-cliente-performance': fichaPerformance(),
  '10-check-in': checkin(),
  '11-catalogo': catalogo(),
  '19-performance': performance(),
};
