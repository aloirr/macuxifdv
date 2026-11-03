/**
 * Leitura de pedidos pelo perfil Promotor (RN-PRO-01 e observação O-3 do doc 03; decisão de 2026-11-02).
 * O promotor nunca escreve em pedido. A LEITURA (somente, com escopo de carteira) é uma opção do perfil Promotor,
 * `promotor_ve_pedidos`, ligada por padrão. Os demais perfis não dependem da opção (quem decide é a matriz de ações).
 */
export type DecisaoLeituraPedido = { ok: true } | { ok: false; codigo: 'RN-PRO-01'; http: 403; mensagem: string };

/** `opcaoPromotorVePedidos` = valor atual da opção `promotor_ve_pedidos` do tenant (lida pela API num ponto único). */
export function podeLerPedidos(perfil: string, opcaoPromotorVePedidos: boolean): DecisaoLeituraPedido {
  if (perfil === 'promotor' && !opcaoPromotorVePedidos) {
    return {
      ok: false,
      codigo: 'RN-PRO-01',
      http: 403,
      mensagem: 'Seu perfil não consulta pedidos nesta empresa. Se precisar dessa visão, peça ao administrador para ligar a opção "Promotor vê pedidos".',
    };
  }
  return { ok: true };
}
