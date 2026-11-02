/**
 * Consumidor de `integracao.pedido.retorno_erp@1` (T-0053; RN-VEN-30, RN-INT-08, ADR 0007). O despachante da outbox roda
 * na transação do tenant do evento (RLS) e registra o consumo junto: reentrega não repete o efeito.
 *
 * Efeito: status do pedido (só para a frente, `planejarRetornoErp`), número do ERP, histórico (autor "ERP"),
 * `vendedor.pedido.status_alterado@1` por transição e `vendedor.pedido.faturado@1` por nota faturada (RN-TRE-08).
 * Sem `tx.consultar` aqui: só tabelas do próprio Vendedor. Nenhum dado pessoal no log.
 */
import { definirConsumidor, type ConsumidorEvento, type ContextoConsumo } from '@macuxi/platform-sdk';
import { EVENTO_PEDIDO_FATURADO, EVENTO_PEDIDO_STATUS_ALTERADO, EVENTO_RETORNO_ERP_CONSUMIDO, type RetornoErpConsumido } from '../contracts';
import { itensFaturadosDoRetorno, planejarRetornoErp, statusDoContrato, type ItemDoPedidoEnviado } from '../domain';
import type { OrderStatus } from '../domain/order';

export const AUTOR_ERP = { nome: 'ERP', perfil: 'erp' } as const;

export async function aplicarRetornoErp(r: RetornoErpConsumido, ctx: Pick<ContextoConsumo, 'db' | 'publicar' | 'log'>): Promise<void> {
  const { db } = ctx;
  const pedido = (
    await db.query<{ status: OrderStatus; vendedor_id: string }>('select status, vendedor_id from vendedor.pedido where id = $1 and deleted_at is null for update', [r.pedido_uuid])
  ).rows[0];
  if (!pedido) {
    // pedido de outro tenant nunca chega (RLS); inexistente aqui = nada a fazer (não relança: o evento não mudaria)
    ctx.log.warn({ status_erp: r.status }, 'retorno do ERP de pedido desconhecido: ignorado');
    return;
  }
  const plano = planejarRetornoErp(pedido.status, r);
  if (plano.acao === 'ignorar') {
    ctx.log.info({ status_erp: r.status, status_pedido: pedido.status, motivo: plano.motivo }, 'retorno do ERP ignorado');
    return;
  }

  await db.query(
    `update vendedor.pedido
        set status = $2,
            numero_erp = coalesce($3, numero_erp),
            motivo_rejeicao = coalesce($4, motivo_rejeicao),
            motivo_cancelamento = coalesce($5, motivo_cancelamento)
      where id = $1`,
    [r.pedido_uuid, plano.para, plano.numero_erp, plano.motivo_rejeicao, plano.motivo_cancelamento],
  );

  if (plano.muda_status) {
    await db.query(
      `insert into vendedor.pedido_evento (tenant_id, pedido_id, de, para, autor_id, autor_nome, autor_perfil, motivo, nivel, acima_do_nivel, ocorrido_em)
       values (plataforma.tenant_atual(), $1, $2, $3, null, $4, $5, $6, null, false, $7)`,
      [r.pedido_uuid, plano.de, plano.para, AUTOR_ERP.nome, AUTOR_ERP.perfil, plano.texto_historico, r.ocorrido_em],
    );
    await ctx.publicar(
      EVENTO_PEDIDO_STATUS_ALTERADO,
      {
        pedido_id: r.pedido_uuid,
        vendedor_id: pedido.vendedor_id,
        de: statusDoContrato(plano.de),
        para: statusDoContrato(plano.para),
        alterado_em: r.ocorrido_em,
        autor_id: null,
        motivo: plano.texto_historico,
      },
      r.pedido_uuid,
    );
  }

  if (plano.faturar) {
    const itens = (
      await db.query<ItemDoPedidoEnviado>('select sequencia, produto_id, quantidade from vendedor.pedido_item where pedido_id = $1 and deleted_at is null order by sequencia', [r.pedido_uuid])
    ).rows;
    // sem o acumulado por item (0013: pedido_item.quantidade_faturada), o total depois de parcial sem itens fica sem base
    const f = itensFaturadosDoRetorno(r.status, plano.de, itens, r.itens_faturados ?? null);
    if (f.base === 'sem_base') {
      ctx.log.warn({ status_erp: r.status }, 'faturamento sem itens identificáveis: vendedor.pedido.faturado@1 não publicado');
      return;
    }
    await ctx.publicar(
      EVENTO_PEDIDO_FATURADO,
      {
        pedido_id: r.pedido_uuid,
        vendedor_id: pedido.vendedor_id,
        faturado_em: r.nota?.emitida_em ?? r.ocorrido_em,
        parcial: r.status === 'faturado_parcial',
        itens: f.itens.map((i) => ({ produto_id: i.product_id, quantidade: i.quantity })),
      },
      r.pedido_uuid,
    );
  }
}

export const consumidorRetornoErp: ConsumidorEvento = definirConsumidor({
  evento: EVENTO_RETORNO_ERP_CONSUMIDO,
  executar: (payload, ctx) => aplicarRetornoErp(payload, ctx),
});
