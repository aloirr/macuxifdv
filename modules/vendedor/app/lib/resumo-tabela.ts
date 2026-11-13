/**
 * T-0150 (docs/design/pedido-v4.md §1): o Resumo do Novo pedido em tabelas. Partes puras, sem React: a tela só desenha.
 * Cliente (razão social, CNPJ) · Venda (pagamento, prazo) · Entrega (frete, endereço) · Itens (Código, Emb., Qtd, Valor tabela, Desc./Acrésc., Total).
 */
import { rotuloMedida } from '../../domain/preco-pedido';
import { linhaDeItemEmTabela, type LinhaDeItemEmTabela } from './detalhe-pedido';
import type { LinhaDoPedido } from './novo-pedido';

const TRACO = '—';

/** "Boleto · 28/56 dias" → { pagamento: "Boleto", prazo: "28/56 dias" }; sem separador, tudo é o pagamento e o prazo fica "—". */
export function dividirPagamentoPrazo(terms: string): { pagamento: string; prazo: string } {
  const partes = terms
    .split('·')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (partes.length === 0) return { pagamento: TRACO, prazo: TRACO };
  if (partes.length === 1) return { pagamento: partes[0]!, prazo: TRACO };
  return { pagamento: partes[0]!, prazo: partes.slice(1).join(' · ') };
}

/** Frete do Resumo: "CIF" ou "FOB · Transportes Rio Negro". */
export function textoDoFrete(modalidade: 'CIF' | 'FOB', transportadora: string | null | undefined): string {
  const t = modalidade === 'FOB' ? (transportadora ?? '').trim() : '';
  return t ? `${modalidade} · ${t}` : modalidade;
}

/** Itens do Resumo em tabela (T-0165): o preço é o de tabela da embalagem vendida (a tabela multiplica pela quantidade); o % do item vem do equivalente (vale também no ajuste em R$). */
export function itensDoResumoEmTabela(linhas: readonly LinhaDoPedido[], nome: (produtoId: string) => string, codigo: (produtoId: string) => string, marca: (produtoId: string) => string | null | undefined = () => null): Array<LinhaDeItemEmTabela & { key: string }> {
  return linhas.map((l) => {
    const eq = l.equivalente;
    return {
      key: l.chave,
      ...linhaDeItemEmTabela({
        description: nome(l.product_id),
        brand: marca(l.product_id),
        erp_code: codigo(l.product_id),
        quantity: l.quantity,
        unit_label: rotuloMedida(l.unidade_sigla, l.fator),
        unit_price_cents: l.preco_tabela_cents,
        total_cents: l.total_cents,
        ...(eq?.sentido === 'desconto' ? { discount_pct: eq.pct_exibicao } : {}),
        ...(eq?.sentido === 'acrescimo' ? { surcharge_pct: eq.pct_exibicao } : {}),
      }),
    };
  });
}
