/**
 * A8 — consumidores do Vendedor na fila do ERP (RN-INT-08; ADR 0007: efeito e `evento_consumo` na mesma transação).
 *  - `vendedor.pedido.aprovado@1` (traz o pedido pronto): `decidirEntradaNaFila` → cria `pedido_fila_erp` (idempotente pelo
 *    `pedido_uuid`), retém sem de-para OU sem as chaves do ERP de cliente/vendedor/produto (nunca lança: mensagem diz o que completar;
 *    um novo aprovado@1 com as chaves libera, T-0032 — o Vendedor hoje não reaprova; a saída é cancelar e refazer), troca o conteúdo antes da 1ª entrega ou ignora.
 *  - `vendedor.pedido.status_alterado@1` (não traz o pedido): saída de `aprovado` antes da 1ª entrega tira da fila; depois da
 *    entrega nada muda (o ERP é quem avisa o cancelamento, retorno `cancelado`). Entrada em `aprovado` é do evento acima.
 * Limite conhecido: a ordem entre os dois eventos não é garantida (ADR 0007); um cancelamento que chegue ANTES do aprovado do
 * mesmo pedido não é revisto aqui (o `alterado_em` do status não é gravado na fila).
 */
import { definirConsumidor, definirEvento, type ContextoConsumo } from '@macuxi/platform-sdk';
import { PedidoAprovadoConsumido, PedidoStatusAlteradoConsumido } from '../contracts';
import { decidirEntradaNaFila, exigeConector, montarSnapshotParaFila, type Mapeamento, type PedidoNaFila } from '../domain';
import { naFila, type LinhaFila } from './rotas-pedidos';

export const EVENTO_VENDEDOR_PEDIDO_APROVADO = definirEvento('vendedor.pedido.aprovado@1', PedidoAprovadoConsumido);
export const EVENTO_VENDEDOR_PEDIDO_STATUS_ALTERADO = definirEvento('vendedor.pedido.status_alterado@1', PedidoStatusAlteradoConsumido);

async function lerFila(ctx: ContextoConsumo, pedidoUuid: string): Promise<PedidoNaFila | null> {
  const { rows } = await ctx.db.query<LinhaFila>(
    `select pedido_uuid, estado, payload, enviado_em, tentativas, numero_erp, motivo, notas_aplicadas, itens_faturados_acumulados, retencao_codigo, retencao_mensagem, deleted_at
       from integracao.pedido_fila_erp where tenant_id = $1 and pedido_uuid = $2 for update`,
    [ctx.envelope.tenant_id, pedidoUuid],
  );
  return rows[0] ? naFila(rows[0]) : null;
}

export async function entrarNaFila(p: PedidoAprovadoConsumido, ctx: ContextoConsumo): Promise<void> {
  const tenantId = ctx.envelope.tenant_id;
  const existente = await lerFila(ctx, p.pedido_uuid);
  const { rows: map } = await ctx.db.query<Mapeamento>(
    "select tipo, codigo_erp, codigo_macuxi, ativo from integracao.mapeamento where tenant_id = $1 and tipo = 'condicao_pagamento' and deleted_at is null",
    [tenantId],
  );
  // o contrato do ERP exige as chaves do cliente, do vendedor e dos produtos. Sem elas NÃO se lança erro (a outbox repetiria e
  // desistiria em ~50 min e o pedido sumiria): o pedido fica RETIDO na fila, com a mensagem do que completar (T-0032)
  const montado = montarSnapshotParaFila(p);
  const d = decidirEntradaNaFila({
    existente,
    statusPedido: 'aprovado',
    snapshot: montado.ok ? montado.snapshot : null,
    invalido: montado.ok ? null : { mensagem: montado.mensagem },
    mapeamentos: map,
  });
  const origem = JSON.stringify(p);

  switch (d.acao) {
    case 'criar':
      await ctx.db.query(
        `insert into integracao.pedido_fila_erp (tenant_id, pedido_uuid, estado, payload, payload_origem, aprovado_em, exige_conector)
         values ($1, $2, 'pendente', $3::jsonb, $4::jsonb, $5::timestamptz, $6) on conflict (tenant_id, pedido_uuid) do nothing`,
        [tenantId, p.pedido_uuid, JSON.stringify(d.pedido), origem, p.aprovado_em, exigeConector(d.pedido)],
      );
      break;
    case 'reativar':
      await ctx.db.query(
        `update integracao.pedido_fila_erp
            set deleted_at = null, estado = 'pendente', tentativas = 0, enviado_em = null, conector_id = null, retencao_codigo = null, retencao_mensagem = null,
                payload = $3::jsonb, payload_origem = $4::jsonb, aprovado_em = $5::timestamptz, exige_conector = $6
          where tenant_id = $1 and pedido_uuid = $2`,
        [tenantId, p.pedido_uuid, JSON.stringify(d.pedido), origem, p.aprovado_em, exigeConector(d.pedido)],
      );
      break;
    case 'atualizar_payload':
      await ctx.db.query(
        `update integracao.pedido_fila_erp set payload = $3::jsonb, payload_origem = $4::jsonb, aprovado_em = $5::timestamptz, retencao_codigo = null, retencao_mensagem = null, exige_conector = $6
          where tenant_id = $1 and pedido_uuid = $2`,
        [tenantId, p.pedido_uuid, JSON.stringify(d.pedido), origem, p.aprovado_em, exigeConector(d.pedido)],
      );
      break;
    case 'reter':
      if (d.persistencia === 'inserir') {
        await ctx.db.query(
          `insert into integracao.pedido_fila_erp (tenant_id, pedido_uuid, estado, payload, payload_origem, retencao_codigo, retencao_mensagem, aprovado_em)
           values ($1, $2, 'pendente', null, $3::jsonb, $4, $5, $6::timestamptz) on conflict (tenant_id, pedido_uuid) do nothing`,
          [tenantId, p.pedido_uuid, origem, d.codigo, d.mensagem, p.aprovado_em],
        );
      } else {
        await ctx.db.query(
          `update integracao.pedido_fila_erp
              set deleted_at = null, estado = 'pendente', tentativas = 0, enviado_em = null, conector_id = null, payload = null,
                  payload_origem = $3::jsonb, retencao_codigo = $4, retencao_mensagem = $5, aprovado_em = $6::timestamptz
            where tenant_id = $1 and pedido_uuid = $2`,
          [tenantId, p.pedido_uuid, origem, d.codigo, d.mensagem, p.aprovado_em],
        );
      }
      break;
    case 'remover_da_fila':
    case 'ignorar':
      break;
  }
  ctx.log.info({ acao: d.acao, ...(d.acao === 'ignorar' ? { motivo: d.motivo } : {}) }, 'pedido aprovado tratado na fila do ERP');
}

export async function sairDaFila(p: PedidoStatusAlteradoConsumido, ctx: ContextoConsumo): Promise<void> {
  if (p.para === 'aprovado') return;
  const existente = await lerFila(ctx, p.pedido_id);
  const d = decidirEntradaNaFila({ existente, statusPedido: p.para, snapshot: null, mapeamentos: [] });
  if (d.acao !== 'remover_da_fila') return;
  await ctx.db.query('update integracao.pedido_fila_erp set deleted_at = now() where tenant_id = $1 and pedido_uuid = $2', [ctx.envelope.tenant_id, p.pedido_id]);
  ctx.log.info({ acao: d.acao }, 'pedido saiu da fila do ERP antes da entrega');
}

export const consumidorPedidoAprovado = definirConsumidor({ evento: EVENTO_VENDEDOR_PEDIDO_APROVADO, executar: entrarNaFila });
export const consumidorPedidoStatusAlterado = definirConsumidor({ evento: EVENTO_VENDEDOR_PEDIDO_STATUS_ALTERADO, executar: sairDaFila });
