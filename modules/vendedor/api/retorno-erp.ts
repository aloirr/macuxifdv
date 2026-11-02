/**
 * Retorno do ERP no Vendedor (T-0054; desenho T-0011 §1 e §4; ADR 0007):
 *  - consumidor de `integracao.pedido.retorno_erp@1`: aplica o status (RN-INT-08/RN-VEN-30), grava o número do ERP, a
 *    linha do tempo, a nota e os itens faturados; publica `vendedor.pedido.status_alterado@1` e
 *    `vendedor.pedido.faturado@1` (RN-TRE-08) na MESMA transação do despachante (efeito + marca de consumo juntos);
 *  - consumidor de `integracao.nota.atualizado@1`: nota de devolução com `pedido_uuid` (RN-VEN-37, proposta).
 * As decisões são do domínio (`domain/retorno-erp.ts`); aqui só se lê, decide e grava, atrás do `RepositorioRetornoErp`
 * (Postgres em produção; memória nos testes sem banco). Licença: o despachante só entrega a quem tem o Vendedor ativo no
 * tenant (RN-CORE-02/03); RLS do tenant do evento (macuxi_app). Log sem dado pessoal: só ids, códigos e contagens.
 *
 * `FATURAMENTO_LIGADO`: as tabelas `vendedor.pedido_faturamento`/`pedido_devolucao` e as colunas de resumo do pedido
 * dependem da migração pedida ao banco-dados (T-0054). Enquanto ela não chega ao `main`, os consumidores NÃO são
 * registrados e o pull/detalhe não leem as colunas novas; quando chegar, basta virar a constante (ver
 * docs/modulos/vendedor/retorno-erp.md).
 */
import { definirConsumidor, type ClienteBanco, type ConsumidorEvento, type ContextoConsumo, type LogRota } from '@macuxi/platform-sdk';
import { EVENTO_PEDIDO_FATURADO, EVENTO_PEDIDO_STATUS_ALTERADO } from '../contracts';
import {
  decidirNotaDevolucao,
  decidirRetornoErp,
  eventoFaturadoDosItens,
  itensDoFaturamento,
  resumoFaturamento,
  statusDoContrato,
  type FaturamentoRegistrado,
  type ItemFaturadoNoPedido,
  type ResumoFaturamento,
} from '../domain';
import type { OrderStatus } from '../domain/order';
import { EVENTO_NOTA_ATUALIZADA, EVENTO_RETORNO_ERP } from './eventos-consumidos';

/** Liga os consumidores, o pull e o detalhe do faturamento. Vira `true` com a migração do banco-dados (T-0054). */
export const FATURAMENTO_LIGADO = false;

// ---------------------------------------------------------------------------------------------------- repositório
export interface PedidoParaRetorno {
  id: string;
  vendedor_id: string;
  status: OrderStatus;
  numero_erp: string | null;
  itens: Array<{ sequencia: number; product_id: string; quantity: number; total_cents: number }>;
}
export interface FaturamentoParaGravar {
  pedido_id: string;
  /** `evento_id` do retorno: idempotência da nota (unique por tenant) */
  evento_origem_id: string;
  status_retorno: 'faturado_parcial' | 'faturado_total';
  parcial: boolean;
  nota_numero: string | null;
  nota_serie: string | null;
  nota_emitida_em: string | null;
  nota_total_cents: number | null;
  faturado_em: string;
  itens: ItemFaturadoNoPedido[];
}
export interface DevolucaoParaGravar {
  pedido_id: string;
  external_id: string;
  numero: string;
  serie: string | null;
  emitida_em: string;
  total_cents: number;
}
export interface AtualizacaoDoPedido {
  status: OrderStatus;
  numero_erp: string | null;
  motivo_rejeicao: string | null;
  motivo_cancelamento: string | null;
}
export interface LinhaDoTempo {
  de: OrderStatus;
  para: OrderStatus;
  motivo: string;
  ocorrido_em: string;
}

/** Acesso a dados do retorno do ERP, sempre no tenant da transação (RLS). */
export interface RepositorioRetornoErp {
  /** Pedido com os itens, travado para a atualização; `null` = inexistente no tenant ou removido. */
  pedidoParaRetorno(id: string): Promise<PedidoParaRetorno | null>;
  faturamentos(pedidoId: string): Promise<FaturamentoRegistrado[]>;
  devolucoes(pedidoId: string): Promise<Array<{ external_id: string; total_cents: number }>>;
  atualizarPedido(id: string, a: AtualizacaoDoPedido): Promise<void>;
  registrarLinhaDoTempo(id: string, l: LinhaDoTempo): Promise<void>;
  /** `false` = a nota deste evento já estava gravada (reentrega). */
  gravarFaturamento(f: FaturamentoParaGravar): Promise<boolean>;
  /** `null` = pedido inexistente no tenant; `pedido_anterior` = a nota estava em outro pedido. */
  gravarDevolucao(d: DevolucaoParaGravar): Promise<{ pedido_anterior: string | null } | null>;
  /** Remove (soft delete) a devolução pela nota; devolve o pedido afetado ou `null` se não havia. */
  removerDevolucao(externalId: string, quando: string): Promise<string | null>;
  /** Resumo no pedido e nos itens (é o que o pull leva ao aparelho). */
  gravarResumo(pedidoId: string, r: ResumoFaturamento): Promise<void>;
}

export interface ContextoRetorno {
  evento_id: string;
  publicar: ContextoConsumo['publicar'];
  log: LogRota;
  agora(): Date;
}

async function recalcularResumo(repo: RepositorioRetornoErp, pedido: PedidoParaRetorno): Promise<ResumoFaturamento> {
  const r = resumoFaturamento(pedido.itens, await repo.faturamentos(pedido.id), await repo.devolucoes(pedido.id));
  await repo.gravarResumo(pedido.id, r);
  return r;
}

// ---------------------------------------------------------------------------------------------------- retorno do ERP
export interface RetornoRecebido {
  pedido_uuid: string;
  status: string;
  numero_erp: string | null;
  motivo: string | null;
  nota: { numero: string; serie?: string | null; emitida_em?: string; total_cents?: number } | null;
  itens_faturados?: Array<{ sequencia: number; quantidade: number; valor_cents?: number | null }> | null;
  ocorrido_em: string;
}

export type ResultadoRetorno =
  | { aplicado: false; motivo: string }
  | { aplicado: true; de: OrderStatus; para: OrderStatus; faturado_publicado: boolean };

/** RN-INT-08 / RN-VEN-30 / RN-TRE-08: aplica um retorno do ERP no pedido (uma transação, chamada pelo consumidor). */
export async function aplicarRetornoErp(repo: RepositorioRetornoErp, r: RetornoRecebido, ctx: ContextoRetorno): Promise<ResultadoRetorno> {
  const pedido = await repo.pedidoParaRetorno(r.pedido_uuid);
  if (!pedido) {
    ctx.log.warn({ pedido_id: r.pedido_uuid, codigo: 'pedido_inexistente', status_erp: r.status }, 'retorno do ERP sem pedido no Vendedor');
    return { aplicado: false, motivo: 'pedido_inexistente' };
  }
  const d = decidirRetornoErp(pedido.status, { status: r.status, numero_erp: r.numero_erp, motivo: r.motivo, nota: r.nota, ocorrido_em: r.ocorrido_em }, pedido.numero_erp);
  if (!d.aplicar) {
    ctx.log.info({ pedido_id: pedido.id, codigo: d.motivo, status_erp: r.status, status: pedido.status }, 'retorno do ERP sem efeito no pedido');
    return { aplicado: false, motivo: d.motivo };
  }

  if (d.mudouStatus || d.numero_erp !== pedido.numero_erp) {
    await repo.atualizarPedido(pedido.id, { status: d.para, numero_erp: d.numero_erp, motivo_rejeicao: d.motivo_rejeicao, motivo_cancelamento: d.motivo_cancelamento });
  }
  if (d.mudouStatus) {
    await repo.registrarLinhaDoTempo(pedido.id, { de: d.de, para: d.para, motivo: d.historico, ocorrido_em: r.ocorrido_em });
    await ctx.publicar(
      EVENTO_PEDIDO_STATUS_ALTERADO,
      { pedido_id: pedido.id, vendedor_id: pedido.vendedor_id, de: statusDoContrato(d.de), para: statusDoContrato(d.para), alterado_em: r.ocorrido_em, autor_id: null, motivo: d.historico || null },
      pedido.id,
    );
  }

  let faturadoPublicado = false;
  if (d.registraFaturamento && (r.status === 'faturado_parcial' || r.status === 'faturado_total')) {
    const anteriores = await repo.faturamentos(pedido.id);
    const ja = anteriores.flatMap((f) => f.itens.map((i) => ({ sequencia: i.sequencia, quantidade: i.quantidade })));
    const { itens, divergencias } = itensDoFaturamento(r.status, r.itens_faturados, pedido.itens, ja);
    for (const x of divergencias) ctx.log.warn({ pedido_id: pedido.id, sequencia: x.sequencia, codigo: x.codigo, informada: x.informada, aceita: x.aceita }, 'item faturado divergente');
    if (r.status === 'faturado_parcial' && !r.itens_faturados?.length) ctx.log.info({ pedido_id: pedido.id, codigo: 'faturamento_sem_itens' }, 'faturamento parcial sem itens');
    const gravou = await repo.gravarFaturamento({
      pedido_id: pedido.id,
      evento_origem_id: ctx.evento_id,
      status_retorno: r.status,
      parcial: d.parcial,
      nota_numero: r.nota?.numero ?? null,
      nota_serie: r.nota?.serie ?? null,
      nota_emitida_em: r.nota?.emitida_em ?? null,
      nota_total_cents: r.nota?.total_cents ?? null,
      faturado_em: r.ocorrido_em,
      itens,
    });
    const ev = gravou ? eventoFaturadoDosItens({ id: pedido.id, vendedor_id: pedido.vendedor_id }, r.ocorrido_em, d.parcial, itens) : null;
    if (ev) {
      await ctx.publicar(EVENTO_PEDIDO_FATURADO, ev, pedido.id);
      faturadoPublicado = true;
    }
    await recalcularResumo(repo, pedido);
  }
  return { aplicado: true, de: d.de, para: d.para, faturado_publicado: faturadoPublicado };
}

// ---------------------------------------------------------------------------------------------------- devolução
export interface NotaRecebida {
  acao: string;
  external_id: string;
  registro?: { tipo: string; pedido_uuid?: string | null; numero: string; serie?: string | null; emitida_em: string; total_cents: number; cancelada?: boolean };
}

/** RN-VEN-37 (proposta): grava ou remove a devolução do pedido e refaz o resumo dos pedidos afetados. */
export async function aplicarNotaDevolucao(repo: RepositorioRetornoErp, n: NotaRecebida, ctx: ContextoRetorno): Promise<{ pedidos: string[] }> {
  const d = decidirNotaDevolucao(n);
  const afetados = new Set<string>();
  if (d.tipo === 'remover') {
    const p = await repo.removerDevolucao(d.external_id, ctx.agora().toISOString());
    if (p) afetados.add(p);
  } else {
    const g = await repo.gravarDevolucao(d);
    if (!g) {
      ctx.log.info({ pedido_id: d.pedido_id, codigo: 'pedido_inexistente' }, 'nota de devolução sem pedido no Vendedor');
      // a nota pode ter saído de um pedido do Macuxi para outro que não existe aqui
      const p = await repo.removerDevolucao(d.external_id, ctx.agora().toISOString());
      if (p) afetados.add(p);
    } else {
      afetados.add(d.pedido_id);
      if (g.pedido_anterior && g.pedido_anterior !== d.pedido_id) afetados.add(g.pedido_anterior);
    }
  }
  for (const id of afetados) {
    const p = await repo.pedidoParaRetorno(id);
    if (p) await recalcularResumo(repo, p);
  }
  return { pedidos: [...afetados] };
}

// ---------------------------------------------------------------------------------------------------- Postgres
const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));

/** Repositório sobre `vendedor.*` (macuxi_app, RLS do tenant da transação). Nunca lê outro schema. */
export function repositorioRetornoErpPg(db: ClienteBanco): RepositorioRetornoErp {
  return {
    async pedidoParaRetorno(id) {
      const p = (
        await db.query<{ id: string; vendedor_id: string; status: OrderStatus; numero_erp: string | null }>(
          'select id, vendedor_id, status, numero_erp from vendedor.pedido where id = $1 and deleted_at is null for update',
          [id],
        )
      ).rows[0];
      if (!p) return null;
      const itens = (
        await db.query<{ sequencia: number; produto_id: string; quantidade: number; total_cents: number }>(
          'select sequencia, produto_id, quantidade, total_cents::float8 as total_cents from vendedor.pedido_item where pedido_id = $1 and deleted_at is null order by sequencia',
          [id],
        )
      ).rows;
      return { ...p, itens: itens.map((i) => ({ sequencia: i.sequencia, product_id: i.produto_id, quantity: i.quantidade, total_cents: num(i.total_cents) })) };
    },
    async faturamentos(pedidoId) {
      const rows = (
        await db.query<{ nota_numero: string | null; nota_total_cents: number | null; faturado_em: string; itens: Array<{ sequencia: number; quantidade: number; valor_cents: number | null }> }>(
          `select nota_numero, nota_total_cents::float8 as nota_total_cents, to_char(faturado_em at time zone 'UTC', ${UTC}) as faturado_em, itens
             from vendedor.pedido_faturamento where pedido_id = $1 and deleted_at is null order by faturado_em, created_at`,
          [pedidoId],
        )
      ).rows;
      return rows.map((f) => ({
        nota_numero: f.nota_numero,
        nota_total_cents: f.nota_total_cents === null ? null : num(f.nota_total_cents),
        faturado_em: f.faturado_em,
        itens: (f.itens ?? []).map((i) => ({ sequencia: num(i.sequencia), quantidade: num(i.quantidade), valor_cents: i.valor_cents === null || i.valor_cents === undefined ? null : num(i.valor_cents) })),
      }));
    },
    async devolucoes(pedidoId) {
      const rows = (
        await db.query<{ external_id: string; total_cents: number }>(
          'select external_id, total_cents::float8 as total_cents from vendedor.pedido_devolucao where pedido_id = $1 and deleted_at is null',
          [pedidoId],
        )
      ).rows;
      return rows.map((r) => ({ external_id: r.external_id, total_cents: num(r.total_cents) }));
    },
    async atualizarPedido(id, a) {
      await db.query(
        `update vendedor.pedido
            set status = $2, numero_erp = $3,
                motivo_rejeicao = coalesce($4, motivo_rejeicao),
                motivo_cancelamento = coalesce($5, motivo_cancelamento)
          where id = $1`,
        [id, a.status, a.numero_erp, a.motivo_rejeicao, a.motivo_cancelamento],
      );
    },
    async registrarLinhaDoTempo(id, l) {
      await db.query(
        `insert into vendedor.pedido_evento (tenant_id, pedido_id, de, para, autor_id, autor_nome, autor_perfil, motivo, nivel, acima_do_nivel, ocorrido_em)
         values (plataforma.tenant_atual(), $1, $2, $3, null, 'ERP', null, $4, null, false, $5)`,
        [id, l.de, l.para, l.motivo || null, l.ocorrido_em],
      );
    },
    async gravarFaturamento(f) {
      const r = await db.query(
        `insert into vendedor.pedido_faturamento
           (tenant_id, pedido_id, evento_origem_id, status_retorno, parcial, nota_numero, nota_serie, nota_emitida_em, nota_total_cents, faturado_em, itens)
         values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
         on conflict (tenant_id, evento_origem_id) do nothing`,
        [
          f.pedido_id,
          f.evento_origem_id,
          f.status_retorno,
          f.parcial,
          f.nota_numero,
          f.nota_serie,
          f.nota_emitida_em,
          f.nota_total_cents,
          f.faturado_em,
          JSON.stringify(f.itens.map((i) => ({ sequencia: i.sequencia, produto_id: i.product_id, quantidade: i.quantity, valor_cents: i.valor_cents }))),
        ],
      );
      return (r.rowCount ?? 0) > 0;
    },
    async gravarDevolucao(d) {
      const existe = (await db.query('select 1 from vendedor.pedido where id = $1 and deleted_at is null', [d.pedido_id])).rows.length > 0;
      if (!existe) return null;
      const atual = (
        await db.query<{ id: string; pedido_id: string }>(
          'select id, pedido_id from vendedor.pedido_devolucao where external_id = $1 and deleted_at is null for update',
          [d.external_id],
        )
      ).rows[0];
      if (atual) {
        await db.query(
          `update vendedor.pedido_devolucao set pedido_id = $2, nota_numero = $3, nota_serie = $4, emitida_em = $5, total_cents = $6
            where id = $1 and (pedido_id, nota_numero, nota_serie, emitida_em, total_cents) is distinct from ($2::uuid, $3::text, $4::text, $5::timestamptz, $6::bigint)`,
          [atual.id, d.pedido_id, d.numero, d.serie, d.emitida_em, d.total_cents],
        );
        return { pedido_anterior: atual.pedido_id };
      }
      await db.query(
        `insert into vendedor.pedido_devolucao (tenant_id, pedido_id, external_id, nota_numero, nota_serie, emitida_em, total_cents)
         values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6)`,
        [d.pedido_id, d.external_id, d.numero, d.serie, d.emitida_em, d.total_cents],
      );
      return { pedido_anterior: null };
    },
    async removerDevolucao(externalId, quando) {
      const r = await db.query<{ pedido_id: string }>(
        'update vendedor.pedido_devolucao set deleted_at = $2 where external_id = $1 and deleted_at is null returning pedido_id',
        [externalId, quando],
      );
      return r.rows[0]?.pedido_id ?? null;
    },
    async gravarResumo(pedidoId, r) {
      await db.query(
        `update vendedor.pedido
            set faturado_cents = $2, devolvido_cents = $3, notas_faturamento = $4, ultima_nota_numero = $5, faturado_em = $6
          where id = $1
            and (faturado_cents, devolvido_cents, notas_faturamento, ultima_nota_numero, faturado_em)
                is distinct from ($2::bigint, $3::bigint, $4::int, $5::text, $6::timestamptz)`,
        [pedidoId, r.faturado_cents, r.devolvido_cents, r.notas, r.ultima_nota, r.ultimo_faturamento_em],
      );
      await db.query(
        `update vendedor.pedido_item i set quantidade_faturada = x.q
           from (select unnest($2::int[]) as seq, unnest($3::int[]) as q) x
          where i.pedido_id = $1 and i.sequencia = x.seq and i.deleted_at is null and i.quantidade_faturada is distinct from x.q`,
        [pedidoId, r.itens.map((i) => i.sequencia), r.itens.map((i) => i.faturada)],
      );
    },
  };
}

// ---------------------------------------------------------------------------------------------------- consumidores
export type FabricaRepositorio = (db: ClienteBanco) => RepositorioRetornoErp;

const contextoDe = (ctx: ContextoConsumo): ContextoRetorno => ({ evento_id: ctx.envelope.evento_id, publicar: ctx.publicar, log: ctx.log, agora: ctx.agora });

/** `integracao.pedido.retorno_erp@1` → status, faturamento e `vendedor.pedido.faturado@1`. */
export function criarConsumidorRetornoErp(fabrica: FabricaRepositorio = repositorioRetornoErpPg): ConsumidorEvento {
  return definirConsumidor({
    evento: EVENTO_RETORNO_ERP,
    async executar(p, ctx) {
      await aplicarRetornoErp(fabrica(ctx.db), p, contextoDe(ctx));
    },
  });
}

/** `integracao.nota.atualizado@1` → devolução do pedido (só nota `devolucao` com `pedido_uuid`). */
export function criarConsumidorNotaDevolucao(fabrica: FabricaRepositorio = repositorioRetornoErpPg): ConsumidorEvento {
  return definirConsumidor({
    evento: EVENTO_NOTA_ATUALIZADA,
    async executar(p, ctx) {
      await aplicarNotaDevolucao(fabrica(ctx.db), { acao: p.acao, external_id: p.external_id, registro: p.registro }, contextoDe(ctx));
    },
  });
}

/** Consumidores registrados no `apiVendedor` (vazio até a migração do faturamento chegar ao `main`). */
export const consumidoresVendedor: readonly ConsumidorEvento[] = FATURAMENTO_LIGADO ? [criarConsumidorRetornoErp(), criarConsumidorNotaDevolucao()] : [];
