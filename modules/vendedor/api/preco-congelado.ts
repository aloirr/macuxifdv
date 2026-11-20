/**
 * Preço congelado do orçamento (T-0134; RN-VEN-18). O orçamento guarda o preço de tabela de cada item no momento em que foi
 * salvo. Ao editá-lo (PUT /orcamentos/:id) ou transformá-lo em pedido (`orcamento_origem_id`), o servidor reaplica esse
 * preço aos itens que já existiam e só consulta a tabela de hoje para o item novo. Quem decide o preço é o servidor: o
 * aparelho nunca manda preço. O congelado só vale no prazo em que foi gravado (RN-VEN-44).
 */
import type { ClienteBanco } from '@macuxi/platform-sdk';
import { precosCongelados } from '../domain/orcamento';
import { percentualAjusteParaBp } from '../domain/preco-pedido';

/** RN-VEN-18/44: os preços congelados do orçamento e o % (bp) do prazo em que foram gravados (retrato `pedido.prazo_percentual_ajuste`). */
export interface CongeladosDoDocumento {
  precos: Record<string, number>;
  percentual_ajuste_bp: number;
}

/** produto → preço de tabela por unidade, como gravado nos itens ativos do orçamento `id`, com o `prazo_percentual_ajuste` dele (sem prazo = null), que o chamador já leu. */
export async function precosCongeladosDoDocumento(db: ClienteBanco, id: string, prazoPercentual: number | null): Promise<CongeladosDoDocumento> {
  const { rows } = await db.query<{ produto_id: string; preco_tabela_cents: number; fator: number }>(
    'select produto_id, preco_tabela_cents::float8 as preco_tabela_cents, fator::float8 as fator from vendedor.pedido_item where pedido_id = $1 and deleted_at is null order by sequencia',
    [id],
  );
  return {
    precos: precosCongelados(rows.map((r) => ({ product_id: r.produto_id, preco_tabela_cents: Number(r.preco_tabela_cents), fator: Number(r.fator) }))),
    percentual_ajuste_bp: percentualAjusteParaBp(prazoPercentual),
  };
}
