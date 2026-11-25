/**
 * RN-VEN-48 (R-20261124-114951): monta a entrada de `acoesDoPedidoNaLista` (domain) a partir da linha da aba Pedidos e das permissões
 * do perfil, e as opções da folha "Ações". Puro, sem React; a regra mora no domain.
 */
import { acoesDoPedidoNaLista, ROTULOS_DAS_ACOES_DA_LISTA, type AcaoDaLista, type AcoesDaLista, type EntradaAcoesDaLista } from '../../domain/acoes-da-lista';
import { situacaoNaTela } from './pre-venda';
import type { PedidoDaLista } from './pedidos';

const SEM_PERMISSAO: EntradaAcoesDaLista['pode'] = { criar: false, editar: false, cancelar: false };

export function acoesDaLinha(o: PedidoDaLista, e: { agora: Date; pode: EntradaAcoesDaLista['pode']; comAcoes: boolean }): AcoesDaLista {
  // documento da equipe que não está no aparelho: nenhuma ação (o domain devolve lista vazia)
  if (!e.comAcoes) return acoesDoPedidoNaLista({ tipo: 'pedido', status: o.status, pode: SEM_PERMISSAO });
  const tipo = o.tipo === 'orcamento' ? 'orcamento' : 'pedido';
  return acoesDoPedidoNaLista({
    tipo,
    status: o.status,
    orcamento_aberto: tipo === 'orcamento' && situacaoNaTela(o, e.agora) === 'aberto',
    na_fila: o.local,
    recusado: o.local_failed === true,
    tem_itens: o.items_count > 0 || o.local,
    pode: e.pode,
  });
}

/** O título da folha é o item ("Pedido 000123", "Orçamento 000045"); sem número, a razão do cliente. */
export function tituloDaFolhaDeAcoes(o: Pick<PedidoDaLista, 'tipo' | 'number' | 'customer_name'>): string {
  return o.number ? `${o.tipo === 'orcamento' ? 'Orçamento' : 'Pedido'} ${o.number}` : o.customer_name;
}

/** Rótulo acessível do botão Ações: com número, "Ações do pedido 000123"; sem número, a razão do cliente (a mesma do título da folha). */
export function rotuloAcessivelDoBotaoAcoes(o: Pick<PedidoDaLista, 'tipo' | 'number' | 'customer_name'>): string {
  return o.number ? `Ações do ${o.tipo === 'orcamento' ? 'orçamento' : 'pedido'} ${o.number}` : `Ações de ${tituloDaFolhaDeAcoes(o)}`;
}

export const ROTULO_DO_BOTAO_ACOES = 'Ações';

export function opcoesDaFolhaDeAcoes(a: AcoesDaLista): Array<{ id: AcaoDaLista; rotulo: string; perigo?: boolean }> {
  return a.lista.map((id) => ({ id, rotulo: ROTULOS_DAS_ACOES_DA_LISTA[id], ...(id === 'excluir' ? { perigo: true } : {}) }));
}
