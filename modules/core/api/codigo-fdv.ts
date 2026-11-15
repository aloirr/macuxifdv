/**
 * RN-CORE-59 (T-0175): a coluna `core.usuario.codigo_fdv` existe desde a migração 0080; com `true` a leitura, a busca e o sync
 * usam a coluna. `false` volta ao modo sem coluna (`null`).
 */
export const COLUNA_CODIGO_FDV_PRONTA = true;

/** Expressão SQL do Código FDV de `core.usuario` (alias `u` por padrão). */
export const sqlCodigoFdv = (alias = 'u'): string => (COLUNA_CODIGO_FDV_PRONTA ? `${alias}.codigo_fdv` : 'null::text');
