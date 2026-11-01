/** Consultas do Core a outros módulos (ADR 0012). SQL só em `core.*`, na transação de quem chama (RLS do tenant). */
import { implementarConsulta } from '@macuxi/platform-sdk';
import { CONSULTA_CADASTRO_RESUMO, type CadastroResumoSaida } from '../contracts';

export const consultaCadastroResumo = implementarConsulta(CONSULTA_CADASTRO_RESUMO, async (entrada, ctx): Promise<CadastroResumoSaida> => {
  // Sequencial: um único cliente de banco na transação.
  const lista = async (ids: string[], sql: string) => (ids.length === 0 ? [] : (await ctx.db.query(sql, [ids])).rows);
  const clientes = await lista(
    entrada.cliente_ids,
    'select id, razao_social, nome_fantasia, documento, logradouro, numero, bairro, cidade, uf, ativo, external_id from core.cliente where deleted_at is null and id = any($1::uuid[]) order by id',
  );
  const produtos = await lista(entrada.produto_ids, 'select id, sku, nome, unidade, ativo, external_id from core.produto where deleted_at is null and id = any($1::uuid[]) order by id');
  const usuarios = await lista(entrada.usuario_ids, 'select id, nome, perfil, external_id from core.usuario where deleted_at is null and id = any($1::uuid[]) order by id');
  return { clientes, produtos, usuarios } as CadastroResumoSaida;
});
