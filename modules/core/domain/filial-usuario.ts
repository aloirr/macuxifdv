/**
 * Filial do usuário (T-0176; RN-CORE-39 revista). Funções puras. O "vendedor" é o CARGO do perfil (a régua da migração 0069),
 * não `core.usuario.perfil`. O máximo de 1 filial do vendedor também é do banco (0077); o mínimo é só daqui e da API.
 */
import type { Cargo } from '@macuxi/platform-sdk';
import { CODIGOS_FILIAL_USUARIO, MENSAGEM_AO_MENOS_UMA_FILIAL, MENSAGEM_FILIAL_DO_VENDEDOR, PERFIS_QUE_EDITAM_FILIAL } from '../contracts/filial-usuario';

export interface ErroFilialUsuario {
  codigo: typeof CODIGOS_FILIAL_USUARIO.quantidade;
  mensagem: string;
}

/** RN-CORE-39: vendedor exatamente 1; supervisor, promotor e gerente 1 ou mais; administrativo (admin, analista) 0 ou mais. Repetidas contam uma vez. */
export function validarFiliaisDoUsuario(cargo: Cargo | null | undefined, filiais: readonly string[]): ErroFilialUsuario | null {
  const n = new Set(filiais).size;
  const erro = (mensagem: string): ErroFilialUsuario => ({ codigo: CODIGOS_FILIAL_USUARIO.quantidade, mensagem });
  if (cargo === 'vendedor') return n === 1 ? null : erro(MENSAGEM_FILIAL_DO_VENDEDOR);
  if (cargo === 'supervisor' || cargo === 'promotor' || cargo === 'gerente') return n >= 1 ? null : erro(MENSAGEM_AO_MENOS_UMA_FILIAL);
  return null;
}

/** Filiais pedidas que não estão entre as existentes (vivas e do tenant, lidas pela API sob RLS). */
export function filiaisInexistentes(pedidas: readonly string[], existentes: readonly string[]): string[] {
  const vivas = new Set(existentes);
  return [...new Set(pedidas)].filter((id) => !vivas.has(id));
}

/** RN-CORE-39 (R-20261115-080000): o vendedor sem filial não usa o app até a carga do ERP ou o BKO informar a filial. */
export function vendedorBloqueadoPorFilial(u: { cargo: Cargo | null | undefined; filiais: readonly string[] }): boolean {
  return u.cargo === 'vendedor' && u.filiais.length === 0;
}

/** Só admin e analista informam ou trocam a filial do usuário. */
export const perfilEditaFilial = (perfil: string): boolean => (PERFIS_QUE_EDITAM_FILIAL as readonly string[]).includes(perfil);
