// Telas do Macuxi Campo (vendedora Carla Lima). Cada função segue o componente de hoje citado no comentário.
import { alertas, badge, barraAbas, busca, cabecalho, COR, ic, rotulo, seloSync, suspensa, tabelaRotuloValor, tabelaValores, tela } from './base.mjs';
import { CLIENTE, ENDERECO_UMA_LINHA, GERENTE, PEDIDO } from './dados.mjs';

const ALERTAS_DO_PEDIDO = ['Limite de crédito excedido', 'Título vencido'];

// ---------- Novo pedido (modules/vendedor/app/screens/new-order-screen.tsx) ----------
const CSS_PEDIDO = `
.corpo.np{padding:12px 12px 16px;gap:12px}
/* TabelaDeItens (tabelas-pedido.tsx): Código · Emb. · Qtd · Valor tabela · Desc./Acrésc. · Total, gap 4, padding 8 */
.ti .cb,.ti .li{display:flex;gap:4px;padding:0 8px;align-items:center}
.ti .cb{padding-top:10px;padding-bottom:6px;align-items:flex-end}
.ti .li{min-height:44px;border-top:1px solid ${COR.lineSoft}}
.ti .cb span{font-size:12px;font-weight:600;color:${COR.ink2};text-align:right;line-height:15px}
.ti .cod{width:48px;flex:none;text-align:left!important}
.ti .cod a{font-family:'Roboto Mono',monospace;font-size:12px;color:${COR.accentInk};text-decoration:underline}
.ti .e{flex:30 1 0;min-width:0;text-align:right}.ti .q{flex:26 1 0;min-width:0;text-align:right}.ti .t{flex:48 1 0;min-width:0;text-align:right}
.ti .a{flex:40 1 0;min-width:0;text-align:right}.ti .to{flex:54 1 0;min-width:0;text-align:right}.ti .lp{width:32px;flex:none}
.ti .li span{font-size:12px;font-variant-numeric:tabular-nums}
.ti .li .e{display:flex;flex-direction:column;align-items:flex-end;line-height:15px;padding:8px 0}
.ti .li .e small{font-size:12px;color:${COR.ink2}}
.ti .li .to{font-size:14px!important;font-weight:600}
.ti .z{color:${COR.ink2}}
.lapis{width:32px;height:32px;border-radius:9px;border:1.5px solid ${COR.accent};background:${COR.accentSoft};display:flex;align-items:center;justify-content:center;flex:none}
/* CartaoDeTotais */
.tt{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;min-height:48px}
.tt+.tt{border-top:1px solid ${COR.lineSoft}}
.tt .r{font-size:14px;color:${COR.ink2}}.tt .v{font-size:16px;font-weight:600;font-variant-numeric:tabular-nums}
.tt.fim{border-top:1px solid ${COR.line}}
.tt.fim .r{font-size:16px;font-weight:600;color:${COR.ink}}.tt.fim .v{font-size:22px}
/* lista da aba Itens (busca-itens.tsx) */
.pr{display:flex;align-items:center;gap:10px;padding:10px 12px}
.pr+.pr{border-top:1px solid ${COR.lineSoft}}
.pr .c{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.pr .n{font-size:16px;line-height:20px}
.pr .n b{font-weight:600;text-decoration:underline dotted;text-underline-offset:3px}
.pr .d{font-size:12px;color:${COR.ink2};white-space:pre}
.pr .d .mono{font-size:12px}
.edt-l{width:44px;height:44px;border-radius:12px;border:2px solid ${COR.success};background:${COR.successBg};display:flex;align-items:center;justify-content:center;flex:none}
/* DescontoGeral */
.geral{display:flex;align-items:center;gap:8px}
.dc{flex:1;min-width:0;height:44px;border-radius:8px;border:1px solid ${COR.lineStrong};background:#fff;display:flex;overflow:hidden}
.dc .tp{display:flex;align-items:center;gap:3px;padding:0 8px;background:${COR.ground};border-right:1px solid ${COR.line};font-size:12px;font-weight:600;color:${COR.ink2}}
.dc .vl{flex:1;display:flex;align-items:center;justify-content:flex-end;padding:0 8px;font-size:16px;font-weight:600;color:${COR.ink3}}
.pm{width:36px;height:44px;border-radius:10px;border:1px solid ${COR.lineStrong};background:#fff;display:flex;align-items:center;justify-content:center;flex:none}
.pm.off{border-color:${COR.line}}
.end{background:#fff;border:1px solid ${COR.line};border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:4px}
.end p{font-size:14px;line-height:20px}
`;

const cabNovoPedido = (sub = '') => cabecalho({ titulo: 'Novo pedido', subtitulo: `${CLIENTE.fantasia} · cód. ${CLIENTE.codigo}${sub}`, voltar: 'Voltar' });
const abasPedido = (ativa, itens) =>
  `<div class="abas">${[['venda', 'Venda'], ['itens', `Itens (${itens})`], ['entrega', 'Entrega'], ['resumo', 'Resumo']].map(([id, r]) => `<div${id === ativa ? ' class="on"' : ''}>${r}</div>`).join('')}</div>`;
const avancar = '<div class="bt pri">Avançar</div>';

/** Aba Venda (AbaVenda + CardPagamento): Cliente, forma e prazo, Crédito do cliente sem o prazo médio (v1.0.15). */
function venda({ subtitulo = '', comAlertas = false } = {}) {
  return tela({
    hora: '09:31',
    estilo: CSS_PEDIDO,
    cab: cabNovoPedido(subtitulo) + abasPedido('venda', comAlertas ? 4 : 0),
    classeCorpo: 'np',
    corpo: [
      comAlertas ? alertas(ALERTAS_DO_PEDIDO) : '',
      `<div class="bloco">${rotulo('Cliente')}${tabelaRotuloValor([['Endereço', ENDERECO_UMA_LINHA], ['CNPJ', CLIENTE.cnpj]])}</div>`,
      `<div class="linha2">${suspensa('Forma de pagamento', PEDIDO.forma)}${suspensa('Prazo', PEDIDO.prazo)}</div>`,
      `<div class="bloco">${rotulo('Crédito do cliente')}${tabelaValores([['Limite', CLIENTE.limite], ['Disponível', CLIENTE.disponivel]])}<div class="tv-rod">${ic('sync', 14, COR.ink2)}Atualizado hoje às 09:05</div></div>`,
      avancar,
    ].join(''),
    barra: barraAbas('campo', 'pedidos'),
  });
}

function linhaProduto(p) {
  return `<div class="pr"><div class="c"><span class="n"><b>${p.nome}</b> - ${p.marca}</span><span class="d"><span class="mono">${p.cod}</span>   Emb. ${p.emb} ${p.fator}   Est. ${p.est}</span></div><span class="edt-l">${ic('edit', 20, COR.success)}</span></div>`;
}

/** Aba Itens: Alertas no topo (RN-VEN-42), Desc./Acrésc. geral, busca e os itens do pedido com o lápis verde. */
function itens() {
  return tela({
    hora: '09:36',
    estilo: CSS_PEDIDO,
    cab: cabNovoPedido() + abasPedido('itens', 4),
    classeCorpo: 'np',
    corpo: [
      alertas(ALERTAS_DO_PEDIDO),
      `<div class="bloco">${rotulo('Desc./Acrésc. geral')}<div class="geral"><div class="dc"><span class="tp">Desc %${ic('abaixo', 14, COR.ink2)}</span><span class="vl">0</span></div><span class="pm off">${ic('minus', 18, COR.ink3)}</span><span class="pm">${ic('plus', 18, COR.ink)}</span><span class="bt sec off" style="min-height:44px">Aplicar</span></div></div>`,
      `<div style="display:flex">${busca('Código, descrição ou veículo')}</div>`,
      `<div class="cartao">${PEDIDO.itens.map(linhaProduto).join('')}</div>`,
    ].join(''),
    barra: barraAbas('campo', 'pedidos'),
  });
}

/** Aba Entrega (AbaEntrega): Frete CIF/FOB, Endereço com o selo de origem e a Observação da entrega. */
function entrega() {
  return tela({
    hora: '09:38',
    estilo: CSS_PEDIDO,
    cab: cabNovoPedido() + abasPedido('entrega', 4),
    classeCorpo: 'np',
    corpo: [
      alertas(ALERTAS_DO_PEDIDO),
      `<div class="bloco">${rotulo('Frete')}<div class="seg"><div class="on">CIF</div><div>FOB</div></div></div>`,
      `<div class="bloco">${rotulo('Endereço', 'Alterar')}<div class="end"><span class="selo t-neu">Principal</span><p>${CLIENTE.rua} · ${CLIENTE.bairro}</p><p>${CLIENTE.cidade} · ${CLIENTE.cep}</p></div></div>`,
      `<div class="bloco">${rotulo('Observação')}<div class="texto">${PEDIDO.obsEntrega}</div></div>`,
      avancar,
    ].join(''),
    barra: barraAbas('campo', 'pedidos'),
  });
}

function tabelaDeItens(editavel = true) {
  const cab = `<div class="cb"><span class="cod">Código</span><span class="e">Emb.</span><span class="q">Qtd</span><span class="t">Valor tabela</span><span class="a">Desc./ Acrésc.</span><span class="to">Total</span>${editavel ? '<span class="lp"></span>' : ''}</div>`;
  const linhas = PEDIDO.itens
    .map((i) => `<div class="li"><span class="cod"><a>${i.cod}</a></span><span class="e">${i.emb}<small>${i.fator}</small></span><span class="q">${i.qtd}</span><span class="t">${i.tabela}</span><span class="a${i.ajuste === '0,0%' ? ' z' : ''}">${i.ajuste}</span><span class="to">${i.total}</span>${editavel ? `<span class="lapis">${ic('edit', 16, COR.accentInk)}</span>` : ''}</div>`)
    .join('');
  return `<div class="cartao ti">${cab}${linhas}</div>`;
}

const totais = () =>
  `<div class="cartao"><div class="tt"><span class="r">Valor de tabela</span><span class="v">${PEDIDO.valorTabela}</span></div><div class="tt"><span class="r">Desconto (%)</span><span class="v">${PEDIDO.descontoPct}</span></div><div class="tt"><span class="r">Desconto (R$)</span><span class="v">${PEDIDO.descontoRs}</span></div><div class="tt fim"><span class="r">Valor final</span><span class="v">${PEDIDO.total}</span></div></div>`;

const RESUMO_TOPO = () => [
  alertas(ALERTAS_DO_PEDIDO),
  `<div class="bloco g6">${rotulo('Cliente')}${tabelaRotuloValor([['Razão social', CLIENTE.razao], ['CNPJ', CLIENTE.cnpj]])}</div>`,
  `<div class="bloco g6">${rotulo('Condição de pagamento')}${tabelaRotuloValor([['Forma', PEDIDO.forma], ['Prazo', PEDIDO.prazo]])}</div>`,
  `<div class="bloco g6">${rotulo('Itens')}${tabelaDeItens()}</div>`,
];
const RESUMO_FIM = () => [
  `<div class="bloco g6">${rotulo('Entrega')}${tabelaRotuloValor([['Frete', 'CIF'], ['Endereço', `${CLIENTE.rua} · ${CLIENTE.bairro} · ${CLIENTE.cidade} · ${CLIENTE.cep}`], ['Observação', PEDIDO.obsEntrega]])}</div>`,
  `<div class="bloco g6">${rotulo('Observação do pedido')}<div class="texto" style="min-height:64px">${PEDIDO.observacao}</div></div>`,
  `<div class="bloco g6">${rotulo('Totais')}${totais()}</div>`,
  `<div class="bloco" style="gap:10px"><div class="bt pri">Salvar e enviar pedido</div><div class="dupla"><div class="bt sec alto">Apenas salvar</div><div class="bt sec alto">Salvar como orçamento</div></div><div class="bt txt">Cancelar</div></div>`,
];

/** Aba Resumo, do topo: Alertas, Cliente, Condição de pagamento e Itens (o prazo sem o prazo médio). */
function resumo() {
  return tela({ hora: '09:40', estilo: CSS_PEDIDO, cab: cabNovoPedido() + abasPedido('resumo', 4), classeCorpo: 'np', corpo: RESUMO_TOPO().join('') + RESUMO_FIM().join(''), barra: barraAbas('campo', 'pedidos') });
}

/** Resumo rolado até os botões, com a pergunta da P-6: o pedido passa do crédito e vai para aprovação. */
function enviarParaAprovacao() {
  return tela({
    hora: '09:41',
    estilo: CSS_PEDIDO + '.corpo.np{justify-content:flex-end}',
    cab: cabNovoPedido() + abasPedido('resumo', 4),
    classeCorpo: 'np',
    corpo: RESUMO_FIM().join(''),
    barra: barraAbas('campo', 'pedidos'),
    extra: `<div class="scrim"></div><div class="dlg"><h2>Enviar para aprovação?</h2><div class="bts"><span class="bt" style="color:${COR.accentInk}">Voltar</span><span class="bt pri">Enviar</span></div></div>`,
  });
}

/** Detalhe do pedido em aprovação (order-detail-screen.tsx + P-6): uma etapa por motivo no Histórico, aprovadas ao mesmo tempo. */
function emAprovacao() {
  const tags = [
    ['t-neu', 'Salvo · 19/11 09:40'],
    ['t-neu', 'Enviado · 19/11 09:42'],
    ['t-suc', `Aprovado · Inadimplente · ${GERENTE} · 19/11 10:05`],
    ['t-des', 'Em aprovação · Crédito'],
  ];
  return tela({
    hora: '10:12',
    estilo: CSS_PEDIDO + `.menu{align-self:flex-end;width:48px;height:48px;margin:-8px -8px -14px 0;display:flex;align-items:center;justify-content:center}.hist{display:flex;flex-wrap:wrap;gap:6px}`,
    cab: cabecalho({ titulo: `Pedido ${PEDIDO.numero}`, subtitulo: `${CLIENTE.fantasia} · cód. ${CLIENTE.codigo}`, voltar: 'Pedidos' }),
    corpo: [
      `<span class="menu">${ic('mais', 22, COR.ink)}</span>`,
      tabelaRotuloValor([['Pagamento', `${PEDIDO.forma} · ${PEDIDO.prazo}`], ['Entrega', `CIF · ${CLIENTE.rua}`]]),
      `<div class="bloco">${rotulo(`Itens (${PEDIDO.itens.length})`)}${tabelaDeItens(false)}</div>`,
      totais(),
      `<div class="bloco">${rotulo('Histórico')}<div class="hist">${tags.map(([t, x]) => badge(x, t.slice(2))).join('')}</div></div>`,
    ].join(''),
    barra: barraAbas('campo', 'pedidos'),
  });
}

/** Lista de Pedidos (orders-screen.tsx): 3 cartões, busca com filtro, chips de situação e as linhas. */
function pedidos() {
  const css = `
.cards{display:flex;gap:8px}
.cards>div{flex:1;min-width:0;min-height:72px;padding:8px 10px;background:#fff;border:1px solid ${COR.line};border-radius:12px;display:flex;flex-direction:column;justify-content:center}
.cards small{font-size:12px;color:${COR.ink2}}
.cards b{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
.cards .q{display:flex;align-items:center;justify-content:space-between}
.lp{background:#fff;border:1px solid ${COR.line};border-radius:14px;overflow:hidden}
.lp .row{display:flex;flex-direction:column;gap:3px;padding:11px 14px}
.lp .row+.row{border-top:1px solid ${COR.lineSoft}}
.lp .ln{display:flex;justify-content:space-between;align-items:center;gap:8px}
.lp .ln b{font-size:16px;font-weight:600}.lp .ln b.tn{font-variant-numeric:tabular-nums}
.lp .ln span.q{font-size:12px;color:${COR.ink2}}
.corpo.pd{gap:10px}`;
  const card = (rot, q, v, seta = true) => `<div><small>${rot}</small><span class="q"><b>${q}</b>${seta ? ic('chevron', 16, COR.ink3, 2.4) : ''}</span><small class="tn">${v}</small></div>`;
  const linhas = [
    [CLIENTE.fantasia, PEDIDO.total, 'hoje 09:42', badge('Aguardando aprovação', 'av')],
    ['Supermercado Rio Branco', 'R$ 1.150,00', 'hoje 08:40', badge('Integrado', 'suc')],
    ['Empório Caxangá', 'R$ 3.310,00', 'ontem 15:47', badge('Faturado', 'suc')],
    ['Padaria Pão da Serra', 'R$ 640,00', 'ontem 11:05', `<span class="selo t-des" style="border-radius:999px">Orçamento · preço de 18/11</span>`],
    ['Comercial Paricarana', 'R$ 1.920,00', '17/11', badge('Faturado', 'suc')],
    ['Atacarejo São Vicente', 'R$ 4.624,73', '17/11', badge('Faturado', 'suc')],
    ['Mercearia Caçari', 'R$ 820,00', '16/11', badge('Integrado', 'suc')],
  ];
  return tela({
    hora: '09:45',
    estilo: css,
    cab: cabecalho({ titulo: 'Pedidos', direita: seloSync('09:43') }),
    classeCorpo: 'pd',
    corpo: [
      `<div class="cards">${card('Orçamentos', '1', 'R$ 640,00')}${card('Pedidos', '6', 'R$ 14.304,73')}${card('Total', '7', 'R$ 14.944,73', false)}</div>`,
      `<div style="display:flex;gap:8px">${busca('Cliente ou nº')}<span class="fbtn">${ic('filtro', 20, COR.ink)}</span></div>`,
      `<div class="chips">${['Todos', 'Aguardando', 'Aprovados', 'Orçamentos'].map((c, i) => `<span class="chip${i === 0 ? ' on' : ''}">${c}</span>`).join('')}</div>`,
      `<div class="lp">${linhas.map(([n, v, q, b]) => `<div class="row"><div class="ln"><b>${n}</b><b class="tn">${v}</b></div><div class="ln"><span class="q">${q}</span>${b}</div></div>`).join('')}</div>`,
    ].join(''),
    barra: barraAbas('campo', 'pedidos'),
  });
}

export const TELAS_CAMPO = {
  '12-pedido-venda': venda(),
  '13-pedido-itens': itens(),
  '14-pedido-entrega': entrega(),
  '15-pedido-resumo': resumo(),
  '16-pedido-enviar-para-aprovacao': enviarParaAprovacao(),
  '17-pedido-em-aprovacao': emAprovacao(),
  '18-pedidos': pedidos(),
};

export { venda as vendaDoPedido };
