/**
 * Positivação do mês (RN-CORE-20/26; T-0073): grava `core.indicador_diario.clientes_positivados(_ids)` a partir do evento do Vendedor.
 * Evento: `vendedor.pedido.status_alterado@1` (leitura tolerante, T-0024, consumido em consumidores-pedido.ts). PREMISSA: positivado = pedido aprovado, integrado ou faturado
 * com data de emissão no dia (RN-CORE-20), então qualquer transição que MUDA essa condição (aprovado, enviado/integrado ao ERP,
 * faturado, cancelado, rejeitado) dispara a apuração. O payload não traz cliente nem emissão e o Core não lê `vendedor.*`:
 * a apuração usa a consulta opcional `vendedor.pedidos_da_meta@1` (mesma fonte da meta) e RECALCULA os dias do mês do vendedor
 * (mês do evento e o anterior, porque emissão e aprovação podem cair em meses diferentes). Recalcular = idempotente: o mesmo evento duas
 * vezes, ou cliente repetido no dia, não conta duas vezes; cancelamento zera o dia. Vendedor desligado/não instalado = não faz nada.
 */
import { ConsultaIndisponivel } from '@macuxi/platform-sdk';
import { dataLocal, positivadosPorDia } from '../domain';
import { gravarPositivadosDoDia } from './indicador-diario';
import { CONSULTA_PEDIDOS_DA_META } from './metas';
/** Transições que podem entrar ou sair da positivação (os demais status não mudam a conta). */
export const STATUS_QUE_MUDAM_POSITIVACAO = ['aprovado', 'enviado_erp', 'integrado_erp', 'faturado_parcial', 'faturado_total', 'cancelado', 'rejeitado'];
const mesAnterior = (periodo) => {
    const [a, m] = periodo.split('-').map(Number);
    return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
};
/** Recalcula e grava os dias de `periodo` (AAAA-MM) do vendedor. Devolve quantos dias foram regravados. */
export async function regravarPositivacaoDoMes(ctx, o) {
    const db = ctx.db;
    let fonte;
    try {
        fonte = await ctx.consultar(CONSULTA_PEDIDOS_DA_META, { usuario_ids: [o.usuarioId], periodo: o.periodo });
    }
    catch (e) {
        if (e instanceof ConsultaIndisponivel)
            return 0;
        throw e;
    }
    const gravados = await db.query("select data::text as dia from core.indicador_diario where tenant_id = plataforma.tenant_atual() and usuario_id = $1 and deleted_at is null and clientes_positivados > 0 and to_char(data, 'YYYY-MM') = $2", [o.usuarioId, o.periodo]);
    const dias = positivadosPorDia(fonte.pedidos, { usuario_id: o.usuarioId, periodo: o.periodo, fuso: o.fuso, diasGravados: gravados.rows.map((l) => l.dia) });
    for (const d of dias)
        await gravarPositivadosDoDia(db, { usuarioId: o.usuarioId, dia: d.dia, clienteIds: d.clientes_positivados_ids });
    return dias.length;
}
/**
 * Apuração disparada pelo status do pedido. Chamada por `consumidorPedidoStatus` (consumidores-pedido.ts): o SDK aceita um consumidor
 * por evento e módulo, então a notificação (RN-CORE-23) e a positivação (RN-CORE-20/26) rodam no mesmo consumo, na mesma transação.
 */
export async function apurarPositivacaoDoStatus(p, ctx) {
    if (!STATUS_QUE_MUDAM_POSITIVACAO.includes(p.para))
        return;
    const fuso = ctx.fuso();
    const periodo = dataLocal(p.alterado_em, fuso).slice(0, 7);
    for (const mes of [periodo, mesAnterior(periodo)])
        await regravarPositivacaoDoMes(ctx, { usuarioId: p.vendedor_id, periodo: mes, fuso });
}
