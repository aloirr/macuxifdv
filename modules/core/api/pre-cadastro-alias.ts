/**
 * Alias do pré-cadastro (ADR 0069 §4; RN-CORE-78): o recusado substituído pelo `id` novo do APK v1.0.28 resolve para o cliente vivo pelo
 * `cliente_id_original` das tentativas herdadas. Usado pelas rotas do BKO e pelo consumidor do retorno do ERP (arquivo próprio: o
 * consumidor não importa as rotas).
 */
import { type ClienteBanco } from '@macuxi/platform-sdk';

/** Id do pré-cadastro vivo: o próprio ou, se for um recusado substituído (APK v1.0.28), o que o substituiu (alias). */
export async function resolverPreCadastro(db: ClienteBanco, id: string): Promise<string | null> {
  const vivo = (await db.query('select 1 from core.cliente where id = $1 and deleted_at is null and revisao_cadastro is not null', [id])).rows[0];
  if (vivo) return id;
  const alias = (
    await db.query<{ cliente_id: string }>(
      `select t.cliente_id from core.cliente_pre_cadastro_tentativa t join core.cliente c on c.id = t.cliente_id and c.deleted_at is null
        where t.cliente_id_original = $1 order by t.revisao desc limit 1`,
      [id],
    )
  ).rows[0];
  return alias?.cliente_id ?? null;
}
