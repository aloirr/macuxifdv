/**
 * ADR 0016: o pedido que usa recurso novo (venda por embalagem, acréscimo, frete FOB, endereço de entrega que não é o principal)
 * só pode ser entregue a um Conector que o entenda (>= 1.3.0). O 1.2.x descartaria os campos novos sem avisar e o ERP gravaria um
 * pedido incompleto. UN + CIF + endereço principal continua indo ao 1.2.1. Nada é recusado: o pedido espera na fila.
 */
import type { PedidoParaErp } from '../contracts';
import { compararSemver, lerSemver } from './conector-versao';

export const VERSAO_CONECTOR_PEDIDO_AMPLIADO = '1.3.0';

type PedidoConferivel = Pick<PedidoParaErp, 'itens'> & Partial<Pick<PedidoParaErp, 'acrescimo_pct' | 'acrescimo_total_cents' | 'frete' | 'endereco_entrega'>>;

/** Versão mínima do Conector para levar o pedido, ou `null` quando o 1.2.1 dá conta. */
export function exigeConector(p: PedidoConferivel): string | null {
  const usaNovo =
    (p.itens ?? []).some((i) => (i.fator ?? 1) > 1 || (i.acrescimo_pct ?? 0) > 0 || (i.acrescimo_cents ?? 0) > 0) ||
    (p.acrescimo_pct ?? 0) > 0 ||
    (p.acrescimo_total_cents ?? 0) > 0 ||
    p.frete?.modalidade === 'FOB' ||
    (p.endereco_entrega != null && p.endereco_entrega.principal !== true);
  return usaNovo ? VERSAO_CONECTOR_PEDIDO_AMPLIADO : null;
}

/** O Conector (versão do cabeçalho) entende o pedido? Sem exigência = sim; versão desconhecida ou ilegível não atende exigência. */
export function conectorAtendePedido(versaoConector: string | null | undefined, exige: string | null | undefined): boolean {
  if (!exige) return true;
  if (typeof versaoConector !== 'string' || lerSemver(versaoConector) === null) return false;
  return compararSemver(versaoConector, exige) >= 0;
}

/** Pedidos da fila (pendentes ou enviados) cuja exigência o Conector que recebe pedidos NÃO atende: base do alerta do monitor. */
export function pedidosAguardandoConector(
  pedidos: readonly { pedido_uuid: string; exige_conector: string | null }[],
  versaoConector: string | null | undefined,
): { pedidos: string[]; exigida: string | null } {
  const esperando = pedidos.filter((p) => !conectorAtendePedido(versaoConector, p.exige_conector));
  const exigida = esperando.reduce<string | null>((m, p) => (p.exige_conector && (m === null || compararSemver(p.exige_conector, m) > 0) ? p.exige_conector : m), null);
  return { pedidos: esperando.map((p) => p.pedido_uuid), exigida };
}
