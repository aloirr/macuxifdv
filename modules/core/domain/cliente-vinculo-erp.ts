/** RN-CORE-74 (proposta): vínculo do cliente aprovado com o código do ERP. Função pura; a API revalida. */
export interface ClienteParaVinculo {
  aprovado: boolean;
  external_id: string | null;
}
export type DecisaoVinculoErp =
  | { acao: 'gravar' }
  | { acao: 'nada'; resultado: 'ja_vinculado' }
  | { acao: 'recusar'; resultado: 'nao_encontrado' | 'nao_aprovado' | 'conflito' | 'codigo_em_uso' };

export function decidirVinculoErp(cliente: ClienteParaVinculo | null, codigo: string, codigoEmUsoPorOutro: boolean): DecisaoVinculoErp {
  const novo = codigo.trim();
  if (!cliente) return { acao: 'recusar', resultado: 'nao_encontrado' };
  if (cliente.external_id !== null) {
    return cliente.external_id === novo ? { acao: 'nada', resultado: 'ja_vinculado' } : { acao: 'recusar', resultado: 'conflito' };
  }
  if (!cliente.aprovado) return { acao: 'recusar', resultado: 'nao_aprovado' };
  if (codigoEmUsoPorOutro) return { acao: 'recusar', resultado: 'codigo_em_uso' };
  return { acao: 'gravar' };
}
