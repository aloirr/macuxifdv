/**
 * RN-VEN-20 (T-0149; RN-CORE-39): a API reserva e confere o estoque da FILIAL do pedido. A reserva não tem tabela: são os itens dos
 * pedidos aceitos e ainda não encerrados (migração 0061, `vendedor.pedido_item.filial_id` derivada por gatilho). O saldo da filial
 * vem do Catálogo (`saldoDaFilial`); enquanto o Catálogo não publicar a consulta de saldo por filial, o provedor fica ausente e
 * vale o comportamento anterior (a API não recusa por estoque; o app já manda o pedido sem estoque como orçamento).
 */
import type { ClienteBanco } from '@macuxi/platform-sdk';
import { produtosSemEstoqueNaFilial, STATUS_QUE_RESERVAM, type FaltaDeEstoque, type ItemParaEstoque } from '../domain';

/** Saldo (unidade base) por produto na filial; produto ausente do mapa = estoque não controlado. `null` = sem informação de saldo. */
export type ProvedorSaldoDaFilial = (produtoIds: readonly string[], filialId: string) => Promise<ReadonlyMap<string, number> | null>;

/** Reservas por produto na filial (RN-VEN-20), sem contar o próprio pedido (reenvio idempotente). */
export async function reservadoNaFilial(db: ClienteBanco, produtoIds: readonly string[], filialId: string, ignorarPedidoId: string): Promise<Map<string, number>> {
  const r = await db.query<{ produto_id: string; reservado: string }>(
    `select i.produto_id, sum(i.quantidade_base - i.quantidade_faturada)::text as reservado
       from vendedor.pedido_item i join vendedor.pedido p on p.tenant_id = i.tenant_id and p.id = i.pedido_id
      where i.produto_id = any($1::uuid[]) and i.filial_id = $2 and i.deleted_at is null
        and p.deleted_at is null and p.tipo = 'pedido' and p.id <> $3 and p.status = any($4::text[])
      group by i.produto_id`,
    [produtoIds, filialId, ignorarPedidoId, [...STATUS_QUE_RESERVAM]],
  );
  return new Map(r.rows.map((x) => [x.produto_id, Math.max(0, Number(x.reservado))]));
}

/**
 * Itens do pedido (não do orçamento) que passam do disponível da filial. Vazio = pode seguir. Sem filial, sem provedor ou sem
 * saldo conhecido: vazio (fallback seguro, comportamento anterior).
 */
export async function faltaDeEstoqueNaFilial(
  db: ClienteBanco,
  provedor: ProvedorSaldoDaFilial | null,
  itens: readonly ItemParaEstoque[],
  filialId: string | null,
  pedidoId: string,
): Promise<FaltaDeEstoque[]> {
  if (!provedor || !filialId || itens.length === 0) return [];
  const produtoIds = [...new Set(itens.map((i) => i.produto_id))];
  const saldo = await provedor(produtoIds, filialId);
  if (!saldo) return [];
  return produtosSemEstoqueNaFilial(itens, saldo, await reservadoNaFilial(db, produtoIds, filialId, pedidoId), filialId);
}

let provedorAtual: ProvedorSaldoDaFilial | null = null;
/** O plugin liga o provedor quando a consulta de saldo por filial do Catálogo existir; `null` desliga (testes). */
export const definirProvedorSaldoDaFilial = (p: ProvedorSaldoDaFilial | null): void => {
  provedorAtual = p;
};
export const provedorSaldoDaFilial = (): ProvedorSaldoDaFilial | null => provedorAtual;
