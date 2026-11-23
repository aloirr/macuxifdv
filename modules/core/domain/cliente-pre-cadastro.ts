/**
 * RN-CORE-78: cliente de pré-cadastro (origem campo ou bko, status pendente) é decidido uma única vez no BKO; cliente do ERP
 * não passa por aqui. Função pura; a API revalida.
 */
export interface ClienteParaDecisao {
  origem_cadastro: 'erp' | 'campo' | 'bko';
  status_cadastro: 'pendente' | 'aprovado' | 'recusado' | null;
}
export type DecisaoCadastro = 'aprovar' | 'recusar';
export type ResultadoDecisaoCadastro =
  | { ok: true; status: 'aprovado' | 'recusado' }
  | { ok: false; codigo: 'CADASTRO_JA_DECIDIDO' | 'CLIENTE_DO_ERP' };

export function decidirCadastro(cliente: ClienteParaDecisao, decisao: DecisaoCadastro): ResultadoDecisaoCadastro {
  if (cliente.origem_cadastro === 'erp') return { ok: false, codigo: 'CLIENTE_DO_ERP' };
  if (cliente.status_cadastro !== 'pendente') return { ok: false, codigo: 'CADASTRO_JA_DECIDIDO' };
  return { ok: true, status: decisao === 'aprovar' ? 'aprovado' : 'recusado' };
}
