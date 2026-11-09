/**
 * Cards do Início (T-0076): junta os pedidos do aparelho (servidor + fila) com as regras do domain. Puro, sem React.
 * Só a carteira do usuário (RN-PRO-01 e escopo: pedidos de outro vendedor ficam de fora). Orçamento sem a pré-venda ligada
 * no tenant não aparece (`orcamentos: null`).
 */
import { formatBRL0 } from '@macuxi/comum';
import { orcamentoEmAberto, resumoAFaturar, resumoOrcamentos, type DocumentoDoInicio, type ResumoAFaturar, type ResumoOrcamentos } from '../../domain/resumo-inicio';
import type { PedidoDaLista } from './pedidos';

export interface ResumoDoInicio {
  orcamentos: ResumoOrcamentos | null;
  aFaturar: ResumoAFaturar;
}

function documentoDoInicio(p: PedidoDaLista): DocumentoDoInicio {
  return {
    tipo: p.tipo,
    status: p.status,
    local: p.local,
    total_cents: p.total_cents,
    convertido_pedido_id: p.convertido_pedido_id ?? null,
  };
}

/** T-0076 V1: o filtro vindo do card Orçamentos usa a mesma regra do card (RN-VEN-18, `orcamentoEmAberto`). */
export function orcamentosEmAberto<T extends PedidoDaLista>(pedidos: readonly T[]): T[] {
  return pedidos.filter((p) => orcamentoEmAberto(documentoDoInicio(p)));
}

export function resumoDoInicio(pedidos: readonly PedidoDaLista[], o: { vendedorId: string | null; preVendaLigada: boolean }): ResumoDoInicio {
  const meus = o.vendedorId ? pedidos.filter((p) => p.seller_id === o.vendedorId) : [...pedidos];
  const docs = meus.map((p) => documentoDoInicio(p));
  return {
    orcamentos: o.preVendaLigada ? resumoOrcamentos(docs) : null,
    aFaturar: resumoAFaturar(docs),
  };
}

/** "R$ 1.150" (o orçamento não expira: sem "vence amanhã", RN-VEN-18). */
export function linhaOrcamentos(r: ResumoOrcamentos): string {
  return formatBRL0(r.valor_cents);
}

/** RD-0010: cartão do Início, linha Orçamentos: sem nenhum, só "nenhum" (sem "0 · R$ 0"). */
export function textoCartaoOrcamentos(r: ResumoOrcamentos): string {
  return r.quantidade === 0 ? 'nenhum' : `${r.quantidade} · ${linhaOrcamentos(r)}`;
}

/** RD-0011: cartão do Início, linha de pedidos a faturar: "6 · R$ 3.989 (1 aguardando aprovação)"; sem nenhum, "nenhum". */
export function textoCartaoAFaturar(r: ResumoAFaturar): string {
  if (r.quantidade === 0) return 'nenhum';
  const valor = formatBRL0(r.valor_cents);
  return r.aguardando_aprovacao > 0 ? `${r.quantidade} · ${valor} (${r.aguardando_aprovacao} aguardando aprovação)` : `${r.quantidade} · ${valor}`;
}
