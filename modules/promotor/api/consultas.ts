/**
 * Consulta `promotor.concorrentes@1` na API (ADR 0012; ADR 0027 revisada). Só SQL em `promotor.concorrente`, na transação de
 * quem consulta (RLS do tenant); somente leitura, sem evento. Registros apagados (`deleted_at`) nunca aparecem.
 */
import { implementarConsulta } from '@macuxi/platform-sdk';
import { CONSULTA_CONCORRENTES } from '../contracts';

interface LinhaConcorrente {
  id: string;
  nome: string;
  ativo: boolean;
  external_id: string | null;
}

/** Escapa `%`, `_` e `\` para o LIKE do trecho de nome. */
const escaparLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export const consultaConcorrentes = implementarConsulta(CONSULTA_CONCORRENTES, async (entrada, ctx) => {
  if (entrada.ids && entrada.ids.length === 0) return { concorrentes: [] };
  const where = ['deleted_at is null'];
  const params: unknown[] = [];
  if (!entrada.incluir_inativos) where.push('ativo');
  if (entrada.ids) {
    params.push(entrada.ids);
    where.push(`id = any($${params.length}::uuid[])`);
  }
  if (entrada.busca) {
    params.push(`%${escaparLike(entrada.busca)}%`);
    where.push(`nome ilike $${params.length}`);
  }
  const r = await ctx.db.query(
    `select id, nome, ativo, external_id from promotor.concorrente where ${where.join(' and ')} order by lower(nome), id limit 2000`,
    params,
  );
  return { concorrentes: (r.rows as unknown as LinhaConcorrente[]).map((x) => ({ id: x.id, nome: x.nome, ativo: x.ativo, external_id: x.external_id })) };
});
