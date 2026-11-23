/**
 * RN-CORE-78: retorno do ERP sobre o pré-cadastro (vínculo com o código ou recusa com motivo). Funções puras; a API revalida.
 * O cliente chega 'pendente'; o legado 'aprovado' (v1.0.27, sem código) também aceita o código.
 */
import type { StatusCadastro } from '../contracts/cliente-pre-cadastro';

export interface ClienteParaVinculo {
  status_cadastro: StatusCadastro | null;
  external_id: string | null;
}
export type DecisaoVinculoErp =
  | { acao: 'gravar' }
  | { acao: 'nada'; resultado: 'ja_vinculado' }
  | { acao: 'recusar'; resultado: 'nao_encontrado' | 'cadastro_recusado' | 'conflito' | 'codigo_em_uso' };

export function decidirVinculoErp(cliente: ClienteParaVinculo | null, codigo: string, codigoEmUsoPorOutro: boolean): DecisaoVinculoErp {
  const novo = codigo.trim();
  if (!cliente) return { acao: 'recusar', resultado: 'nao_encontrado' };
  if (cliente.external_id !== null) {
    return cliente.external_id === novo ? { acao: 'nada', resultado: 'ja_vinculado' } : { acao: 'recusar', resultado: 'conflito' };
  }
  if (cliente.status_cadastro === 'recusado') return { acao: 'recusar', resultado: 'cadastro_recusado' };
  if (codigoEmUsoPorOutro) return { acao: 'recusar', resultado: 'codigo_em_uso' };
  return { acao: 'gravar' };
}

export type DecisaoRecusaErp = { acao: 'gravar' } | { acao: 'nada'; resultado: 'nao_encontrado' | 'ja_recusado' | 'ja_vinculado' };

/** Recusa do ERP: grava em 'pendente' (ou legado 'aprovado' sem código); cliente que já tem código não é recusado depois. */
export function decidirRecusaErp(cliente: ClienteParaVinculo | null): DecisaoRecusaErp {
  if (!cliente) return { acao: 'nada', resultado: 'nao_encontrado' };
  if (cliente.external_id !== null) return { acao: 'nada', resultado: 'ja_vinculado' };
  if (cliente.status_cadastro === 'recusado') return { acao: 'nada', resultado: 'ja_recusado' };
  return { acao: 'gravar' };
}
