/**
 * Rotas de pedido do Vendedor (`/v1/vendedor`; T-0029 §5 e §6, ADR 0011): lista com filtros e cursor, detalhe, aprovar,
 * rejeitar, cancelar e alçadas. A API é declarativa; o `createApp` aplica login, licença, perfil (RN-PRO-01) e Zod.
 * Escopo de leitura e decisão = usuários visíveis (RN-CORE-04, mesma função do pull): fora dele, 404 sem revelar existência.
 */
import { z } from 'zod';
import { CONSULTA_CADASTRO_RESUMO } from '@macuxi/core/contracts';
import { CONSULTA_CANCELAMENTO_ERP } from '@macuxi/integracao/contracts';
import {
  ehConsultaIndisponivel,
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
  EVENTO_PEDIDO_CANCELADO,
  EVENTO_PEDIDO_STATUS_ALTERADO,
  OrderListQuery,
  RejeitarPedidoRequest,
  type DiscountPolicy as AlcadaApi,
  type Order,
  type OrderDetail,
} from '../contracts';
import { decidirAprovacao, politicaDosParametros, situacaoDoOrcamento, enviadoAoErp, statusDoContrato, verificarCancelamento, type NivelAprovacao } from '../domain';
import { ORDER_STATUSES, type OrderStatus } from '../domain/order';
import { payloadAprovado } from './aprovado-erp';
import { paraDetalhe, paraOrder, type LinhaEvento, type LinhaItem, type LinhaNotaDevolucao, type LinhaNotaFaturamento, type LinhaPedido } from './mapeamento';
import { preVenda, type DocumentoPreVenda } from './pre-venda';
import { DEVOLUCAO_LIGADA, FATURAMENTO_LIGADO } from './retorno-erp';
import { exigirLeituraDePedidos } from './opcao-promotor';
import { COLUNA_DEVOLVIDO, escopoDoPedido, JUNCAO_FATURAMENTO } from './sync';

/** T-0053: campos da pré-venda no pedido/orçamento (vazio para pedido sem pré-venda ou sem a 0013). */
function camposPreVenda(doc: DocumentoPreVenda | undefined, status: string): Partial<Order> {
  if (!doc) return {};
  return {
    tipo: doc.tipo,
    validade_ate: doc.validade_ate,
    validade_data: doc.validade_data,
    situacao_orcamento: doc.tipo === 'orcamento' ? situacaoDoOrcamento({ status, validade_ate: doc.validade_ate, convertido_pedido_id: doc.convertido_pedido_id }) : null,
    orcamento_origem_id: doc.orcamento_origem_id,
    convertido_pedido_id: doc.convertido_pedido_id,
  };
}

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const ts = (c: string, pre = 'p.') => `to_char(${pre}${c} at time zone 'UTC', ${UTC}) as ${c}`;

/**
 * RN-VEN-18: situação do orçamento no SQL, igual a `situacaoDoOrcamento` (cancelado e convertido prevalecem; o resto é aberto: o
 * orçamento não vence, RN-VEN-18). $10 = fuso, sem parâmetro de relógio. Só faz sentido com `tipo = 'orcamento'`.
 */
const SQL_SITUACAO_ORCAMENTO = `(case when p.status = 'cancelled' then 'cancelado'
    when exists (select 1 from vendedor.pedido c where c.tenant_id = p.tenant_id and c.orcamento_id = p.id and c.deleted_at is null) then 'convertido'
    else 'aberto' end)`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ParamsPedido = z.object({ id: z.string().uuid() });
const CorpoCancelar = z.object({ motivo: z.string().max(500).optional() }).default({});
const NAO_ENCONTRADO = ['PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado.'] as const;

/** T-0054: resumo do faturamento (0013; só com `FATURAMENTO_LIGADO`): total faturado, notas e última NF. */
const COLUNAS_FATURAMENTO = `${COLUNA_DEVOLVIDO}, p.total_faturado_cents::float8 as faturado_cents, fat.notas as notas_faturamento, fat.ultima as ultima_nota_numero`;
const COLUNAS_BASE = `p.id, p.numero, p.vendedor_id, p.vendedor_nome, p.cliente_id, p.cliente_nome, p.cliente_resumo, p.tabela_preco_id,
  p.condicao_pagamento, p.condicao_pagamento_descricao, p.status, p.desconto_pct::float8 as desconto_pct,
  p.total_tabela_cents::float8 as total_tabela_cents, p.total_cents::float8 as total_cents, p.nivel_aprovacao, p.motivos_aprovacao,
  p.motivo_rejeicao, p.numero_erp, ${ts('criado_no_aparelho_em')}, ${ts('recebido_em')}, ${ts('created_at')}, ${ts('updated_at')},
  coalesce(x.itens, 0) as itens, coalesce(x.unidades, 0) as unidades,
  p.acrescimo_pct::float8 as acrescimo_pct, p.desconto_efetivo_pct::float8 as desconto_efetivo_pct, p.frete_modalidade, p.transportadora_nome,
  p.transportadora_documento, p.transportadora_telefone, p.transportadora_digitada, p.endereco_entrega,
  p.desconto_valor_cents::float8 as desconto_valor_cents, p.acrescimo_valor_cents::float8 as acrescimo_valor_cents, p.ajuste_em,
  p.forma_pagamento_id, p.forma_pagamento_nome, p.prazo_pagamento_id, p.prazo_descricao, p.prazo_parcelas_dias, p.prazo_medio_dias,
  p.filial_id, p.filial`;
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
    `select ${COLUNAS} from vendedor.pedido p ${JUNCAO_ITENS} ${FATURAMENTO_LIGADO ? JUNCAO_FATURAMENTO : ''}
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
              total_cents::float8 as total_cents, unidade, fator, acrescimo_pct::float8 as acrescimo_pct,
              desconto_unitario_cents::float8 as desconto_unitario_cents, acrescimo_unitario_cents::float8 as acrescimo_unitario_cents, ajuste_em, aplicacao${FATURAMENTO_LIGADO ? ', quantidade_faturada, quantidade_base' : ''}
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
  const doc = (await preVenda().lerDocumentos(db, [id], ctx.fuso())).get(id);
  return { linha, detalhe: { ...paraDetalhe(linha, itens, eventos, ctx.usuario.perfil, ctx.parametros(), faturamento), ...camposPreVenda(doc, linha.status) } };
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
  const devolucoes = !DEVOLUCAO_LIGADA ? [] : (
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
    await exigirLeituraDePedidos(ctx); // O-3: opção `promotor_ve_pedidos` (só afeta o promotor)
    const q = ctx.query as z.infer<typeof OrderListQuery>;
    const limite = q.limite ?? q.limit ?? 50;
    const e = escopoDoPedido(ctx.usuario.perfil, await ctx.usuariosVisiveis(), await ctx.carteira());
    const status = (q.status ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is OrderStatus => (ORDER_STATUSES as readonly string[]).includes(s));
    const cursor = q.cursor ? decodificarCursor(q.cursor) : null;
    // T-0071 §1.4 g: sem o parâmetro, a lista traz só pedidos (nenhum orçamento entra por engano em KPI, aprovação ou lista de pedidos)
    const tipo = q.tipo ?? 'pedido';
    // filtros de id fora do formato nunca casam com nada (e não podem estourar o cast uuid do banco)
    if ((q.seller_id && !UUID.test(q.seller_id)) || (q.customer_id && !UUID.test(q.customer_id))) return { itens: [], proximo_cursor: null };
    if (q.cursor && !cursor) throw new ErroRegraNegocio('CURSOR_INVALIDO', 'Cursor inválido: recarregue a lista.');
    return ctx.comTenant(async (db) => {
      const fuso = ctx.fuso(); // fuso do tenant vem do SDK (sem ler plataforma.*)
      const busca = q.q?.trim() ? `%${escaparLike(q.q.trim())}%` : null;
      const { rows } = await db.query<LinhaPedido>(
        `select ${COLUNAS} from vendedor.pedido p ${JUNCAO_ITENS} ${FATURAMENTO_LIGADO ? JUNCAO_FATURAMENTO : ''}
          where p.deleted_at is null
            and ($1::uuid[] is null or p.vendedor_id = any($1::uuid[]))
            and ($2::uuid[] is null or p.cliente_id = any($2::uuid[]))
            and ($3::text[] is null or p.status = any($3::text[]))
            and ($4::uuid is null or p.vendedor_id = $4)
            and ($5::uuid is null or p.cliente_id = $5)
            and ((($6::date is null or p.created_at >= ($6::date)::timestamp at time zone $10)
                  and ($7::date is null or p.created_at < (($7::date) + 1)::timestamp at time zone $10))
                 or ($15::boolean and ($6::date is not null or $7::date is not null)
                     and exists (select 1 from vendedor.pedido_evento ev
                                  where ev.tenant_id = p.tenant_id and ev.pedido_id = p.id and ev.deleted_at is null and ev.de is not null
                                    and ($6::date is null or ev.ocorrido_em >= ($6::date)::timestamp at time zone $10)
                                    and ($7::date is null or ev.ocorrido_em < (($7::date) + 1)::timestamp at time zone $10))))
            and ($8::text is null or p.cliente_nome ilike $8 or p.numero ilike $8)
            and ($11::timestamptz is null or (p.created_at, p.id) < ($11::timestamptz, $12::uuid))
            and ($13::text is null or p.tipo = $13)
            and ($14::text is null or ${SQL_SITUACAO_ORCAMENTO} = $14)
          order by p.created_at desc, p.id desc
          limit $9`,
        [e.vendedores, e.clientes, status.length > 0 ? status : null, q.seller_id ?? null, q.customer_id ?? null, q.from ?? null, q.to ?? null, busca, limite + 1, fuso, cursor?.createdAt ?? null, cursor?.id ?? null, tipo === 'todos' ? null : tipo, tipo === 'orcamento' ? (q.situacao ?? null) : null, q.por_status === '1'],
      );
      const pagina = rows.slice(0, limite);
      const ultimo = pagina[pagina.length - 1];
      const docs = await preVenda().lerDocumentos(db, pagina.map((l) => l.id), fuso);
      return {
        itens: pagina.map((l) => ({ ...paraOrder(l, ctx.parametros(), ctx.usuario.perfil), ...camposPreVenda(docs.get(l.id), l.status) })),
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
    await exigirLeituraDePedidos(ctx); // O-3
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
          { pedido_id: id, vendedor_id: linha.vendedor_id, de: 'em_aprovacao', para: statusDoContrato(r.para), alterado_em: agora, autor_id: eu, motivo: r.motivo, pedido_numero: linha.numero },
          id,
        );
        if (r.para === 'approved') await tx.publicar(EVENTO_PEDIDO_APROVADO, await payloadAprovado(db, tx, id, agora), id);
        return (await carregarDetalhe(ctx, db, id))!.detalhe;
      });
    },
  };
}

export const rotaAprovarPedido = decidir('aprovar');
export const rotaRejeitarPedido = decidir('rejeitar');

// ---------- cancelar ----------
/**
 * T-0114: pedido já enviado ao ERP (conector aceita). O status NÃO muda: fica "cancelamento solicitado" (motivo_cancelamento
 * preenchido + status de envio) até o retorno `cancelado` do ERP (integracao.pedido.retorno_erp@1) levar a 'cancelled'.
 * Repetição (reenvio da fila) não republica o evento. O evento sai com enviado_ao_erp = true.
 */
async function solicitarCancelamentoAoErp(
  ctx: ContextoBase, db: ClienteBanco, tx: TransacaoTenant, id: string, linha: LinhaPedido, motivo: string | null, agora: string,
): Promise<{ id: string; status: string; cancelamento_solicitado: true }> {
  const ja = (await db.query<{ motivo_cancelamento: string | null }>('select motivo_cancelamento from vendedor.pedido where id = $1', [id])).rows[0];
  const resposta = { id, status: linha.status, cancelamento_solicitado: true as const };
  if (ja?.motivo_cancelamento !== null && ja?.motivo_cancelamento !== undefined) return resposta;
  await db.query('update vendedor.pedido set motivo_cancelamento = $2 where id = $1', [id, motivo ?? 'Cancelamento solicitado']);
  await tx.auditar({ acao: 'pedido.cancelar', entidade: 'pedido', entidade_id: id, antes: { status: linha.status }, depois: { status: linha.status, cancelamento_solicitado: true } });
  await tx.publicar(
    EVENTO_PEDIDO_CANCELADO,
    { tenant_id: ctx.usuario.tenant_id, pedido_id: id, numero: linha.numero ?? null, external_id: linha.numero_erp ?? null, enviado_ao_erp: true, motivo, cancelado_por: ctx.usuario.id, cancelado_em: agora },
    id,
  );
  return resposta;
}

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
      if (linha.status === 'cancelled') return { id, status: 'cancelled' };
      // RN-VEN-31 (exceção T-0114): depois do envio só cancela se o conector aceita; a API consulta na hora (sem cópia).
      // Integração sem licença/indisponível = não aceita (422 da regra atual).
      let erpAceitaCancelamento = false;
      if (enviadoAoErp(linha.status)) {
        try {
          erpAceitaCancelamento = (await tx.consultar(CONSULTA_CANCELAMENTO_ERP, {}, { licenca: 'tenant' })).aceita;
        } catch (e) {
          if (!ehConsultaIndisponivel(e)) throw e;
        }
      }
      const v = verificarCancelamento(linha.status, { erpAceitaCancelamento });
      if (!v.ok) throw new ErroRegraNegocio(v.codigo, v.mensagem);
      if (v.solicitado_ao_erp) return solicitarCancelamentoAoErp(ctx, db, tx, id, linha, motivo, agora);
      await db.query("update vendedor.pedido set status = 'cancelled', motivo_cancelamento = $2 where id = $1", [id, motivo]);
      const cad = await tx.consultar(CONSULTA_CADASTRO_RESUMO, { cliente_ids: [], produto_ids: [], usuario_ids: [ctx.usuario.id] });
      await db.query(
        `insert into vendedor.pedido_evento (tenant_id, pedido_id, de, para, autor_id, autor_nome, autor_perfil, motivo, nivel, acima_do_nivel, ocorrido_em)
         values (plataforma.tenant_atual(), $1, $2, 'cancelled', $3, $4, $5, $6, null, false, $7)`,
        [id, linha.status, ctx.usuario.id, cad.usuarios[0]?.nome ?? null, ctx.usuario.perfil, motivo ?? 'Cancelado', agora],
      );
      const orcamento = (await preVenda().lerDocumentos(db, [id], ctx.fuso())).get(id)?.tipo === 'orcamento';
      await tx.auditar({ acao: 'pedido.cancelar', entidade: 'pedido', entidade_id: id, antes: { status: linha.status }, depois: { status: 'cancelled', ...(orcamento ? { tipo: 'orcamento' } : {}) } });
      // RN-VEN-32: orçamento não publica evento de pedido (nunca foi para metas, Gestor nem fila do ERP)
      if (orcamento) return { id, status: 'cancelled' };
      await tx.publicar(
        EVENTO_PEDIDO_STATUS_ALTERADO,
        { pedido_id: id, vendedor_id: linha.vendedor_id, de: statusDoContrato(linha.status), para: 'cancelado', alterado_em: agora, autor_id: ctx.usuario.id, motivo, pedido_numero: linha.numero },
        id,
      );
      // T-0114: o Hub devolve o cancelamento ao ERP (conectores que aceitam). Mesma transação: ou tudo, ou nada.
      await tx.publicar(
        EVENTO_PEDIDO_CANCELADO,
        { tenant_id: ctx.usuario.tenant_id, pedido_id: id, numero: linha.numero ?? null, external_id: linha.numero_erp ?? null, enviado_ao_erp: false, motivo, cancelado_por: ctx.usuario.id, cancelado_em: agora },
        id,
      );
      return { id, status: 'cancelled' };
    });
  },
};
