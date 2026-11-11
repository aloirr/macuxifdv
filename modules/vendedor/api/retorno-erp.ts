/**
 * Retorno do ERP no Vendedor — consumidor ÚNICO do módulo (T-0053 status + T-0054 faturamento e devolução; desenho
 * T-0011 §1 e §4; ADR 0007):
 *  - `integracao.pedido.retorno_erp@1` (sempre ligado): aplica o status (`planejarRetornoErp`, RN-INT-08/RN-VEN-30),
 *    grava o número do ERP e a linha do tempo (autor "ERP"); publica `vendedor.pedido.status_alterado@1` e
 *    `vendedor.pedido.faturado@1` (RN-TRE-08) na MESMA transação do despachante (efeito + marca de consumo juntos).
 *    Com a migração do faturamento, também grava a nota, os itens faturados (saldo por sequência) e o resumo;
 *  - `integracao.nota.atualizado@1` (só com a migração): nota de devolução com `pedido_uuid` (RN-VEN-37, proposta).
 * As decisões são do domínio (`domain/retorno-erp.ts`); aqui só se lê, decide e grava, atrás do `RepositorioRetornoErp`
 * (Postgres em produção; memória nos testes sem banco). Licença: o despachante só entrega a quem tem o Vendedor ativo no
 * tenant (RN-CORE-02/03); RLS do tenant do evento (macuxi_app). Log sem dado pessoal: só ids, códigos e contagens.
 *
 * `FATURAMENTO_LIGADO` (ligado: migração 0013 no `main`): `vendedor.pedido_faturamento` (uma linha por retorno faturado,
 * idempotente por `evento_id`), `pedido.total_faturado_cents`/`faturado_em` e `pedido_item.quantidade_faturada` (UNIDADE
 * BASE, desenho T-0061 §2.1). `DEVOLUCAO_LIGADA` (ligada, migração 0050): `pedido_devolucao` guarda as notas de devolução; o devolvido
 * é a soma das linhas vivas e a nota toca `pedido.updated_at` para o pull levar a mudança (docs/modulos/vendedor/retorno-erp.md).
 */
import { criarConsumidorFormaPagamentoDoErp, criarConsumidorPrazoPagamentoDoErp } from './formas-erp';
import { definirConsumidor, type ClienteBanco, type ConsumidorEvento, type ContextoConsumo, type LogRota } from '@macuxi/platform-sdk';
import { EVENTO_PEDIDO_FATURADO, EVENTO_PEDIDO_STATUS_ALTERADO } from '../contracts';
import {
  decidirNotaDevolucao,
  eventoFaturadoDosItens,
  itensDoFaturamento,
  planejarRetornoErp,
  resumoFaturamento,
  statusDoContrato,
  type FaturamentoRegistrado,
  type ItemFaturadoNoPedido,
  type ResumoFaturamento,
} from '../domain';
import type { OrderStatus } from '../domain/order';
import { NotaPayload } from '../../integracao/contracts';
import { EVENTO_NOTA_ATUALIZADA, EVENTO_RETORNO_ERP_CONSUMIDO, type RetornoErpConsumido } from './eventos-consumidos';

/** Persistência do faturamento, resumo no pull e notas no detalhe (migração 0013 no `main`). */
export const FATURAMENTO_LIGADO = true;
/** Devolução (RN-VEN-37, T-0155): tabela `vendedor.pedido_devolucao` (migração 0050) migrada; consumidor da nota registrado. */
export const DEVOLUCAO_LIGADA = true;

/** Autor da linha do tempo quando a transição vem do ERP (T-0053). */
export const AUTOR_ERP = { nome: 'ERP', perfil: 'erp' } as const;

// ---------------------------------------------------------------------------------------------------- repositório
export interface PedidoParaRetorno {
  id: string;
  vendedor_id: string;
  status: OrderStatus;
  numero_erp: string | null;
  /** número do pedido no Macuxi (texto da notificação) */
  numero?: string | null;
  itens: Array<{ sequencia: number; product_id: string; quantity: number; total_cents: number }>;
}
export interface FaturamentoParaGravar {
  pedido_id: string;
  /** `evento_id` do retorno: idempotência da nota (unique por tenant) */
  evento_origem_id: string;
  numero_erp: string | null;
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
  /** `null` = sem a tabela do faturamento (antes da migração): acumulado desconhecido. */
  faturamentos(pedidoId: string): Promise<FaturamentoRegistrado[] | null>;
  devolucoes(pedidoId: string): Promise<Array<{ external_id: string; total_cents: number }>>;
  atualizarPedido(id: string, a: AtualizacaoDoPedido): Promise<void>;
  registrarLinhaDoTempo(id: string, l: LinhaDoTempo): Promise<void>;
  /** `false` = a nota deste evento já estava gravada (reentrega). Sem a migração: `true` (a marca de consumo protege). */
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

async function recalcularResumo(repo: RepositorioRetornoErp, pedido: PedidoParaRetorno): Promise<ResumoFaturamento | null> {
  const fats = await repo.faturamentos(pedido.id);
  if (!fats) return null;
  const r = resumoFaturamento(pedido.itens, fats, await repo.devolucoes(pedido.id));
  await repo.gravarResumo(pedido.id, r);
  return r;
}

// ---------------------------------------------------------------------------------------------------- retorno do ERP
/** O retorno como o Vendedor lê (`RetornoErpConsumido`, T-0053; o `nota` traz número, série, emissão e total). */
export type RetornoRecebido = Pick<RetornoErpConsumido, 'pedido_uuid' | 'status' | 'numero_erp' | 'motivo' | 'nota' | 'itens_faturados' | 'ocorrido_em'>;

export type ResultadoRetorno =
  | { aplicado: false; motivo: string }
  | { aplicado: true; de: OrderStatus; para: OrderStatus; faturado_publicado: boolean };

/** RN-INT-08 / RN-VEN-30 / RN-TRE-08: aplica um retorno do ERP no pedido (uma transação, chamada pelo consumidor). */
export async function aplicarRetornoErp(repo: RepositorioRetornoErp, r: RetornoRecebido, ctx: ContextoRetorno): Promise<ResultadoRetorno> {
  const pedido = await repo.pedidoParaRetorno(r.pedido_uuid);
  if (!pedido) {
    // pedido de outro tenant nunca chega (RLS); inexistente aqui = nada a fazer (não relança: o evento não mudaria)
    ctx.log.warn({ pedido_id: r.pedido_uuid, codigo: 'pedido_inexistente', status_erp: r.status }, 'retorno do ERP de pedido desconhecido: ignorado');
    return { aplicado: false, motivo: 'pedido_inexistente' };
  }
  const plano = planejarRetornoErp(pedido.status, r);
  if (plano.acao === 'ignorar') {
    ctx.log.info({ pedido_id: pedido.id, codigo: plano.motivo, status_erp: r.status, status: pedido.status }, 'retorno do ERP ignorado');
    return { aplicado: false, motivo: plano.motivo };
  }

  await repo.atualizarPedido(pedido.id, {
    status: plano.para,
    numero_erp: plano.numero_erp ?? pedido.numero_erp,
    motivo_rejeicao: plano.motivo_rejeicao,
    motivo_cancelamento: plano.motivo_cancelamento,
  });
  if (plano.muda_status) {
    await repo.registrarLinhaDoTempo(pedido.id, { de: plano.de, para: plano.para, motivo: plano.texto_historico, ocorrido_em: r.ocorrido_em });
    await ctx.publicar(
      EVENTO_PEDIDO_STATUS_ALTERADO,
      { pedido_id: pedido.id, vendedor_id: pedido.vendedor_id, de: statusDoContrato(plano.de), para: statusDoContrato(plano.para), alterado_em: r.ocorrido_em, autor_id: null, motivo: plano.texto_historico || null, pedido_numero: pedido.numero ?? null },
      pedido.id,
    );
  }

  let faturadoPublicado = false;
  if (plano.faturar && (r.status === 'faturado_parcial' || r.status === 'faturado_total')) {
    const parcial = r.status === 'faturado_parcial';
    const anteriores = await repo.faturamentos(pedido.id);
    // sem a tabela (antes da migração) o acumulado só é conhecido quando não houve parcial antes (= nada faturado)
    const ja = anteriores
      ? anteriores.flatMap((f) => f.itens.map((i) => ({ sequencia: i.sequencia, quantidade: i.quantidade })))
      : plano.de === 'invoiced_partial'
        ? null
        : [];
    const { itens, divergencias } = itensDoFaturamento(r.status, r.itens_faturados, pedido.itens, ja);
    for (const x of divergencias) ctx.log.warn({ pedido_id: pedido.id, sequencia: x.sequencia, codigo: x.codigo, informada: x.informada, aceita: x.aceita }, 'item faturado divergente');
    if (parcial && !r.itens_faturados?.length) ctx.log.info({ pedido_id: pedido.id, codigo: 'faturamento_sem_itens' }, 'faturamento parcial sem itens');
    const gravou = await repo.gravarFaturamento({
      pedido_id: pedido.id,
      evento_origem_id: ctx.evento_id,
      numero_erp: plano.numero_erp ?? pedido.numero_erp,
      status_retorno: r.status,
      parcial,
      nota_numero: r.nota?.numero ?? null,
      nota_serie: r.nota?.serie ?? null,
      nota_emitida_em: r.nota?.emitida_em ?? null,
      nota_total_cents: r.nota?.total_cents ?? null,
      faturado_em: r.ocorrido_em,
      itens,
    });
    // faturado_em do evento = emissão da nota (T-0053), senão o instante do retorno
    const ev = gravou ? eventoFaturadoDosItens({ id: pedido.id, vendedor_id: pedido.vendedor_id }, r.nota?.emitida_em ?? r.ocorrido_em, parcial, itens) : null;
    if (ev) {
      await ctx.publicar(EVENTO_PEDIDO_FATURADO, ev, pedido.id);
      faturadoPublicado = true;
    } else if (gravou) {
      ctx.log.warn({ pedido_id: pedido.id, codigo: 'faturamento_sem_base', status_erp: r.status }, 'faturamento sem itens identificáveis: vendedor.pedido.faturado@1 não publicado');
    }
    await recalcularResumo(repo, pedido);
  }
  return { aplicado: true, de: plano.de, para: plano.para, faturado_publicado: faturadoPublicado };
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

/**
 * Repositório sobre `vendedor.*` (macuxi_app, RLS do tenant da transação). Nunca lê outro schema. Esquema da 0013:
 * quantidades na UNIDADE BASE (`pedido_item.quantidade_base`, preenchida por gatilho; o retorno do ERP também vem na base).
 * `faturamento: false` = só as tabelas anteriores (sem nota e sem resumo); `devolucao: false` = sem `pedido_devolucao`.
 */
export function repositorioRetornoErpPg(db: ClienteBanco, opcoes: { faturamento?: boolean; devolucao?: boolean } = {}): RepositorioRetornoErp {
  const comFaturamento = opcoes.faturamento ?? FATURAMENTO_LIGADO;
  const comDevolucao = opcoes.devolucao ?? DEVOLUCAO_LIGADA;
  return {
    async pedidoParaRetorno(id) {
      const p = (
        await db.query<{ id: string; vendedor_id: string; status: OrderStatus; numero_erp: string | null; numero: string | null }>(
          'select id, vendedor_id, status, numero_erp, numero from vendedor.pedido where id = $1 and deleted_at is null for update',
          [id],
        )
      ).rows[0];
      if (!p) return null;
      const itens = (
        await db.query<{ sequencia: number; produto_id: string; quantidade: number; total_cents: number }>(
          `select sequencia, produto_id, ${comFaturamento ? 'quantidade_base' : 'quantidade'} as quantidade, total_cents::float8 as total_cents
             from vendedor.pedido_item where pedido_id = $1 and deleted_at is null order by sequencia`,
          [id],
        )
      ).rows;
      return { ...p, itens: itens.map((i) => ({ sequencia: i.sequencia, product_id: i.produto_id, quantity: i.quantidade, total_cents: num(i.total_cents) })) };
    },
    async faturamentos(pedidoId) {
      if (!comFaturamento) return null;
      const rows = (
        await db.query<{ nota_numero: string | null; nota_total_cents: number | null; faturado_em: string; itens: Array<{ sequencia: number; quantidade: number; total_cents?: number | null }> }>(
          `select nota_numero, nota_total_cents::float8 as nota_total_cents, to_char(faturado_em at time zone 'UTC', ${UTC}) as faturado_em, itens
             from vendedor.pedido_faturamento where pedido_id = $1 and deleted_at is null order by faturado_em, created_at`,
          [pedidoId],
        )
      ).rows;
      return rows.map((f) => ({
        nota_numero: f.nota_numero,
        nota_total_cents: f.nota_total_cents === null ? null : num(f.nota_total_cents),
        faturado_em: f.faturado_em,
        itens: (f.itens ?? []).map((i) => ({ sequencia: num(i.sequencia), quantidade: num(i.quantidade), valor_cents: i.total_cents === null || i.total_cents === undefined ? null : num(i.total_cents) })),
      }));
    },
    async devolucoes(pedidoId) {
      if (!comDevolucao) return [];
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
         values (plataforma.tenant_atual(), $1, $2, $3, null, $4, $5, $6, null, false, $7)`,
        [id, l.de, l.para, AUTOR_ERP.nome, AUTOR_ERP.perfil, l.motivo || null, l.ocorrido_em],
      );
    },
    async gravarFaturamento(f) {
      if (!comFaturamento) return true;
      const r = await db.query(
        `insert into vendedor.pedido_faturamento
           (tenant_id, pedido_id, evento_id, parcial, numero_erp, nota_numero, nota_serie, nota_emitida_em, nota_total_cents, faturado_em, itens)
         values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
         on conflict (tenant_id, evento_id) do nothing`,
        [
          f.pedido_id,
          f.evento_origem_id,
          f.parcial,
          f.numero_erp,
          f.nota_numero,
          f.nota_serie,
          f.nota_emitida_em,
          f.nota_total_cents,
          f.faturado_em,
          // formato da 0013: [{sequencia, produto_id, quantidade (unidade base), total_cents}]
          JSON.stringify(f.itens.map((i) => ({ sequencia: i.sequencia, produto_id: i.product_id, quantidade: i.quantity, total_cents: i.valor_cents }))),
        ],
      );
      return (r.rowCount ?? 0) > 0;
    },
    async gravarDevolucao(d) {
      if (!comDevolucao) return null;
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
        // T-0155: o pull só leva o pedido que mudou; a nota (re)apontada muda o devolvido dos dois pedidos
        await db.query('update vendedor.pedido set updated_at = now() where id = any($1::uuid[])', [[d.pedido_id, atual.pedido_id]]);
        return { pedido_anterior: atual.pedido_id };
      }
      await db.query(
        `insert into vendedor.pedido_devolucao (tenant_id, pedido_id, external_id, nota_numero, nota_serie, emitida_em, total_cents)
         values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6)`,
        [d.pedido_id, d.external_id, d.numero, d.serie, d.emitida_em, d.total_cents],
      );
      await db.query('update vendedor.pedido set updated_at = now() where id = $1', [d.pedido_id]);
      return { pedido_anterior: null };
    },
    async removerDevolucao(externalId, quando) {
      if (!comDevolucao) return null;
      const r = await db.query<{ pedido_id: string }>(
        'update vendedor.pedido_devolucao set deleted_at = $2 where external_id = $1 and deleted_at is null returning pedido_id',
        [externalId, quando],
      );
      const pid = r.rows[0]?.pedido_id ?? null;
      if (pid) await db.query('update vendedor.pedido set updated_at = now() where id = $1', [pid]);
      return pid;
    },
    async gravarResumo(pedidoId, r) {
      if (!comFaturamento) return;
      // 0013: total_faturado_cents e faturado_em no pedido; notas e última NF vêm de pedido_faturamento na leitura
      await db.query(
        `update vendedor.pedido set total_faturado_cents = $2, faturado_em = $3
          where id = $1 and (total_faturado_cents, faturado_em) is distinct from ($2::bigint, $3::timestamptz)`,
        [pedidoId, r.faturado_cents, r.ultimo_faturamento_em],
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
export function criarConsumidorRetornoErp(fabrica: FabricaRepositorio = (db) => repositorioRetornoErpPg(db)): ConsumidorEvento {
  return definirConsumidor({
    evento: EVENTO_RETORNO_ERP_CONSUMIDO,
    async executar(p, ctx) {
      await aplicarRetornoErp(fabrica(ctx.db), p, contextoDe(ctx));
    },
  });
}

/** O `registro` do evento é a união das entidades da integração; aqui a entidade é sempre `nota`. */
const registroDaNota = (registro: unknown): NotaRecebida['registro'] => {
  const r = NotaPayload.safeParse(registro);
  return r.success ? r.data : undefined;
};

/** `integracao.nota.atualizado@1` → devolução do pedido (só nota `devolucao` com `pedido_uuid`). */
export function criarConsumidorNotaDevolucao(fabrica: FabricaRepositorio = (db) => repositorioRetornoErpPg(db)): ConsumidorEvento {
  return definirConsumidor({
    evento: EVENTO_NOTA_ATUALIZADA,
    async executar(p, ctx) {
      await aplicarNotaDevolucao(fabrica(ctx.db), { acao: p.acao, external_id: p.external_id, registro: registroDaNota(p.registro) }, contextoDe(ctx));
    },
  });
}

/** O consumidor único do retorno do ERP (T-0053 + T-0054). */
export const consumidorRetornoErp: ConsumidorEvento = criarConsumidorRetornoErp();

/** Consumidores registrados no `apiVendedor`: o retorno sempre; a nota de devolução só com a tabela da devolução. */
export const consumidoresVendedor: readonly ConsumidorEvento[] = [...(DEVOLUCAO_LIGADA ? [consumidorRetornoErp, criarConsumidorNotaDevolucao()] : [consumidorRetornoErp]), criarConsumidorFormaPagamentoDoErp(), criarConsumidorPrazoPagamentoDoErp()];
