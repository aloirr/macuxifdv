/**
 * 0088 (T-0184, RN-VEN-30): aprovações por motivo dos pedidos dos seeds (demo e Fase M). Todo pedido do seed em
 * `pending_approval` ganha, no ciclo 1, uma linha `pendente` por motivo de `motivos_aprovacao` (vazio = `desconto`), com
 * `nivel = nivel_aprovacao` e `texto_pendencia` vazio — a mesma regra e o mesmo id do backfill da 0088
 * (`idAprovacaoDoBackfill`). Sem elas, aprovar o pedido do seed dá 422. Banco sem a 0088 = nada.
 */
import type { ClientBase } from 'pg';
import { gravarLinhas, type Linha } from '../src/gravar';
import { idAprovacaoDoBackfill } from '../src/ids';

/** Motivos do pedido: a coluna vem como o literal `{a,b}` de `arrayDeTexto` (ou array); vazio = `desconto`. */
function motivosDoPedido(p: Linha): string[] {
  const v = p.motivos_aprovacao;
  const lista = Array.isArray(v) ? v.map(String) : String(v ?? '{}').replace(/^\{|\}$/g, '').split(',').filter(Boolean);
  return lista.length > 0 ? lista : ['desconto'];
}

/** As linhas `pendente` do ciclo 1 dos pedidos vivos em `pending_approval` (os demais não ganham linha). */
export function aprovacoesDosPedidos(pedidos: readonly Linha[]): Linha[] {
  return pedidos
    .filter((p) => p.status === 'pending_approval' && p.deleted_at == null)
    .flatMap((p) =>
      motivosDoPedido(p).map((motivo) => ({
        id: idAprovacaoDoBackfill(String(p.tenant_id), String(p.id), motivo), tenant_id: p.tenant_id, pedido_id: p.id, ciclo: 1, motivo,
        nivel: p.nivel_aprovacao, estado: 'pendente', texto_pendencia: '', decidida_por: null, decidida_em: null, texto_decisao: null,
        deleted_at: null, external_id: null,
      })),
    );
}

/**
 * Grava as aprovações dos pedidos do seed, depois de `vendedor.pedido`. A recarga devolve o pedido ao status do seed; as
 * aprovações acompanham: as de outro id dos pedidos do seed (decisões e ciclos do ensaio, ou de um pedido que saiu de
 * `pending_approval`) são apagadas, o ciclo do pedido volta a 1 e as do seed voltam a `pendente` (upsert por id).
 */
export async function gravarAprovacoesDosPedidos(admin: ClientBase, tenantId: string, pedidos: readonly Linha[]): Promise<void> {
  const existe = await admin.query<{ ok: boolean }>("select to_regclass('vendedor.pedido_aprovacao') is not null as ok");
  if (!existe.rows[0]?.ok) return;
  const linhas = aprovacoesDosPedidos(pedidos);
  const ids = pedidos.map((p) => p.id);
  await admin.query('delete from vendedor.pedido_aprovacao where tenant_id = $1 and pedido_id = any($2::uuid[]) and id <> all($3::uuid[])', [
    tenantId,
    ids,
    linhas.map((l) => l.id),
  ]);
  await admin.query('update vendedor.pedido set aprovacao_ciclo = 1 where tenant_id = $1 and id = any($2::uuid[]) and aprovacao_ciclo <> 1', [tenantId, ids]);
  await gravarLinhas(admin, 'vendedor.pedido_aprovacao', linhas);
}
