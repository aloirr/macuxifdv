/**
 * RN-CORE-59 (T-0175): a coluna `core.usuario.codigo_fdv` ainda não existe (a migração é do banco-dados). Enquanto esta constante for
 * `false`, a leitura devolve `null` e a busca ignora o código; virar `true` no PR da migração. Não há outro padrão no repositório
 * para coluna aguardando migração, por isso a constante.
 */
export const COLUNA_CODIGO_FDV_PRONTA = false;

/** Expressão SQL do Código FDV de `core.usuario` (alias `u` por padrão). */
export const sqlCodigoFdv = (alias = 'u'): string => (COLUNA_CODIGO_FDV_PRONTA ? `${alias}.codigo_fdv` : 'null::text');
