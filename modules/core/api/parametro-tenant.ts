/**
 * Leitura e gravação de uma chave de `plataforma.parametro` do módulo `core`, do tenant da transação (RLS). Uma cópia só do SQL
 * (T-0180, RD-0339): os parâmetros de Início, Jornada e Alertas usam estas funções. Quem chama audita (RN-AUD-01).
 */
import type { ClienteBanco } from '@macuxi/platform-sdk';

export type LinhaParametro = { modulo: string; chave: string; valor: unknown };

const SQL_LER = "select modulo, chave, valor from plataforma.parametro where tenant_id = plataforma.tenant_atual() and modulo = 'core' and chave = any($1::text[]) and deleted_at is null";
const SQL_GRAVAR = `insert into plataforma.parametro (tenant_id, modulo, chave, valor) values (plataforma.tenant_atual(), 'core', $1, $2::jsonb)
  on conflict (tenant_id, modulo, chave) where deleted_at is null do update set valor = excluded.valor
    where plataforma.parametro.valor is distinct from excluded.valor`;

/** As linhas vivas das chaves pedidas (as que não existem não vêm). */
export async function lerParametrosCore(db: ClienteBanco, chaves: readonly string[]): Promise<LinhaParametro[]> {
  return (await db.query<LinhaParametro>(SQL_LER, [[...chaves]])).rows;
}

/** A linha viva de uma chave, em lista (formato das funções `...DasLinhas`). */
export const lerParametroCore = (db: ClienteBanco, chave: string): Promise<LinhaParametro[]> => lerParametrosCore(db, [chave]);

/** Grava o valor (JSON); idempotente: valor igual não muda a linha. */
export async function gravarParametroCore(db: ClienteBanco, chave: string, valor: unknown): Promise<void> {
  await db.query(SQL_GRAVAR, [chave, JSON.stringify(valor)]);
}
