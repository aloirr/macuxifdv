/**
 * Repositório da pré-venda (T-0053; RF-VEN-03, RN-VEN-32). As colunas novas do pedido (`tipo`, `validade_ate`,
 * `orcamento_origem_id`, `convertido_pedido_id`) e `pedido_item.quantidade_faturada` são da migração 0013, pedida ao
 * banco-dados. Até ela chegar ao main:
 *  - produção usa `preVendaIndisponivel` (o push de orçamento/conversão é recusado com `PRE_VENDA_INDISPONIVEL`; o app só
 *    oferece orçamento com o parâmetro `orcamento.ativo`, desligado por padrão);
 *  - os testes usam `criarPreVendaEmMemoria()`.
 * Quando a 0013 chegar, a implementação SQL entra aqui (mesma interface) e `usarPreVenda` passa a apontar para ela.
 * Tudo roda dentro da transação do tenant (`db` do `comTenant`, RLS).
 */
import type { ClienteBanco } from '@macuxi/platform-sdk';
import type { OrcamentoParaConversao, TipoDocumento } from '../domain';

/** Colunas da pré-venda de um documento (pedido ou orçamento). */
export interface DocumentoPreVenda {
  tipo: TipoDocumento;
  validade_ate: string | null;
  orcamento_origem_id: string | null;
  convertido_pedido_id: string | null;
}

export interface RepositorioPreVenda {
  /** `false` enquanto a 0013 não estiver no banco: orçamento e conversão são recusados. */
  readonly disponivel: boolean;
  /** Orçamento para conversão, com trava de linha (duas conversões simultâneas viram uma). */
  buscarOrcamento(db: ClienteBanco, id: string): Promise<OrcamentoParaConversao | null>;
  /** Grava as colunas da pré-venda no documento recém-inserido (mesma transação do insert). */
  marcarDocumento(db: ClienteBanco, id: string, d: Pick<DocumentoPreVenda, 'tipo' | 'validade_ate' | 'orcamento_origem_id'>): Promise<void>;
  /** O orçamento virou o pedido `pedidoId` (RN-VEN-32: uma vez). */
  marcarConvertido(db: ClienteBanco, orcamentoId: string, pedidoId: string): Promise<void>;
  /** Colunas da pré-venda dos documentos (lista e detalhe). Ausente no mapa = pedido sem pré-venda. */
  lerDocumentos(db: ClienteBanco, ids: readonly string[]): Promise<Map<string, DocumentoPreVenda>>;
}

export const preVendaIndisponivel: RepositorioPreVenda = {
  disponivel: false,
  async buscarOrcamento() {
    return null;
  },
  async marcarDocumento() {
    throw new Error('pré-venda indisponível: migração 0013 pendente');
  },
  async marcarConvertido() {
    throw new Error('pré-venda indisponível: migração 0013 pendente');
  },
  async lerDocumentos() {
    return new Map();
  },
};

/**
 * Implementação em memória (testes e demonstração). Só guarda as colunas da pré-venda; o restante do documento continua
 * em `vendedor.pedido`. `estado` é exposto para o teste conferir.
 */
export function criarPreVendaEmMemoria(): RepositorioPreVenda & { estado: Map<string, DocumentoPreVenda & { vendedor_id?: string; cliente_id?: string; status?: string }> } {
  const estado = new Map<string, DocumentoPreVenda & { vendedor_id?: string; cliente_id?: string; status?: string }>();
  return {
    disponivel: true,
    estado,
    async buscarOrcamento(db, id) {
      const d = estado.get(id);
      if (!d || d.tipo !== 'orcamento') return null;
      // o restante vem da linha do pedido (mesma transação); a trava é a da linha
      const l = (await db.query<{ vendedor_id: string; cliente_id: string; status: string }>('select vendedor_id, cliente_id, status from vendedor.pedido where id = $1 for update', [id])).rows[0];
      if (!l) return null;
      return { id, tipo: d.tipo, status: l.status, vendedor_id: l.vendedor_id, cliente_id: l.cliente_id, validade_ate: d.validade_ate, convertido_pedido_id: d.convertido_pedido_id };
    },
    async marcarDocumento(_db, id, d) {
      estado.set(id, { ...d, convertido_pedido_id: null });
    },
    async marcarConvertido(_db, orcamentoId, pedidoId) {
      const d = estado.get(orcamentoId);
      if (d) estado.set(orcamentoId, { ...d, convertido_pedido_id: pedidoId });
    },
    async lerDocumentos(_db, ids) {
      return new Map(ids.flatMap((id) => (estado.has(id) ? [[id, estado.get(id)!] as const] : [])));
    },
  };
}

let atual: RepositorioPreVenda = preVendaIndisponivel;

/** Repositório em uso pela API do Vendedor. */
export function preVenda(): RepositorioPreVenda {
  return atual;
}

/** Troca o repositório (teste ou, com a 0013, a implementação SQL). Devolve a função que restaura o anterior. */
export function usarPreVenda(r: RepositorioPreVenda): () => void {
  const anterior = atual;
  atual = r;
  return () => {
    atual = anterior;
  };
}
