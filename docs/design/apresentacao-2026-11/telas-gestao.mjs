// Telas do Macuxi Gestão (supervisão da equipe da Carla Lima).
import { badge, barraAbas, busca, cabecalho, COR, ic, seloSync, tela } from './base.mjs';
import { CLIENTE, PEDIDO, VENDEDORA } from './dados.mjs';
import { clientes } from './telas-dia.mjs';

/** Carteira da equipe no Gestão: a mesma tela Clientes (modules/core/app/telas/clientes.tsx), com os clientes da equipe. */
function carteira() {
  return clientes({
    variante: 'gestao',
    hora: '09:46',
    total: 186,
    sync: '09:44',
    lista: [
      ['Atacadão Norte', 'Visitado ontem', 'Em dia', 'suc'],
      ['Atacarejo São Vicente', 'Visitado há 2 dias', 'Em dia', 'suc'],
      ['Comercial Paricarana', 'Visitado há 2 dias', 'Em dia', 'suc'],
      ['Distribuidora Cauamé', 'Visitado há 5 dias', 'Bloqueado', 'err'],
      ['Empório Caxangá', 'Visitado ontem', 'Em dia', 'suc'],
      [CLIENTE.fantasia, 'Visitado hoje', 'Devendo', 'err'],
      ['Mercearia Caçari', 'Visitado há 3 dias', 'Em dia', 'suc'],
      ['Mercearia São José', 'Visitado há 4 dias', 'Em dia', 'suc'],
      ['Padaria Pão da Serra', 'Visitado hoje', 'Em dia', 'suc'],
    ],
  });
}

/**
 * Pedido em nome do vendedor (new-order-screen.tsx, seletor em nome; RN-VEN-35): aberto da ficha da Carla na Equipe, a lista
 * traz só os clientes da carteira dela; o pedido sai no nome dela.
 */
function pedidoEmNome() {
  const css = `
.nota-c{font-size:12px;color:${COR.ink2}}
.cd{background:#fff;border:1px solid ${COR.line};border-radius:14px;overflow:hidden}
.cd .r{display:flex;align-items:center;gap:12px;padding:11px 14px;min-height:56px}
.cd .r+.r{border-top:1px solid ${COR.lineSoft}}
.cd .c{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.cd b{font-size:16px;font-weight:600}.cd small{font-size:12px;color:${COR.ink2}}
.corpo.sel{gap:12px;padding-top:16px}`;
  const lista = [
    ['Atacarejo São Vicente', 'Boa Vista · São Vicente'],
    ['Comercial Paricarana', 'Boa Vista · Paraviana'],
    ['Empório Caxangá', 'Boa Vista · Centro'],
    [CLIENTE.fantasia, 'Boa Vista · Centro'],
    ['Mercearia Caçari', 'Boa Vista · Caçari'],
    ['Mercearia Santa Luzia', 'Boa Vista · Mecejana'],
    ['Padaria Pão da Serra', 'Boa Vista · Aparecida'],
    ['Supermercado Rio Branco', 'Boa Vista · Pricumã'],
  ];
  return tela({
    hora: '10:31',
    estilo: css,
    cab: cabecalho({ titulo: 'Novo pedido', subtitulo: 'Para qual cliente?', voltar: 'Ficha' }),
    classeCorpo: 'sel',
    corpo: [
      `<span class="nota-c">Clientes da carteira de ${VENDEDORA.nome}</span>`,
      `<div style="display:flex">${busca('Nome, código ou bairro')}</div>`,
      `<div class="cd">${lista.map(([n, l]) => `<div class="r"><div class="c"><b>${n}</b><small>${l}</small></div>${ic('chevron', 16, COR.ink3)}</div>`).join('')}</div>`,
    ].join(''),
    barra: barraAbas('gestao', 'equipe'),
  });
}

/** Aprovações (modules/gestor/app/screens/aprovacoes-screen.tsx) com a P-6: um item por motivo, cada um com a sua decisão. */
function aprovacoes() {
  const css = `
.res{font-size:14px;color:${COR.ink2}}
.fila{background:#fff;border:1px solid ${COR.line};border-radius:14px;overflow:hidden}
.fila .it{display:flex;flex-direction:column;gap:4px;min-height:56px;padding:11px 14px}
.fila .it+.it{border-top:1px solid ${COR.lineSoft}}
.fila .ln{display:flex;justify-content:space-between;align-items:center;gap:8px}
.fila b{font-size:16px;font-weight:600}.fila b.tn{font-variant-numeric:tabular-nums}
.fila small{font-size:12px;color:${COR.ink2}}
.fila .dec{font-size:12px;font-weight:600;color:${COR.accentInk};min-height:24px;display:flex;align-items:center}
.corpo.ap{padding:16px 20px 20px}`;
  const itens = [
    [CLIENTE.fantasia, PEDIDO.total, `Nº ${PEDIDO.numero} · Crédito disponível ${CLIENTE.disponivel}`, badge('Vence hoje', 'av')],
    [CLIENTE.fantasia, PEDIDO.total, `Nº ${PEDIDO.numero} · Inadimplente há 12 dias`, badge('Vence hoje', 'av')],
    ['Supermercado Rio Branco', 'R$ 1.150,00', 'Nº 000020 · Desconto 12%', badge('1 dia útil', 'neu')],
  ];
  return tela({
    hora: '09:50',
    estilo: css,
    cab: cabecalho({ titulo: 'Aprovações', direita: seloSync('09:49') }),
    classeCorpo: 'ap',
    corpo: [
      '<span class="res">3 para você · 0 vencidos · 2 vencendo</span>',
      `<div class="fila">${itens.map(([n, v, m, c]) => `<div class="it"><div class="ln"><b>${n}</b><b class="tn">${v}</b></div><small>${m}</small><div class="ln">${c}<span class="dec">Decidir</span></div></div>`).join('')}</div>`,
    ].join(''),
    barra: barraAbas('gestao', 'aprovacoes'),
  });
}

export const TELAS_GESTAO = {
  '20-gestao-carteira': carteira(),
  '21-gestao-aprovacoes': aprovacoes(),
  '22-gestao-pedido-em-nome-do-vendedor': pedidoEmNome(),
};
