/**
 * Gravação dos clientes positivados do dia no read-model `core.indicador_diario` (RN-CORE-20/26; migração 0023; T-0073).
 * O consumidor que apura o dia chama `gravarPositivadosDoDia` na transação do tenant, com a lista vinda de `positivadosDoDia`
 * (domain): lista e contagem entram juntas (CHECK `indicador_diario_clientes_positivados_ids_coerente`). Só ids de clientes do
 * próprio tenant; id de outro tenant ou inexistente é descartado aqui. Cancelamento: recalcular o dia e chamar de novo.
 * Idempotente: repetir a mesma lista não muda a linha (updated_at só muda quando muda, o pull recebe só o que mudou).
 */
import type { ClienteBanco } from '@macuxi/platform-sdk';

export interface PositivadosDoDia {
  usuarioId: string;
  /** AAAA-MM-DD no fuso do tenant. */
  dia: string;
  clienteIds: readonly string[];
}

/** Devolve a contagem gravada (clientes distintos do próprio tenant). Cria a linha do dia se ainda não existe. */
export async function gravarPositivadosDoDia(db: ClienteBanco, p: PositivadosDoDia): Promise<number> {
  const r = await db.query<{ clientes_positivados: number }>(
    `with ids as (
       select coalesce(array_agg(c.id order by c.id), '{}'::uuid[]) as lista
         from core.cliente c
        where c.tenant_id = plataforma.tenant_atual() and c.deleted_at is null and c.id = any($3::uuid[])
     )
     insert into core.indicador_diario (tenant_id, usuario_id, data, clientes_positivados, clientes_positivados_ids)
     select plataforma.tenant_atual(), $1, $2::date, cardinality(ids.lista), ids.lista from ids
     on conflict (tenant_id, usuario_id, data) where deleted_at is null do update
       set clientes_positivados = excluded.clientes_positivados, clientes_positivados_ids = excluded.clientes_positivados_ids
       where core.indicador_diario.clientes_positivados_ids is distinct from excluded.clientes_positivados_ids
     returning clientes_positivados`,
    [p.usuarioId, p.dia, [...new Set(p.clienteIds)]],
  );
  if (r.rows[0]) return r.rows[0].clientes_positivados;
  const atual = await db.query<{ clientes_positivados: number }>('select clientes_positivados from core.indicador_diario where tenant_id = plataforma.tenant_atual() and usuario_id = $1 and data = $2::date and deleted_at is null', [p.usuarioId, p.dia]);
  return atual.rows[0]?.clientes_positivados ?? 0;
}
