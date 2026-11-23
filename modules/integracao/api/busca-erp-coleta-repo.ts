/**
 * SQL da coleta (`integracao.coleta_execucao`) e do pedido na fila, compartilhado pela tarefa `agendar_coletas`, pelo trabalho
 * `coletar_erp` e pelas rotas "Buscar agora" e "Recarregar". Nada aqui lê o segredo nem a resposta do ERP.
 */
import { randomUUID } from 'node:crypto';
import type { ClienteBanco, TransacaoTenant } from '@macuxi/platform-sdk';
import { EVENTO_COLETA_SOLICITADA, EVENTO_ENTREGA_PEDIDO_SOLICITADA, type Entidade, type ModoCarga, type OrigemColeta } from '../contracts';
import type { EstadoColetaEntidade } from '../domain';

type Publicar = Pick<TransacaoTenant, 'publicar'>['publicar'];

/** Pede uma coleta (linha `solicitada` + evento). `null` = já existe uma coleta viva desta entidade (ou o Conector está coletando outra). */
export async function solicitarColeta(
  db: ClienteBanco,
  publicar: Publicar,
  e: { tenantId: string; conectorId: string; entidade: Entidade; modo: ModoCarga; origem: OrigemColeta; solicitadoPor: string | null; agora: Date },
): Promise<string | null> {
  const id = randomUUID();
  const { rows } = await db.query<{ id: string }>(
    `insert into integracao.coleta_execucao (id, tenant_id, conector_id, entidade, modo, origem, solicitada_em)
     values ($1, $2, $3, $4, $5, $6, $7) on conflict do nothing returning id`,
    [id, e.tenantId, e.conectorId, e.entidade, e.modo, e.origem, e.agora.toISOString()],
  );
  if (rows.length === 0) return null;
  await publicar(
    EVENTO_COLETA_SOLICITADA,
    { coleta_id: id, conector_id: e.conectorId, entidade: e.entidade, modo: e.modo, origem: e.origem, solicitado_por: e.solicitadoPor, solicitado_em: e.agora.toISOString() },
    id,
  );
  return id;
}

/** Estado de cada entidade do Conector para o plano (`planejarColetas`): viva, última pedida e última completa concluída. */
export async function lerEstadosColeta(db: ClienteBanco, tenantId: string, conectorId: string): Promise<Partial<Record<Entidade, EstadoColetaEntidade>>> {
  const { rows } = await db.query<{ entidade: Entidade; viva: boolean; ultima: Date | null; ultima_completa: Date | null }>(
    `select entidade,
            bool_or(estado in ('solicitada', 'executando')) as viva,
            max(solicitada_em) as ultima,
            max(concluida_em) filter (where modo = 'completo' and estado = 'concluida') as ultima_completa
       from integracao.coleta_execucao
      where tenant_id = $1 and conector_id = $2 and deleted_at is null
      group by entidade`,
    [tenantId, conectorId],
  );
  const mapa: Partial<Record<Entidade, EstadoColetaEntidade>> = {};
  for (const r of rows) mapa[r.entidade] = { viva: r.viva, ultimaSolicitadaEm: r.ultima ? r.ultima.toISOString() : null, ultimaCompletaConcluidaEm: r.ultima_completa ? r.ultima_completa.toISOString() : null };
  return mapa;
}

/** RN-INT-20: a credencial foi trocada (e testada): as coletas voltam. */
export async function liberarColetas(db: ClienteBanco, tenantId: string, conectorId: string): Promise<void> {
  await db.query('update integracao.conector_api set coletas_paradas_em = null where tenant_id = $1 and conector_id = $2 and deleted_at is null', [tenantId, conectorId]);
}

/** RN-INT-20: o ERP recusou a credencial (401/403): as coletas param até trocar. Não sobrescreve a data da primeira recusa. */
export async function pararColetas(db: ClienteBanco, tenantId: string, conectorId: string, agora: Date): Promise<void> {
  await db.query('update integracao.conector_api set coletas_paradas_em = $3 where tenant_id = $1 and conector_id = $2 and deleted_at is null and coletas_paradas_em is null', [tenantId, conectorId, agora.toISOString()]);
}

/** Pede a entrega (pela API) de cada pedido ainda sem retorno na fila, para depois de trocar a credencial. No máximo `limite`. */
export async function pedirEntregaDosPedidosPendentes(db: ClienteBanco, publicar: Publicar, e: { tenantId: string; conectorId: string; agora: Date; limite: number }): Promise<number> {
  const { rows } = await db.query<{ pedido_uuid: string }>(
    `select pedido_uuid from integracao.pedido_fila_erp
      where tenant_id = $1 and deleted_at is null and retencao_codigo is null and payload is not null and estado in ('pendente', 'enviado')
      order by aprovado_em, pedido_uuid limit $2`,
    [e.tenantId, e.limite],
  );
  for (const p of rows) {
    await publicar(EVENTO_ENTREGA_PEDIDO_SOLICITADA, { entrega_id: randomUUID(), pedido_uuid: p.pedido_uuid, conector_id: e.conectorId, solicitado_em: e.agora.toISOString() }, p.pedido_uuid);
  }
  return rows.length;
}

/** Pede a entrega de UM pedido (aprovado agora). */
export async function pedirEntregaDoPedido(publicar: Publicar, e: { pedidoUuid: string; conectorId: string; agora: Date }): Promise<void> {
  await publicar(EVENTO_ENTREGA_PEDIDO_SOLICITADA, { entrega_id: randomUUID(), pedido_uuid: e.pedidoUuid, conector_id: e.conectorId, solicitado_em: e.agora.toISOString() }, e.pedidoUuid);
}
