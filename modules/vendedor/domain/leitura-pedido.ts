export type DecisaoLeituraPedido = { ok: true } | { ok: false; codigo: 'RN-PRO-01'; http: 403; mensagem: string };

/** RN-PRO-01 (ADR 0073 §2.4 E6): `ve` = leitura já resolvida pela API; só `!ve` vira 403. */
export function podeLerPedidos(ve: boolean): DecisaoLeituraPedido {
  if (!ve) {
    return {
      ok: false,
      codigo: 'RN-PRO-01',
      http: 403,
      mensagem: 'Seu perfil não consulta pedidos nesta empresa. Se precisar dessa visão, peça ao administrador para ligar a opção "Promotor vê pedidos".',
    };
  }
  return { ok: true };
}
