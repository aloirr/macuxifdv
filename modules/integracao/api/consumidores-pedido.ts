/**
 * A8 — consumidores do Vendedor na fila do ERP (RN-INT-08; ADR 0007: efeito e `evento_consumo` na mesma transação).
 *  - `vendedor.pedido.aprovado@1` (traz o pedido pronto): `decidirEntradaNaFila` → cria `pedido_fila_erp` (idempotente pelo
 *    `pedido_uuid`), retém sem de-para OU sem as chaves do ERP de cliente/vendedor/produto (nunca lança: mensagem diz o que completar;
 *    um novo aprovado@1 com as chaves libera, T-0032 — o Vendedor hoje não reaprova; a saída é cancelar e refazer), troca o conteúdo antes da 1ª entrega ou ignora.
 *  - `vendedor.pedido.status_alterado@1` (não traz o pedido): saída de `aprovado` antes da 1ª entrega tira da fila; depois da
 *    entrega nada muda (o ERP é quem avisa o cancelamento, retorno `cancelado`). Entrada em `aprovado` é do evento acima.
 *  - `vendedor.pedido.cancelado@1` (T-0114): nao entregue sai da fila; entregue + Conector com `aceita_cancelamento` vira `cancelamento_estado = 'pendente'`
 *    (sai em `GET /pedidos/pendentes`, campo `cancelamentos`; a confirmacao e o retorno `cancelado`); sem o aceite nada muda. Idempotente pelo
 *    pedido (e pelo evento, `evento_consumo`). Decisao em `decidirCancelamento` (domain).
 * Limite conhecido: a ordem entre os dois eventos não é garantida (ADR 0007); um cancelamento que chegue ANTES do aprovado do
 * mesmo pedido não é revisto aqui (o `alterado_em` do status não é gravado na fila).
 */
import { definirConsumidor, eventoTolerante, type ContextoConsumo } from '@macuxi/platform-sdk';
// T-0024: a definição é do dono (Vendedor); leitura tolerante, sem espelho do payload
import { EVENTO_PEDIDO_APROVADO, EVENTO_PEDIDO_CANCELADO, EVENTO_PEDIDO_STATUS_ALTERADO, type PedidoAprovadoEvento, type PedidoCanceladoEvento, type PedidoStatusAlteradoEvento } from '../../vendedor/contracts';
import { decidirCancelamento, decidirEntradaNaFila, erpAceitaCancelamento, exigeConector, montarSnapshotParaFila, type ConectorParaAceite, type Mapeamento, type PedidoNaFila, type PedidoParaCancelar } from '../domain';
import { naFila, type LinhaFila } from './rotas-pedidos';


async function lerFila(ctx: ContextoConsumo, pedidoUuid: string): Promise<PedidoNaFila | null> {
  const { rows } = await ctx.db.query<LinhaFila>(
    `select pedido_uuid, estado, payload, enviado_em, tentativas, numero_erp, motivo, notas_aplicadas, itens_faturados_acumulados, retencao_codigo, retencao_mensagem, deleted_at
       from integracao.pedido_fila_erp where tenant_id = $1 and pedido_uuid = $2 for update`,
    [ctx.envelope.tenant_id, pedidoUuid],
  );
  return rows[0] ? naFila(rows[0]) : null;
}

export async function entrarNaFila(p: PedidoAprovadoEvento, ctx: ContextoConsumo): Promise<void> {
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

export async function sairDaFila(p: Pick<PedidoStatusAlteradoEvento, 'pedido_id' | 'para' | 'alterado_em'>, ctx: ContextoConsumo): Promise<void> {
  if (p.para === 'aprovado') return;
  const existente = await lerFila(ctx, p.pedido_id);
  const d = decidirEntradaNaFila({ existente, statusPedido: p.para, snapshot: null, mapeamentos: [] });
  if (d.acao !== 'remover_da_fila') return;
  await ctx.db.query('update integracao.pedido_fila_erp set deleted_at = now() where tenant_id = $1 and pedido_uuid = $2', [ctx.envelope.tenant_id, p.pedido_id]);
  ctx.log.info({ acao: d.acao }, 'pedido saiu da fila do ERP antes da entrega');
}

interface LinhaCancelamento {
  pedido_uuid: string;
  estado: PedidoParaCancelar['estado'];
  tentativas: number;
  numero_erp: string | null;
  deleted_at: Date | null;
  cancelamento_estado: PedidoParaCancelar['cancelamento_estado'];
  cancelamento_motivo: string | null;
  cancelamento_solicitado_em: Date | string | null;
  cancelamento_enviado_em: Date | string | null;
  cancelamento_tentativas: number;
}

const iso = (v: Date | string | null): string | null => (v === null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());

export const paraCancelar = (l: LinhaCancelamento): PedidoParaCancelar => ({
  pedido_uuid: l.pedido_uuid,
  estado: l.estado,
  tentativas: l.tentativas,
  numero_erp: l.numero_erp,
  removido_em: iso(l.deleted_at),
  cancelamento_estado: l.cancelamento_estado,
  cancelamento_motivo: l.cancelamento_motivo,
  cancelamento_solicitado_em: iso(l.cancelamento_solicitado_em),
  cancelamento_enviado_em: iso(l.cancelamento_enviado_em),
  cancelamento_tentativas: l.cancelamento_tentativas,
});

export const COLUNAS_CANCELAMENTO = `pedido_uuid, estado, tentativas, numero_erp, deleted_at, cancelamento_estado, cancelamento_motivo, cancelamento_solicitado_em, cancelamento_enviado_em, cancelamento_tentativas`;

/** T-0114: cancelamento do Macuxi (nunca lança; o que não vale é ignorado com o motivo no log). */
export async function tratarCancelamento(p: Pick<PedidoCanceladoEvento, 'pedido_id' | 'motivo' | 'cancelado_em'>, ctx: ContextoConsumo): Promise<void> {
  const tenantId = ctx.envelope.tenant_id;
  const { rows } = await ctx.db.query<LinhaCancelamento>(
    `select ${COLUNAS_CANCELAMENTO} from integracao.pedido_fila_erp where tenant_id = $1 and pedido_uuid = $2 for update`,
    [tenantId, p.pedido_id],
  );
  const existente = rows[0] ? paraCancelar(rows[0]) : null;
  // a mesma regra da consulta integracao.cancelamento_erp@1: Conector ativo que recebe pedidos e aceita cancelamento
  const { rows: cfg } = await ctx.db.query<ConectorParaAceite>('select ativo, recebe_pedidos, aceita_cancelamento from integracao.conector where tenant_id = $1 and deleted_at is null', [tenantId]);
  const d = decidirCancelamento({ existente, aceitaCancelamento: erpAceitaCancelamento(cfg), motivo: p.motivo });
  if (d.acao === 'remover_da_fila') {
    await ctx.db.query('update integracao.pedido_fila_erp set deleted_at = now() where tenant_id = $1 and pedido_uuid = $2', [tenantId, p.pedido_id]);
  } else if (d.acao === 'solicitar_ao_erp') {
    await ctx.db.query(
      `update integracao.pedido_fila_erp
          set cancelamento_estado = 'pendente', cancelamento_motivo = $3, cancelamento_solicitado_em = $4::timestamptz, cancelamento_enviado_em = null, cancelamento_tentativas = 0
        where tenant_id = $1 and pedido_uuid = $2 and cancelamento_estado is null`,
      [tenantId, p.pedido_id, d.motivo, p.cancelado_em],
    );
  }
  ctx.log.info({ acao: d.acao, ...(d.acao === 'ignorar' ? { motivo: d.motivo } : {}) }, 'cancelamento do pedido tratado na fila do ERP');
}

export const consumidorPedidoAprovado = definirConsumidor({ evento: eventoTolerante(EVENTO_PEDIDO_APROVADO), executar: entrarNaFila });
export const consumidorPedidoStatusAlterado = definirConsumidor({ evento: eventoTolerante(EVENTO_PEDIDO_STATUS_ALTERADO), executar: sairDaFila });
export const consumidorPedidoCancelado = definirConsumidor({ evento: eventoTolerante(EVENTO_PEDIDO_CANCELADO), executar: tratarCancelamento });
