/**
 * `RepositorioRetornoErp` em memória (T-0054): testes sem banco e base para a demo enquanto a migração do faturamento não
 * chega. Imita o RLS: cada repositório enxerga só o próprio `tenant_id` do armazenamento compartilhado.
 */
import type { FaturamentoRegistrado, ResumoFaturamento } from '../domain';
import type { OrderStatus } from '../domain/order';
import type {
  AtualizacaoDoPedido,
  DevolucaoParaGravar,
  FaturamentoParaGravar,
  LinhaDoTempo,
  PedidoParaRetorno,
  RepositorioRetornoErp,
} from './retorno-erp';

export interface PedidoEmMemoria extends PedidoParaRetorno {
  tenant_id: string;
  motivo_rejeicao: string | null;
  motivo_cancelamento: string | null;
  resumo: ResumoFaturamento | null;
}

export interface BancoEmMemoria {
  pedidos: PedidoEmMemoria[];
  faturamentos: Array<FaturamentoParaGravar & { tenant_id: string }>;
  devolucoes: Array<DevolucaoParaGravar & { tenant_id: string; deleted_at: string | null }>;
  linhaDoTempo: Array<LinhaDoTempo & { tenant_id: string; pedido_id: string }>;
}

export const bancoEmMemoria = (pedidos: PedidoEmMemoria[] = []): BancoEmMemoria => ({ pedidos, faturamentos: [], devolucoes: [], linhaDoTempo: [] });

/** `semFaturamento`: imita o banco ANTES da migração do faturamento (sem nota, sem resumo, sem devolução). */
export function repositorioRetornoErpMemoria(banco: BancoEmMemoria, tenantId: string, opcoes: { semFaturamento?: boolean } = {}): RepositorioRetornoErp {
  const sem = opcoes.semFaturamento ?? false;
  const pedido = (id: string) => banco.pedidos.find((p) => p.tenant_id === tenantId && p.id === id) ?? null;
  return {
    async pedidoParaRetorno(id) {
      const p = pedido(id);
      return p ? { id: p.id, vendedor_id: p.vendedor_id, status: p.status, numero_erp: p.numero_erp, itens: p.itens.map((i) => ({ ...i })) } : null;
    },
    async faturamentos(pedidoId): Promise<FaturamentoRegistrado[] | null> {
      if (sem) return null;
      return banco.faturamentos
        .filter((f) => f.tenant_id === tenantId && f.pedido_id === pedidoId)
        .sort((a, b) => a.faturado_em.localeCompare(b.faturado_em))
        .map((f) => ({
          nota_numero: f.nota_numero,
          nota_total_cents: f.nota_total_cents,
          faturado_em: f.faturado_em,
          itens: f.itens.map((i) => ({ sequencia: i.sequencia, quantidade: i.quantity, valor_cents: i.valor_cents })),
        }));
    },
    async devolucoes(pedidoId) {
      return banco.devolucoes
        .filter((d) => d.tenant_id === tenantId && d.pedido_id === pedidoId && !d.deleted_at)
        .map((d) => ({ external_id: d.external_id, total_cents: d.total_cents }));
    },
    async atualizarPedido(id: string, a: AtualizacaoDoPedido) {
      const p = pedido(id);
      if (!p) return;
      p.status = a.status as OrderStatus;
      p.numero_erp = a.numero_erp;
      p.motivo_rejeicao = a.motivo_rejeicao ?? p.motivo_rejeicao;
      p.motivo_cancelamento = a.motivo_cancelamento ?? p.motivo_cancelamento;
    },
    async registrarLinhaDoTempo(id, l) {
      if (l.de === l.para) throw new Error('pedido_evento_transicao: de = para');
      banco.linhaDoTempo.push({ ...l, tenant_id: tenantId, pedido_id: id });
    },
    async gravarFaturamento(f) {
      if (sem) return true;
      if (banco.faturamentos.some((x) => x.tenant_id === tenantId && x.evento_origem_id === f.evento_origem_id)) return false;
      banco.faturamentos.push({ ...f, itens: f.itens.map((i) => ({ ...i })), tenant_id: tenantId });
      return true;
    },
    async gravarDevolucao(d) {
      if (sem) return null;
      if (!pedido(d.pedido_id)) return null;
      const atual = banco.devolucoes.find((x) => x.tenant_id === tenantId && x.external_id === d.external_id && !x.deleted_at);
      if (atual) {
        const anterior = atual.pedido_id;
        Object.assign(atual, d);
        return { pedido_anterior: anterior };
      }
      banco.devolucoes.push({ ...d, tenant_id: tenantId, deleted_at: null });
      return { pedido_anterior: null };
    },
    async removerDevolucao(externalId, quando) {
      const atual = banco.devolucoes.find((x) => x.tenant_id === tenantId && x.external_id === externalId && !x.deleted_at);
      if (!atual) return null;
      atual.deleted_at = quando;
      return atual.pedido_id;
    },
    async gravarResumo(pedidoId, r) {
      if (sem) return;
      const p = pedido(pedidoId);
      if (p) p.resumo = r;
    },
  };
}
