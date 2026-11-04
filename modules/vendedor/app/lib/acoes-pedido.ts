/**
 * Estado das ações do detalhe do pedido (editar, excluir, motivo do bloqueio). Puro, sem React.
 * P-2 (T-0029): só o que ainda está no aparelho se edita; pedido aceito pelo servidor se duplica.
 * RN-PRO-01: a permissão por ação (`pedido.editar`, `pedido.cancelar`) chega pronta do SDK em `pode`.
 */
import { editavelNaFatia, type OrderStatus } from '../../domain/order';

export interface EntradaAcoes {
  status: string;
  naFila: boolean;
  offline: boolean;
  /** API v1 (pedido vem do pull); na Fase M (v1 falso) o domain antigo decide */
  v1: boolean;
  /** vendedor dono do pedido (na Gestão a edição/duplicação não existe) */
  ehVendedor: boolean;
  temItens: boolean;
  /** T-0071 (RN-VEN-18): orçamento aberto já recebido também edita (pela API, com sinal) */
  orcamentoAberto?: boolean;
  pode: { editar: boolean; cancelar: boolean };
  /** o que `orderActions` (domain) já calculou */
  acoes: { can_edit: boolean; can_cancel: boolean; locked_reason: string };
}

export interface EstadoAcoes {
  podeEditar: boolean;
  podeExcluir: boolean;
  motivoBloqueio: string;
}

export function estadoDasAcoes(e: EntradaAcoes): EstadoAcoes {
  const precisaSinal = !e.naFila && e.offline;
  const editavel = !e.v1 ? e.acoes.can_edit && !precisaSinal : (e.naFila && editavelNaFatia(e.status as OrderStatus)) || (e.orcamentoAberto === true && !precisaSinal);
  const podeEditar = e.ehVendedor && e.pode.editar && editavel && e.temItens;
  const podeExcluir = e.pode.cancelar && e.acoes.can_cancel && !precisaSinal;
  let motivoBloqueio = '';
  if (e.acoes.locked_reason) motivoBloqueio = e.acoes.locked_reason;
  else if (e.v1 && !e.naFila && e.ehVendedor && !editavel && !e.orcamentoAberto) motivoBloqueio = 'Pedido já recebido pelo servidor: não pode ser editado. Duplique para fazer um novo.';
  else if (precisaSinal) motivoBloqueio = 'Sem sinal: editar ou excluir pedido já enviado precisa de conexão.';
  else if (!e.temItens) motivoBloqueio = TEXTO_SEM_ITENS;
  return { podeEditar, podeExcluir, motivoBloqueio };
}

export const TEXTO_SEM_ITENS = 'Itens ainda não sincronizados. Sincronize para ver.';

/** Rótulo do nível de aprovação (app e BKO mostram o mesmo texto). */
export function rotuloDoNivel(nivel: string): string {
  return nivel === 'supervisor' ? 'Supervisor' : nivel === 'gerente' ? 'Gerente' : nivel === 'analista' ? 'Analista' : nivel === 'director' ? 'Diretoria' : nivel;
}
