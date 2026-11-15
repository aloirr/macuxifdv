const SQL_LER = "select modulo, chave, valor from plataforma.parametro where tenant_id = plataforma.tenant_atual() and modulo = 'core' and chave = any($1::text[]) and deleted_at is null";
const SQL_GRAVAR = `insert into plataforma.parametro (tenant_id, modulo, chave, valor) values (plataforma.tenant_atual(), 'core', $1, $2::jsonb)
  on conflict (tenant_id, modulo, chave) where deleted_at is null do update set valor = excluded.valor
    where plataforma.parametro.valor is distinct from excluded.valor`;
/** As linhas vivas das chaves pedidas (as que não existem não vêm). */
export async function lerParametrosCore(db, chaves) {
    return (await db.query(SQL_LER, [[...chaves]])).rows;
}
/** A linha viva de uma chave, em lista (formato das funções `...DasLinhas`). */
export const lerParametroCore = (db, chave) => lerParametrosCore(db, [chave]);
/** Grava o valor (JSON); idempotente: valor igual não muda a linha. */
export async function gravarParametroCore(db, chave, valor) {
    await db.query(SQL_GRAVAR, [chave, JSON.stringify(valor)]);
}
