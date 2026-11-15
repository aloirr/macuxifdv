/**
 * `integracao.nota.atualizado@1` -> `core.nota_erp` e `core.historico_compra` (histórico de compra do Cliente 360; T-0066;
 * RN-INT-02/04). Upsert por `external_id` (idempotente); nota inativada = `deleted_at`. Cliente ausente = `ReferenciaAusenteErp`
 * (a outbox repete, sem órfão). O `ano_mes` é calculado no fuso do tenant. Depois de gravar, recalcula o consolidado mensal do
 * mês novo e do mês/cliente antigos (a nota pode mudar de mês ou de cliente): valor = faturamento menos devolução das notas
 * vivas e não canceladas; pedidos/itens/última compra contam só faturamento. Log sem dado pessoal (só contagens).
 */
import { definirConsumidor, eventoTolerante } from '@macuxi/platform-sdk';
import { dataLocal } from '../domain';
import { clientePorExternalId, ReferenciaAusenteErp, usuarioPorExternalId } from './erp-apoio';
import { EVENTO_ERP_NOTA_ATUALIZADO } from '../../integracao/contracts';
export const EventoIntegracaoNotaAtualizado = eventoTolerante(EVENTO_ERP_NOTA_ATUALIZADO);
/** Recalcula o consolidado mensal do cliente a partir das notas vivas (sem notas = linha do ERP removida). */
export async function recalcularHistoricoCompra(db, clienteId, anoMes, fuso) {
    const r = await db.query(`select coalesce(sum(case tipo when 'faturamento' then total_cents else -total_cents end), 0)::text as valor,
            count(*) filter (where tipo = 'faturamento')::int as pedidos,
            coalesce(sum(quantidade_itens) filter (where tipo = 'faturamento'), 0)::int as itens,
            to_char(max((emitida_em at time zone $3)::date) filter (where tipo = 'faturamento'), 'YYYY-MM-DD') as ultima,
            count(*)::int as total
       from core.nota_erp where cliente_id = $1 and ano_mes = $2 and not cancelada and deleted_at is null`, [clienteId, anoMes, fuso]);
    const l = r.rows[0];
    if (l.total === 0) {
        await db.query("update core.historico_compra set deleted_at = now() where cliente_id = $1 and ano_mes = $2 and origem = 'erp' and deleted_at is null", [clienteId, anoMes]);
        return;
    }
    const valor = Math.max(0, Number(l.valor));
    await db.query(`insert into core.historico_compra (tenant_id, cliente_id, ano_mes, valor_cents, pedidos, itens, ultima_compra_em, origem)
     values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6::date, 'erp')
     on conflict (tenant_id, cliente_id, ano_mes) where deleted_at is null
     do update set valor_cents = excluded.valor_cents, pedidos = excluded.pedidos, itens = excluded.itens, ultima_compra_em = excluded.ultima_compra_em, origem = 'erp'`, [clienteId, anoMes, valor, l.pedidos, l.itens, l.ultima]);
}
export const consumidorNotaDoErp = definirConsumidor({
    evento: EventoIntegracaoNotaAtualizado,
    async executar(p, ctx) {
        const r = p.registro;
        const fuso = ctx.fuso();
        const anterior = (await ctx.db.query('select cliente_id, ano_mes from core.nota_erp where external_id = $1 and deleted_at is null', [p.external_id])).rows[0];
        if (p.acao === 'inativado' || !r || r.ativo === false) {
            if (!anterior)
                return;
            await ctx.db.query('update core.nota_erp set deleted_at = $2 where external_id = $1 and deleted_at is null', [p.external_id, ctx.agora()]);
            await recalcularHistoricoCompra(ctx.db, anterior.cliente_id, anterior.ano_mes, fuso);
            return;
        }
        const clienteId = await clientePorExternalId(ctx.db, r.cliente_external_id);
        if (!clienteId)
            throw new ReferenciaAusenteErp('cliente');
        const anoMes = dataLocal(r.emitida_em, fuso).slice(0, 7);
        // RN-CORE-27 (T-0080): vendedor da nota. Ausente/desconhecido NÃO é erro: usuario_id fica nulo e o consumidor do vendedor completa depois.
        const vendedorExt = r.vendedor_external_id?.trim() || null;
        const usuarioId = vendedorExt ? await usuarioPorExternalId(ctx.db, vendedorExt) : null;
        await ctx.db.query(`insert into core.nota_erp (tenant_id, external_id, cliente_id, tipo, numero, serie, emitida_em, ano_mes, total_cents, quantidade_itens, pedido_uuid, cancelada, vendedor_external_id, usuario_id)
       values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6::timestamptz, $7, $8, $9, $10, $11, $12, $13)
       on conflict (tenant_id, external_id) where deleted_at is null
       do update set cliente_id = excluded.cliente_id, tipo = excluded.tipo, numero = excluded.numero, serie = excluded.serie, emitida_em = excluded.emitida_em,
                     ano_mes = excluded.ano_mes, total_cents = excluded.total_cents, quantidade_itens = excluded.quantidade_itens,
                     pedido_uuid = excluded.pedido_uuid, cancelada = excluded.cancelada,
                     vendedor_external_id = excluded.vendedor_external_id, usuario_id = excluded.usuario_id`, [r.external_id, clienteId, r.tipo, r.numero.trim(), r.serie?.trim() || null, r.emitida_em, anoMes, r.total_cents, r.quantidade_itens ?? 0, r.pedido_uuid ?? null, r.cancelada ?? false, vendedorExt, usuarioId]);
        await recalcularHistoricoCompra(ctx.db, clienteId, anoMes, fuso);
        if (anterior && (anterior.cliente_id !== clienteId || anterior.ano_mes !== anoMes))
            await recalcularHistoricoCompra(ctx.db, anterior.cliente_id, anterior.ano_mes, fuso);
    },
});
