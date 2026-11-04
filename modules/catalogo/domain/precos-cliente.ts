/**
 * Preços de uma lista de produtos na tabela do cliente (`catalogo.precos_cliente@1`, ADR 0012). Função pura: a API
 * (SQL) e o aparelho (linhas locais) só carregam os dados e chamam esta função, então decidem igual.
 * RN-CAT-06 (fora da tabela do cliente = sem preço, nunca a tabela padrão), RN-CAT-05 (promotor sem preço),
 * P-4 (preço pela data do pedido, até 7 dias para trás e nunca no futuro).
 */
import { DIAS_RETROATIVO_PRECO, type ItemTabelaPreco, type PrecosClienteSaida } from '../contracts';
import { MENSAGEM_SEM_PRECO_CLIENTE, precoVisivel } from './preco';

/** RN-CAT-05: o perfil não tem direito ao preço. */
export const MOTIVO_PERFIL_SEM_PRECO = 'Preço não disponível para o seu perfil.';

/** P-4: `em` limitado a `[agora − 7 dias, agora]`. Ambos em ISO UTC. */
export function dataDoPreco(em: string, agora: string): string {
  const fim = Date.parse(agora);
  const ini = fim - DIAS_RETROATIVO_PRECO * 86_400_000;
  const t = Date.parse(em);
  if (Number.isNaN(fim) || Number.isNaN(t)) throw new RangeError('Informe as datas em ISO 8601 UTC.');
  return new Date(Math.min(Math.max(t, ini), fim)).toISOString();
}

export interface EntradaPrecosCliente {
  produtoIds: readonly string[];
  /** Tabela ativa do cliente; nula = cliente sem tabela (ou tabela inativa/removida). */
  tabelaId: string | null;
  /** Itens da tabela do cliente (qualquer vigência); os de outras tabelas são ignorados. */
  itens: readonly ItemTabelaPreco[];
  /** Data pedida pelo consumidor e relógio de quem responde (ISO UTC). */
  em: string;
  agora: string;
  /** `podeVerPrecoEstoque(perfil, parametros)` (RN-CAT-05). */
  verPreco: boolean;
}

/** RN-VEN-15: preço próprio por medida (linhas com unidade), vigente em `quando`; uma entrada por unidade, na ordem de aparição. */
function embalagensDoProduto(produtoId: string, daTabela: readonly ItemTabelaPreco[], tabelaId: string, quando: string): Array<{ unidade: string; preco_cents: number }> {
  const unidades = [...new Set(daTabela.filter((i) => i.product_id === produtoId && i.unit != null).map((i) => i.unit as string))];
  const saida: Array<{ unidade: string; preco_cents: number }> = [];
  for (const unidade of unidades) {
    const linhas = daTabela.filter((i) => i.unit === unidade).map((i) => ({ ...i, unit: null }));
    const p = precoVisivel(produtoId, linhas, [], { agora: quando, tabela_cliente_id: tabelaId });
    if (p.sellable && p.price_cents !== null) saida.push({ unidade, preco_cents: p.price_cents });
  }
  return saida;
}

export function precosDoCliente(e: EntradaPrecosCliente): PrecosClienteSaida {
  const ids = [...new Set(e.produtoIds)];
  if (!e.verPreco) {
    return { tabela_preco_id: null, itens: ids.map((produto_id) => ({ produto_id, preco_cents: null, motivo_sem_preco: MOTIVO_PERFIL_SEM_PRECO })) };
  }
  if (e.tabelaId === null) {
    return { tabela_preco_id: null, itens: ids.map((produto_id) => ({ produto_id, preco_cents: null, motivo_sem_preco: MENSAGEM_SEM_PRECO_CLIENTE })) };
  }
  const tabelaId = e.tabelaId;
  const quando = dataDoPreco(e.em, e.agora);
  const daTabela = e.itens.filter((i) => i.price_table_id === e.tabelaId);
  // RN-VEN-15: preco_cents é só da unidade base (unit nula); a linha de embalagem (ex.: CX) nunca vira o preço da UN
  const itens = daTabela.filter((i) => i.unit == null);
  return {
    tabela_preco_id: e.tabelaId,
    itens: ids.map((produto_id) => {
      const p = precoVisivel(produto_id, itens, [], { agora: quando, tabela_cliente_id: e.tabelaId });
      if (p.sellable && p.price_cents !== null) {
        const embalagens = embalagensDoProduto(produto_id, daTabela, tabelaId, quando);
        return embalagens.length > 0
          ? { produto_id, preco_cents: p.price_cents, motivo_sem_preco: null, embalagens }
          : { produto_id, preco_cents: p.price_cents, motivo_sem_preco: null };
      }
      return { produto_id, preco_cents: null, motivo_sem_preco: p.notice ?? MENSAGEM_SEM_PRECO_CLIENTE };
    }),
  };
}
