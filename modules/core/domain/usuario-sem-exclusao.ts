/**
 * RN-CORE-60 (T-0175): usuário nunca é excluído, só inativado (`ativo = false`); nada no módulo grava `deleted_at` em `core.usuario`.
 * Única exceção: a exclusão da empresa inteira (RN-PLA-09/10, `plataforma.excluir_tenant`), depois da inativação e do backup.
 * O vínculo do ERP (RN-CORE-58) inativa o provisório e limpa o `external_id`, então o código fica só no real. Funções puras.
 */

/** 422 devolvido por qualquer pedido de excluir usuário (hoje não há rota DELETE; o código vale para quem a criar). */
export const CODIGO_USUARIO_NAO_EXCLUI = 'USUARIO_NAO_EXCLUI';

/** Provisório já vinculado: inativo e sem código ERP. `deleted_at` só aparece em vínculo feito antes da RN-CORE-60. */
export function provisorioJaVinculado(u: { ativo: boolean; external_id: string | null; deleted_at: string | null }): boolean {
  return u.deleted_at !== null || (!u.ativo && u.external_id === null);
}
