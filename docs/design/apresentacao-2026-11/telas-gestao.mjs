// Telas do Macuxi Gestão (supervisão da equipe da Carla Lima).
import { badge, barraAbas, cabecalho, COR, seloSync, tela } from './base.mjs';
import { CLIENTE, PEDIDO } from './dados.mjs';

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
    barra: barraAbas('gestao', 'aprovacoes', { aprovacoes: 3 }),
  });
}

export const TELAS_GESTAO = {
  '21-gestao-aprovacoes': aprovacoes(),
};
