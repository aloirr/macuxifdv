/**
 * Os 3 cards da tela Pedidos, no Campo e no Gestão (T-0170, RN-VEN-47; decisões D5 e D6): orçamentos em aberto, pedidos
 * enviados e o total, cada um com quantidade e valor. Função pura, sem relógio: o período e o fuso chegam por parâmetro.
 * Dinheiro em centavos (`total_cents`, sem frete, RN-VEN-02).
 */
import { localIsoDate } from '@macuxi/comum/fuso';
import { intervaloDoPeriodo, type Periodo } from './busca-periodo';
import { TODOS_OS_VENDEDORES } from './filtro-vendedor';
import type { OrderStatus } from './order';
import { orcamentoEmAberto } from './resumo-inicio';

export interface DocumentoDoResumo {
  /** ausente = pedido (linhas antigas) */
  tipo?: 'pedido' | 'orcamento';
  status: string;
  total_cents: number;
  convertido_pedido_id?: string | null;
  /** ainda na fila do aparelho (não chegou ao servidor) */
  local?: boolean;
  /** ISO UTC da emissão (`received_at`); no orçamento, de quando foi salvo */
  emitido_em: string;
  /** necessário só com o filtro de vendedor (Gestão) */
  seller_id?: string;
}

export interface QuantidadeEValor {
  quantidade: number;
  valor_cents: number;
}

export interface ResumoDePedidos {
  orcamentos: QuantidadeEValor;
  enviados: QuantidadeEValor;
  total: QuantidadeEValor;
}

/** RN-VEN-47: do "Enviado" do histórico (RN-VEN-30) em diante. Fora: rascunho, na fila, recusado e cancelado. */
export const STATUS_ENVIADO = [
  'received',
  'pending_approval',
  'approved',
  'sent_to_erp',
  'integrated',
  'invoiced_partial',
  'invoiced',
] as const satisfies readonly OrderStatus[];

/** RN-VEN-47: pedido que chegou ao servidor e não foi recusado nem cancelado. Regra do card e do filtro vindo do card. */
export function pedidoEnviado(d: Pick<DocumentoDoResumo, 'tipo' | 'status' | 'local'>): boolean {
  return d.tipo !== 'orcamento' && !d.local && (STATUS_ENVIADO as readonly string[]).includes(d.status);
}

/** RN-VEN-47: o card Total. Também soma o resumo que vem do servidor fora da janela do aparelho. */
export function totalDoResumo(orcamentos: QuantidadeEValor, enviados: QuantidadeEValor): QuantidadeEValor {
  return { quantidade: orcamentos.quantidade + enviados.quantidade, valor_cents: orcamentos.valor_cents + enviados.valor_cents };
}

/**
 * RN-VEN-47: os 3 cards do período, pela data de emissão no fuso do tenant (D5: a data da mudança de status não conta).
 * `vendedorId` (Gestão, D6): ausente ou "todos" soma a equipe; senão, só o vendedor. Busca e chip de situação não entram.
 */
export function resumoDePedidos(
  docs: readonly DocumentoDoResumo[],
  o: { periodo: Periodo; tz: string; vendedorId?: string },
): ResumoDePedidos {
  const { from, to } = intervaloDoPeriodo(o.periodo);
  const todos = !o.vendedorId || o.vendedorId === TODOS_OS_VENDEDORES;
  const orcamentos: QuantidadeEValor = { quantidade: 0, valor_cents: 0 };
  const enviados: QuantidadeEValor = { quantidade: 0, valor_cents: 0 };
  for (const d of docs) {
    if (!todos && d.seller_id !== o.vendedorId) continue;
    const card = orcamentoEmAberto(d) ? orcamentos : pedidoEnviado(d) ? enviados : null;
    if (!card) continue;
    const dia = localIsoDate(d.emitido_em, o.tz);
    if (dia < from || dia > to) continue;
    card.quantidade += 1;
    card.valor_cents += d.total_cents;
  }
  return { orcamentos, enviados, total: totalDoResumo(orcamentos, enviados) };
}
