/**
 * Catálogo → "Adicionar ao orçamento" (decisão do dono do produto, R-20261114-151000). Função pura: quais orçamentos o
 * vendedor pode escolher. Premissa: não há RN própria de "em aberto"; vale a RN-VEN-18 (o orçamento não vence) e o ciclo
 * da RN-VEN-30 (aberto → convertido ou cancelado), via `orcamentoEmAberto` (a mesma regra do card do Início). Só os do próprio vendedor (RN-VEN-18: a
 * Gestão só vê o orçamento de outro vendedor, não o edita).
 */
import { orcamentoEmAberto } from './resumo-inicio';

export const TEXTO_SEM_ORCAMENTO_EM_ABERTO = 'Nenhum orçamento em aberto.';

export interface DocumentoParaEscolha {
  id: string;
  /** ausente = pedido */
  tipo?: string | null;
  status: string;
  convertido_pedido_id?: string | null;
  vendedor_id: string;
  /** vazio enquanto o orçamento está só na fila do aparelho */
  numero: string;
  cliente_nome: string;
  /** instante UTC de criação (a tela mostra no fuso do tenant) */
  criado_em: string;
}

export interface OrcamentoParaEscolha {
  id: string;
  numero: string;
  cliente_nome: string;
  criado_em: string;
}

/** RN-VEN-18 / RN-VEN-30: orçamentos em aberto do vendedor, do mais novo ao mais antigo. */
export function orcamentosEmAberto(docs: readonly DocumentoParaEscolha[], vendedorId: string): OrcamentoParaEscolha[] {
  return docs
    .filter((d) => d.vendedor_id === vendedorId && orcamentoEmAberto({ tipo: d.tipo === 'orcamento' ? 'orcamento' : 'pedido', status: d.status, total_cents: 0, convertido_pedido_id: d.convertido_pedido_id }))
    .map((d) => ({ id: d.id, numero: d.numero, cliente_nome: d.cliente_nome, criado_em: d.criado_em }))
    .sort((a, b) => b.criado_em.localeCompare(a.criado_em));
}
