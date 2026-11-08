/**
 * Preço congelado do orçamento (T-0134; RN-VEN-18). O orçamento guarda o preço de tabela de cada item no momento em que foi
 * salvo. Ao editá-lo (PUT /orcamentos/:id) ou transformá-lo em pedido (`orcamento_origem_id`), o servidor reaplica esse
 * preço aos itens que já existiam e só consulta a tabela de hoje para o item novo. Quem decide o preço é o servidor: o
 * aparelho nunca manda preço.
 */
import type { ClienteBanco } from '@macuxi/platform-sdk';
import { precosCongelados } from '../domain/orcamento';

/** produto → preço de tabela por unidade, como gravado nos itens ativos do orçamento `id`. */
export async function precosCongeladosDoDocumento(db: ClienteBanco, id: string): Promise<Record<string, number>> {
  const { rows } = await db.query<{ produto_id: string; preco_tabela_cents: number; fator: number }>(
    'select produto_id, preco_tabela_cents::float8 as preco_tabela_cents, fator::float8 as fator from vendedor.pedido_item where pedido_id = $1 and deleted_at is null order by sequencia',
    [id],
  );
  return precosCongelados(rows.map((r) => ({ product_id: r.produto_id, preco_tabela_cents: Number(r.preco_tabela_cents), fator: Number(r.fator) })));
}
