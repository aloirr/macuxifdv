/**
 * Repositório da pré-venda (T-0053; RF-VEN-03, RN-VEN-32). As colunas novas do pedido (`tipo`, `validade_ate`,
 * `orcamento_origem_id`, `convertido_pedido_id`) e `pedido_item.quantidade_faturada` são da migração 0013, pedida ao
 * banco-dados. Até ela chegar ao main:
 *  - produção usa `preVendaIndisponivel` (o push de orçamento/conversão é recusado com `PRE_VENDA_INDISPONIVEL`; o app só
 *    oferece orçamento com o parâmetro `orcamento.ativo`, desligado por padrão);
 *  - os testes usam `criarPreVendaEmMemoria()`.
 * T-0071 §1.4 a: a 0013 está no banco; `preVendaSql` (abaixo) é a implementação de produção e o `api/index.ts` a liga.
 * Nomes diferentes entre banco e contrato: `validade_data` = `orcamento_validade` (date, último dia válido no fuso do tenant);
 * `validade_ate` = início do dia seguinte nesse fuso, em UTC (derivado, nunca gravado); `orcamento_origem_id` = `orcamento_id`;
 * `convertido_pedido_id` = id do pedido cujo `orcamento_id` é este orçamento (índice `pedido_orcamento_uk`).
 * Tudo roda dentro da transação do tenant (`db` do `comTenant`, RLS). O `fuso` vem do `ctx.fuso()`.
 */
import type { ClienteBanco } from '@macuxi/platform-sdk';
import type { OrcamentoParaConversao, TipoDocumento } from '../domain';

/** Colunas da pré-venda de um documento (pedido ou orçamento). */
export interface DocumentoPreVenda {
  tipo: TipoDocumento;
  /** instante em UTC: vencido ⇔ agora >= validade_ate (RN-VEN-18) */
  validade_ate: string | null;
  /** AAAA-MM-DD: "até 10/11" sem conta de fuso no app */
  validade_data: string | null;
  orcamento_origem_id: string | null;
  convertido_pedido_id: string | null;
}

export interface RepositorioPreVenda {
  /** `false` enquanto a 0013 não estiver no banco: orçamento e conversão são recusados. */
  readonly disponivel: boolean;
  /** Orçamento para conversão, com trava de linha (duas conversões simultâneas viram uma). */
  buscarOrcamento(db: ClienteBanco, id: string, fuso: string): Promise<OrcamentoParaConversao | null>;
  /** Grava as colunas da pré-venda no documento recém-inserido (mesma transação do insert). */
  marcarDocumento(db: ClienteBanco, id: string, d: Pick<DocumentoPreVenda, 'tipo' | 'validade_data' | 'orcamento_origem_id'> & { validade_ate?: string | null }): Promise<void>;
  /** O orçamento virou o pedido `pedidoId` (RN-VEN-32: uma vez). */
  marcarConvertido(db: ClienteBanco, orcamentoId: string, pedidoId: string): Promise<void>;
  /** Colunas da pré-venda dos documentos (lista e detalhe). Ausente no mapa = pedido sem pré-venda. */
  lerDocumentos(db: ClienteBanco, ids: readonly string[], fuso: string): Promise<Map<string, DocumentoPreVenda>>;
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
      estado.set(id, { ...d, validade_ate: d.validade_ate ?? null, convertido_pedido_id: null });
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

const FORMATO_UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
/** `validade_ate` derivado da data civil no fuso do tenant: início do dia seguinte, em UTC. */
const VALIDADE_ATE = `case when p.orcamento_validade is null then null
  else to_char(((p.orcamento_validade + 1)::timestamp at time zone $FUSO) at time zone 'UTC', ${FORMATO_UTC}) end`;
const CONVERTIDO_EM = `(select c.id from vendedor.pedido c where c.tenant_id = p.tenant_id and c.orcamento_id = p.id and c.deleted_at is null limit 1)`;

interface LinhaDocumento {
  id: string;
  tipo: TipoDocumento;
  validade_data: string | null;
  validade_ate: string | null;
  orcamento_origem_id: string | null;
  convertido_pedido_id: string | null;
}

/**
 * Implementação SQL (T-0071 §1.4 a), usando só colunas da 0013. O orçamento convertido continua `received`; quem diz
 * "convertido" é o pedido filho (`orcamento_id`). Orçamento nunca ganha `aprovado@1`, então nunca entra na fila do ERP.
 */
export const preVendaSql: RepositorioPreVenda = {
  disponivel: true,
  async buscarOrcamento(db, id, fuso) {
    const r = (
      await db.query<LinhaDocumento & { status: string; vendedor_id: string; cliente_id: string }>(
        `select p.id, p.tipo, p.status, p.vendedor_id, p.cliente_id, p.orcamento_validade::text as validade_data,
                ${VALIDADE_ATE.replace('$FUSO', '$2')} as validade_ate, ${CONVERTIDO_EM} as convertido_pedido_id
           from vendedor.pedido p where p.id = $1 and p.tipo = 'orcamento' and p.deleted_at is null for update of p`,
        [id, fuso],
      )
    ).rows[0];
    if (!r) return null;
    return { id: r.id, tipo: r.tipo, status: r.status, vendedor_id: r.vendedor_id, cliente_id: r.cliente_id, validade_ate: r.validade_ate, convertido_pedido_id: r.convertido_pedido_id };
  },
  async marcarDocumento(db, id, d) {
    await db.query('update vendedor.pedido set tipo = $2, orcamento_validade = $3::date, orcamento_id = $4 where id = $1', [id, d.tipo, d.validade_data, d.orcamento_origem_id]);
  },
  async marcarConvertido(db, orcamentoId) {
    await db.query("update vendedor.pedido set convertido_em = clock_timestamp() where id = $1 and tipo = 'orcamento'", [orcamentoId]);
  },
  async lerDocumentos(db, ids, fuso) {
    if (ids.length === 0) return new Map();
    const { rows } = await db.query<LinhaDocumento>(
      `select p.id, p.tipo, p.orcamento_validade::text as validade_data, ${VALIDADE_ATE.replace('$FUSO', '$2')} as validade_ate,
              p.orcamento_id as orcamento_origem_id, ${CONVERTIDO_EM} as convertido_pedido_id
         from vendedor.pedido p where p.id = any($1::uuid[]) and p.deleted_at is null`,
      [ids, fuso],
    );
    return new Map(rows.map((r) => [r.id, { tipo: r.tipo, validade_ate: r.validade_ate, validade_data: r.validade_data, orcamento_origem_id: r.orcamento_origem_id, convertido_pedido_id: r.convertido_pedido_id }]));
  },
};

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
