/**
 * Consulta `catalogo.marcas@1` na API (T-0113, ADR 0034, RN-CAT-13): marcas concorrentes do tenant, ordenadas por `lower(nome), id`,
 * até 2000; apagada nunca sai; `ids` inexistentes não são erro; inativas só com `incluir_inativas`. Só SQL em `catalogo.*`, na
 * transação de quem consulta (RLS do tenant).
 */
import { implementarConsulta } from '@macuxi/platform-sdk';
import { CONSULTA_MARCAS } from '../contracts';

const escaparLike = (t: string) => t.replace(/[\\%_]/g, (c) => `\\${c}`);

export const consultaMarcas = implementarConsulta(CONSULTA_MARCAS, async (entrada, ctx) => {
  const valores: unknown[] = [entrada.incluir_inativas];
  let filtro = '';
  if (entrada.ids) {
    valores.push(entrada.ids);
    filtro += ` and id = any($${valores.length}::uuid[])`;
  }
  if (entrada.busca) {
    valores.push(`%${escaparLike(entrada.busca)}%`);
    filtro += ` and nome ilike $${valores.length}`;
  }
  const r = await ctx.db.query(
    `select id, nome, ativo, external_id from catalogo.marca_concorrente
      where deleted_at is null and ($1::boolean or ativo)${filtro} order by lower(nome), id limit 2000`,
    valores,
  );
  return { marcas: r.rows as unknown as { id: string; nome: string; ativo: boolean; external_id: string | null }[] };
});
