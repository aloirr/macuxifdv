/**
 * Rotas de pedido do Vendedor (`/v1/vendedor`; T-0029 §5 e §6, ADR 0011): lista com filtros e cursor, detalhe, aprovar,
 * rejeitar, cancelar e alçadas. A API é declarativa; o `createApp` aplica login, licença, perfil (RN-PRO-01) e Zod.
 * Escopo de leitura e decisão = usuários visíveis (RN-CORE-04, mesma função do pull): fora dele, 404 sem revelar existência.
 */
import { z } from 'zod';
import { CONSULTA_CADASTRO_RESUMO } from '@macuxi/core/contracts';
import {
  ErroHttpModulo,
  ErroNaoEncontrado,
  ErroRegraNegocio,
  type ClienteBanco,
  type ContextoBase,
  type RotaModulo,
  type TransacaoTenant,
} from '@macuxi/platform-sdk';
import {
  AprovarPedidoRequest,
  EVENTO_PEDIDO_APROVADO,
  EVENTO_PEDIDO_STATUS_ALTERADO,
  OrderListQuery,
  RejeitarPedidoRequest,
  type DiscountPolicy as AlcadaApi,
  type OrderDetail,
} from '../contracts';
import { decidirAprovacao, montarPedidoAprovado, politicaDosParametros, statusDoContrato, verificarCancelamento, type NivelAprovacao } from '../domain';
import { ORDER_STATUSES, type OrderStatus } from '../domain/order';
import { paraDetalhe, paraOrder, type LinhaEvento, type LinhaItem, type LinhaNotaDevolucao, type LinhaNotaFaturamento, type LinhaPedido } from './mapeamento';
import { FATURAMENTO_LIGADO } from './retorno-erp';
import { escopoDoPedido } from './sync';

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const ts = (c: string, pre = 'p.') => `to_char(${pre}${c} at time zone 'UTC', ${UTC}) as ${c}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ParamsPedido = z.object({ id: z.string().uuid() });
const CorpoCancelar = z.object({ motivo: z.string().max(500).optional() }).default({});
const NAO_ENCONTRADO = ['PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado.'] as const;

/** T-0054: resumo do faturamento (colunas da migração do faturamento; só com `FATURAMENTO_LIGADO`). */
const COLUNAS_FATURAMENTO = `, p.faturado_cents::float8 as faturado_cents, p.devolvido_cents::float8 as devolvido_cents, p.notas_faturamento, p.ultima_nota_numero`;
const COLUNAS_BASE = `p.id, p.numero, p.vendedor_id, p.vendedor_nome, p.cliente_id, p.cliente_nome, p.cliente_resumo, p.tabela_preco_id,
  p.condicao_pagamento, p.condicao_pagamento_descricao, p.status, p.desconto_pct::float8 as desconto_pct,
  p.total_tabela_cents::float8 as total_tabela_cents, p.total_cents::float8 as total_cents, p.nivel_aprovacao, p.motivos_aprovacao,
  p.motivo_rejeicao, p.numero_erp, ${ts('criado_no_aparelho_em')}, ${ts('recebido_em')}, ${ts('created_at')}, ${ts('updated_at')},
  coalesce(x.itens, 0) as itens, coalesce(x.unidades, 0) as unidades`;
const COLUNAS = `${COLUNAS_BASE}${FATURAMENTO_LIGADO ? COLUNAS_FATURAMENTO : ''}`;
const JUNCAO_ITENS = `left join lateral (select count(*)::int as itens, coalesce(sum(i.quantidade), 0)::int as unidades
    from vendedor.pedido_item i where i.tenant_id = p.tenant_id and i.pedido_id = p.id and i.deleted_at is null) x on true`;

function codificarCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url');
}
function decodificarCursor(c: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = Buffer.from(c, 'base64url').toString('utf8').split('|');
    return createdAt && id && /^[0-9a-f-]{36}$/i.test(id) && !Number.isNaN(Date.parse(createdAt)) ? { createdAt, id } : null;
  } catch {
    return null;
  }
}
const escaparLike = (q: string) => q.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Carrega o pedido (se estiver no escopo de leitura do usuário) com itens e histórico. `null` = inexistente ou fora do escopo. */
async function carregarDetalhe(ctx: ContextoBase, db: ClienteBanco, id: string, bloquear = false): Promise<{ linha: LinhaPedido; detalhe: OrderDetail } | null> {
  const e = escopoDoPedido(ctx.usuario.perfil, await ctx.usuariosVisiveis(), await ctx.carteira());
  const { rows } = await db.query<LinhaPedido>(
    `select ${COLUNAS} from vendedor.pedido p ${JUNCAO_ITENS}
      where p.id = $1 and p.deleted_at is null
        and ($2::uuid[] is null or p.vendedor_id = any($2::uuid[]))
        and ($3::uuid[] is null or p.cliente_id = any($3::uuid[]))
      ${bloquear ? 'for update of p' : ''}`,
    [id, e.vendedores, e.clientes],
  );
  const linha = rows[0];
  if (!linha) return null;
  const itens = (
    await db.query<LinhaItem>(
      `select id, produto_id, produto_sku, produto_nome, quantidade, preco_tabela_cents::float8 as preco_tabela_cents, desconto_pct::float8 as desconto_pct,
              total_cents::float8 as total_cents${FATURAMENTO_LIGADO ? ', quantidade_faturada' : ''}
         from vendedor.pedido_item where pedido_id = $1 and deleted_at is null order by sequencia`,
      [id],
    )
  ).rows;
  const eventos = (
    await db.query<LinhaEvento>(
      `select para, autor_nome, motivo, acima_do_nivel, to_char(ocorrido_em at time zone 'UTC', ${UTC}) as ocorrido_em
         from vendedor.pedido_evento where pedido_id = $1 and deleted_at is null order by ocorrido_em, created_at, (de is not null)`,
      [id],
    )
  ).rows;
  const faturamento = FATURAMENTO_LIGADO ? await lerNotasDoPedido(db, id) : undefined;
  return { linha, detalhe: paraDetalhe(linha, itens, eventos, ctx.usuario.perfil, ctx.parametros(), faturamento) };
}

/** T-0054: notas de faturamento e de devolução do pedido (detalhe; o resumo vem das colunas do pedido). */
export async function lerNotasDoPedido(db: ClienteBanco, id: string): Promise<{ notas: LinhaNotaFaturamento[]; devolucoes: LinhaNotaDevolucao[] }> {
  const notas = (
    await db.query<LinhaNotaFaturamento>(
      `select nota_numero, nota_serie, to_char(faturado_em at time zone 'UTC', ${UTC}) as faturado_em, parcial, nota_total_cents::float8 as nota_total_cents,
              coalesce((select sum((x->>'quantidade')::int) from jsonb_array_elements(itens) x), 0)::int as unidades
         from vendedor.pedido_faturamento where pedido_id = $1 and deleted_at is null order by faturado_em, created_at`,
      [id],
    )
  ).rows;
  const devolucoes = (
    await db.query<LinhaNotaDevolucao>(
      `select nota_numero, nota_serie, to_char(emitida_em at time zone 'UTC', ${UTC}) as emitida_em, total_cents::float8 as total_cents
         from vendedor.pedido_devolucao where pedido_id = $1 and deleted_at is null order by emitida_em, created_at`,
      [id],
    )
  ).rows;
  return { notas, devolucoes };
}

// ---------- leitura ----------
/** GET /v1/vendedor/pedidos — `pedido.ver`; escopo igual ao do pull (próprios / equipe / tenant; promotor = carteira). */
export const rotaListarPedidos: RotaModulo = {
  metodo: 'GET',
  caminho: 'pedidos',
  acao: 'pedido.ver',
  carteira: 'filtrar_no_dominio',
  query: OrderListQuery,
  async executar(ctx) {
    const q = ctx.query as z.infer<typeof OrderListQuery>;
    const limite = q.limite ?? q.limit ?? 50;
    const e = escopoDoPedido(ctx.usuario.perfil, await ctx.usuariosVisiveis(), await ctx.carteira());
    const status = (q.status ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is OrderStatus => (ORDER_STATUSES as readonly string[]).includes(s));
    const cursor = q.cursor ? decodificarCursor(q.cursor) : null;
    // filtros de id fora do formato nunca casam com nada (e não podem estourar o cast uuid do banco)
    if ((q.seller_id && !UUID.test(q.seller_id)) || (q.customer_id && !UUID.test(q.customer_id))) return { itens: [], proximo_cursor: null };
    if (q.cursor && !cursor) throw new ErroRegraNegocio('CURSOR_INVALIDO', 'Cursor inválido: recarregue a lista.');
    return ctx.comTenant(async (db) => {
      const fuso = ctx.fuso(); // fuso do tenant vem do SDK (sem ler plataforma.*)
      const busca = q.q?.trim() ? `%${escaparLike(q.q.trim())}%` : null;
      const { rows } = await db.query<LinhaPedido>(
        `select ${COLUNAS} from vendedor.pedido p ${JUNCAO_ITENS}
          where p.deleted_at is null
            and ($1::uuid[] is null or p.vendedor_id = any($1::uuid[]))
            and ($2::uuid[] is null or p.cliente_id = any($2::uuid[]))
            and ($3::text[] is null or p.status = any($3::text[]))
            and ($4::uuid is null or p.vendedor_id = $4)
            and ($5::uuid is null or p.cliente_id = $5)
            and ($6::date is null or p.created_at >= ($6::date)::timestamp at time zone $10)
            and ($7::date is null or p.created_at < (($7::date) + 1)::timestamp at time zone $10)
            and ($8::text is null or p.cliente_nome ilike $8 or p.numero ilike $8)
            and ($11::timestamptz is null or (p.created_at, p.id) < ($11::timestamptz, $12::uuid))
          order by p.created_at desc, p.id desc
          limit $9`,
        [e.vendedores, e.clientes, status.length > 0 ? status : null, q.seller_id ?? null, q.customer_id ?? null, q.from ?? null, q.to ?? null, busca, limite + 1, fuso, cursor?.createdAt ?? null, cursor?.id ?? null],
      );
      const pagina = rows.slice(0, limite);
      const ultimo = pagina[pagina.length - 1];
      return {
        itens: pagina.map((l) => paraOrder(l, ctx.parametros(), ctx.usuario.perfil)),
        proximo_cursor: rows.length > limite && ultimo ? codificarCursor(ultimo.created_at, ultimo.id) : null,
      };
    });
  },
};

/** GET /v1/vendedor/pedidos/:id — detalhe com itens, histórico, cliente (retrato) e `aprovacao`; fora do escopo = 404. */
export const rotaVerPedido: RotaModulo = {
  metodo: 'GET',
  caminho: 'pedidos/:id',
  acao: 'pedido.ver',
  carteira: 'filtrar_no_dominio',
  params: ParamsPedido,
  async executar(ctx) {
    const { id } = ctx.params as z.infer<typeof ParamsPedido>;
    return ctx.comTenant(async (db) => {
      const r = await carregarDetalhe(ctx, db, id);
      if (!r) throw new ErroNaoEncontrado(...NAO_ENCONTRADO);
      return r.detalhe;
    });
  },
};

/**
 * GET /v1/vendedor/alcadas — política vigente montada dos parâmetros (só leitura; mesma do aparelho).
 * RN-PRO-01 / T-0035: sem o promotor (a política de desconto de pedido não lhe diz respeito); por `perfis`, não por `pedido.ver`.
 */
export const PERFIS_ALCADAS = ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'] as const;
export const rotaAlcadas: RotaModulo = {
  metodo: 'GET',
  caminho: 'alcadas',
  perfis: [...PERFIS_ALCADAS],
  carteira: 'nao_se_aplica',
  async executar(ctx): Promise<AlcadaApi> {
    const p = politicaDosParametros({ ...ctx.parametros() });
    return { seller_pct: p.seller_pct, supervisor_pct: p.supervisor_pct, manager_pct: p.manager_pct, above_manager: p.above_manager, exceptions: [] };
  },
};

// ---------- decisão ----------
async function nomesEExternos(tx: TransacaoTenant, pedido: LinhaPedido, eu: string) {
  return tx.consultar(CONSULTA_CADASTRO_RESUMO, { cliente_ids: [pedido.cliente_id], produto_ids: [], usuario_ids: [...new Set([eu, pedido.vendedor_id])] });
}

function decidir(decisao: 'aprovar' | 'rejeitar'): RotaModulo {
  return {
    metodo: 'POST',
    caminho: decisao === 'aprovar' ? 'pedidos/:id/aprovar' : 'pedidos/:id/rejeitar',
    acao: 'pedido.aprovar',
    carteira: 'filtrar_no_dominio',
    params: ParamsPedido,
    corpo: decisao === 'aprovar' ? AprovarPedidoRequest : RejeitarPedidoRequest,
    async executar(ctx) {
      const { id } = ctx.params as z.infer<typeof ParamsPedido>;
      const corpo = ctx.corpo as { comentario?: string; motivo?: string };
      const eu = ctx.usuario.id;
      const agora = ctx.agora().toISOString();
      return ctx.comTenant(async (db, tx) => {
        // 1) escopo (RN-CORE-04) com trava de linha: duas decisões ao mesmo tempo viram uma e a repetição
        const atual = await carregarDetalhe(ctx, db, id, true);
        if (!atual) throw new ErroNaoEncontrado(...NAO_ENCONTRADO);
        const { linha } = atual;
        // 2) regra pura (RN-GES-08, RN-GES-04, P-3)
        const r = decidirAprovacao({ status: linha.status, nivel: linha.nivel_aprovacao, perfil: ctx.usuario.perfil, decisao, texto: decisao === 'aprovar' ? corpo.comentario : corpo.motivo });
        if (r.tipo === 'recusa') throw new ErroHttpModulo(r.http === 403 ? 403 : 422, r.codigo, r.mensagem);
        if (r.tipo === 'repetida') return atual.detalhe;
        const nivel = linha.nivel_aprovacao as NivelAprovacao;
        // 3) grava
        await db.query(
          `update vendedor.pedido set status = $2, decidido_por_id = $3, decidido_em = $4, motivo_rejeicao = $5 where id = $1`,
          [id, r.para, eu, agora, r.para === 'rejected' ? r.motivo : linha.motivo_rejeicao],
        );
        const cad = await nomesEExternos(tx, linha, eu);
        const autor = cad.usuarios.find((u) => u.id === eu);
        await db.query(
          `insert into vendedor.pedido_evento (tenant_id, pedido_id, de, para, autor_id, autor_nome, autor_perfil, motivo, nivel, acima_do_nivel, ocorrido_em)
           values (plataforma.tenant_atual(), $1, 'pending_approval', $2, $3, $4, $5, $6, $7, $8, $9)`,
          [id, r.para, eu, autor?.nome ?? null, ctx.usuario.perfil, r.motivo ?? (r.para === 'approved' ? 'Aprovado' : null), nivel, r.acima_do_nivel, agora],
        );
        await tx.auditar({
          acao: decisao === 'aprovar' ? 'pedido.aprovar' : 'pedido.rejeitar',
          entidade: 'pedido',
          entidade_id: id,
          antes: { status: 'pending_approval', nivel },
          depois: { status: r.para, acima_do_nivel: r.acima_do_nivel },
        });
        await tx.publicar(
          EVENTO_PEDIDO_STATUS_ALTERADO,
          { pedido_id: id, vendedor_id: linha.vendedor_id, de: 'em_aprovacao', para: statusDoContrato(r.para), alterado_em: agora, autor_id: eu, motivo: r.motivo },
          id,
        );
        if (r.para === 'approved') {
          const itens = (
            await db.query<{ produto_id: string; quantidade: number; preco_tabela_cents: number; total_cents: number }>(
              'select produto_id, quantidade, preco_tabela_cents::float8 as preco_tabela_cents, total_cents::float8 as total_cents from vendedor.pedido_item where pedido_id = $1 and deleted_at is null order by sequencia',
              [id],
            )
          ).rows;
          const prods = await tx.consultar(CONSULTA_CADASTRO_RESUMO, { cliente_ids: [], produto_ids: itens.map((i) => i.produto_id), usuario_ids: [] });
          const extra = (
            await db.query<{ codigo: string | null; criado_em: string; observacao: string | null }>(
              `select (select codigo from vendedor.condicao_pagamento c where c.id = p.condicao_pagamento_id) as codigo,
                      coalesce(to_char(p.criado_no_aparelho_em at time zone 'UTC', ${UTC}), to_char(p.recebido_em at time zone 'UTC', ${UTC})) as criado_em, p.observacao
                 from vendedor.pedido p where p.id = $1`,
              [id],
            )
          ).rows[0]!;
          await tx.publicar(
            EVENTO_PEDIDO_APROVADO,
            montarPedidoAprovado({
              pedido_uuid: id,
              cliente_external_id: cad.clientes[0]?.external_id ?? null,
              vendedor_external_id: cad.usuarios.find((u) => u.id === linha.vendedor_id)?.external_id ?? null,
              condicao_pagamento_codigo: extra.codigo,
              criado_em: extra.criado_em,
              aprovado_em: agora,
              observacao: extra.observacao,
              itens: itens.map((i) => ({
                produto_external_id: prods.produtos.find((x) => x.id === i.produto_id)?.external_id ?? null,
                quantidade: i.quantidade,
                preco_tabela_cents: Number(i.preco_tabela_cents),
                total_cents: Number(i.total_cents),
              })),
            }),
            id,
          );
        }
        return (await carregarDetalhe(ctx, db, id))!.detalhe;
      });
    },
  };
}

export const rotaAprovarPedido = decidir('aprovar');
export const rotaRejeitarPedido = decidir('rejeitar');

// ---------- cancelar ----------
/**
 * POST /v1/vendedor/pedidos/:id/cancelar — `pedido.cancelar` (promotor 403). RN-VEN-CANCELAR-APOS-ENVIO: enviado ao ERP ou
 * posterior → 422 (cancele no ERP). Antes do envio (inclui aprovado, P-2) → 200, com histórico, auditoria e evento.
 */
export const rotaCancelarPedido: RotaModulo = {
  metodo: 'POST',
  caminho: 'pedidos/:id/cancelar',
  acao: 'pedido.cancelar',
  carteira: 'filtrar_no_dominio',
  params: ParamsPedido,
  corpo: CorpoCancelar,
  async executar(ctx) {
    const { id } = ctx.params as z.infer<typeof ParamsPedido>;
    const motivo = ((ctx.corpo as { motivo?: string }).motivo ?? '').trim() || null;
    const agora = ctx.agora().toISOString();
    return ctx.comTenant(async (db, tx) => {
      const atual = await carregarDetalhe(ctx, db, id, true);
      if (!atual) throw new ErroNaoEncontrado(...NAO_ENCONTRADO);
      const { linha } = atual;
      const v = verificarCancelamento(linha.status);
      if (!v.ok) throw new ErroRegraNegocio(v.codigo, v.mensagem);
      if (linha.status === 'cancelled') return { id, status: 'cancelled' };
      await db.query("update vendedor.pedido set status = 'cancelled', motivo_cancelamento = $2 where id = $1", [id, motivo]);
      const cad = await tx.consultar(CONSULTA_CADASTRO_RESUMO, { cliente_ids: [], produto_ids: [], usuario_ids: [ctx.usuario.id] });
      await db.query(
        `insert into vendedor.pedido_evento (tenant_id, pedido_id, de, para, autor_id, autor_nome, autor_perfil, motivo, nivel, acima_do_nivel, ocorrido_em)
         values (plataforma.tenant_atual(), $1, $2, 'cancelled', $3, $4, $5, $6, null, false, $7)`,
        [id, linha.status, ctx.usuario.id, cad.usuarios[0]?.nome ?? null, ctx.usuario.perfil, motivo ?? 'Cancelado', agora],
      );
      await tx.auditar({ acao: 'pedido.cancelar', entidade: 'pedido', entidade_id: id, antes: { status: linha.status }, depois: { status: 'cancelled' } });
      await tx.publicar(
        EVENTO_PEDIDO_STATUS_ALTERADO,
        { pedido_id: id, vendedor_id: linha.vendedor_id, de: statusDoContrato(linha.status), para: 'cancelado', alterado_em: agora, autor_id: ctx.usuario.id, motivo },
        id,
      );
      return { id, status: 'cancelled' };
    });
  },
};
