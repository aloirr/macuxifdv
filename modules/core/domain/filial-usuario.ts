/**
 * Filial do usuário (T-0176; RN-CORE-39 revista, R-20261115-093000/094500). Funções puras.
 * Filial de CADASTRO: obrigatória em qualquer perfil (nula = bloqueado). Filiais de VENDA: no mínimo 1, sempre com a de cadastro,
 * sem limite por cargo.
 */
import { CODIGOS_FILIAL_USUARIO, MENSAGEM_FILIAL_CADASTRO_OBRIGATORIA, MENSAGEM_FILIAL_VENDA_SEM_CADASTRO, MENSAGEM_FILIAL_VENDA_VAZIA, PERFIS_QUE_EDITAM_FILIAL } from '../contracts/filial-usuario';

export interface ErroFilialUsuario {
  codigo: (typeof CODIGOS_FILIAL_USUARIO)['cadastroObrigatoria' | 'vendaVazia' | 'vendaSemCadastro'];
  mensagem: string;
}

/** RN-CORE-39: cadastro obrigatória; venda com no mínimo 1 filial e contendo a de cadastro. Repetidas contam uma vez. */
export function validarFiliaisDoUsuario(f: { cadastro: string | null | undefined; venda: readonly string[] }): ErroFilialUsuario | null {
  if (!f.cadastro) return { codigo: CODIGOS_FILIAL_USUARIO.cadastroObrigatoria, mensagem: MENSAGEM_FILIAL_CADASTRO_OBRIGATORIA };
  if (new Set(f.venda).size === 0) return { codigo: CODIGOS_FILIAL_USUARIO.vendaVazia, mensagem: MENSAGEM_FILIAL_VENDA_VAZIA };
  if (!f.venda.includes(f.cadastro)) return { codigo: CODIGOS_FILIAL_USUARIO.vendaSemCadastro, mensagem: MENSAGEM_FILIAL_VENDA_SEM_CADASTRO };
  return null;
}

/** RN-CORE-39: a lista de venda da gravação = a de cadastro (primeiro) mais as pedidas, sem repetir. */
export function filiaisDeVendaComCadastro(cadastro: string | null | undefined, venda: readonly string[]): string[] {
  return [...new Set([...(cadastro ? [cadastro] : []), ...venda])];
}

/** Filiais pedidas que não estão entre as existentes (vivas e do tenant, lidas pela API sob RLS). */
export function filiaisInexistentes(pedidas: readonly string[], existentes: readonly string[]): string[] {
  const vivas = new Set(existentes);
  return [...new Set(pedidas)].filter((id) => !vivas.has(id));
}

/** RN-CORE-39: sem filial de cadastro o usuário (de qualquer perfil) não usa o app nem as rotas de dados. */
export function usuarioBloqueadoPorFilial(u: { filial_cadastro_id: string | null | undefined }): boolean {
  return !u.filial_cadastro_id;
}

/** Só admin e analista informam ou trocam a filial do usuário (e a própria, se estiverem bloqueados). */
export const perfilEditaFilial = (perfil: string): boolean => (PERFIS_QUE_EDITAM_FILIAL as readonly string[]).includes(perfil);
