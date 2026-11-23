/**
 * RN-CORE-78: retorno do ERP sobre o pré-cadastro (vínculo com o código ou recusa com motivo). Funções puras; a API revalida.
 * O cliente chega 'pendente'; o legado 'aprovado' (v1.0.27, sem código) também aceita o código.
 */
import type { ErroCampoCadastro, StatusCadastro } from '../contracts/cliente-pre-cadastro';
import { motivoRecusaCortado } from './cliente-pre-cadastro';

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

export type DecisaoRecusaErp =
  | { acao: 'gravar' }
  | { acao: 'nada'; resultado: 'nao_encontrado' | 'ja_recusado' | 'ja_vinculado' | 'revisao_antiga' | 'revisao_desconhecida' };

/** Cliente para a recusa (v1.0.29, ADR 0069): revisão e a recusa já gravada são opcionais (ausente = revisão 1, sem erros). */
export interface ClienteParaRecusa extends ClienteParaVinculo {
  revisao_cadastro?: number | null;
  motivo_recusa?: string | null;
  erros_recusa?: readonly ErroCampoCadastro[] | null;
}

/** Erros comparados sem depender da ordem (o ERP pode reenviar em outra ordem). */
const chaveErros = (erros: readonly ErroCampoCadastro[] | null | undefined): string =>
  (erros ?? []).map((e) => JSON.stringify([e.campo, e.codigo, e.mensagem])).sort().join('\n');

/**
 * Recusa do ERP (RN-CORE-78, RN-INT-22): cliente que já tem código não é recusado depois. A `revisao` do retorno (ausente = a atual)
 * menor que a do cliente não vale sobre a nova; maior é desconhecida. Na revisão atual grava em 'pendente' (ou legado 'aprovado' sem
 * código); já 'recusado' com o mesmo motivo e os mesmos erros é repetição; com outro motivo ou outros erros é fato novo e grava.
 * Sem `retorno` (chamador antigo), recusado é sempre repetição.
 */
export function decidirRecusaErp(cliente: ClienteParaRecusa | null, retorno?: { revisao?: number; motivo: string | null; erros: readonly ErroCampoCadastro[] }): DecisaoRecusaErp {
  if (!cliente) return { acao: 'nada', resultado: 'nao_encontrado' };
  if (cliente.external_id !== null) return { acao: 'nada', resultado: 'ja_vinculado' };
  const atual = cliente.revisao_cadastro ?? 1;
  const revisao = retorno?.revisao ?? atual;
  if (revisao < atual) return { acao: 'nada', resultado: 'revisao_antiga' };
  if (revisao > atual) return { acao: 'nada', resultado: 'revisao_desconhecida' };
  if (cliente.status_cadastro !== 'recusado') return { acao: 'gravar' };
  if (!retorno) return { acao: 'nada', resultado: 'ja_recusado' };
  const mesmo = motivoRecusaCortado(retorno.motivo) === motivoRecusaCortado(cliente.motivo_recusa) && chaveErros(retorno.erros) === chaveErros(cliente.erros_recusa);
  return mesmo ? { acao: 'nada', resultado: 'ja_recusado' } : { acao: 'gravar' };
}
