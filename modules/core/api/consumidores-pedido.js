/**
 * Notificações de pedido (RN-CORE-23 item 3; RF-CORE-09). Consome os eventos públicos do Vendedor
 * (`vendedor.pedido.status_alterado@1` e `vendedor.pedido.aprovacao_solicitada@1`; definições do `contracts` do Vendedor, leitura tolerante, T-0024), gera UMA notificação por
 * destinatário em `core.notificacao` e publica `core.notificacao.criada@1` (o consumidor de `consumidores.ts` envia o
 * push com `data.link` e `data.entidades`). Idempotente: `envio_id` = id do evento, único por destinatário
 * (reentrega não repete). Destinatários: o vendedor do pedido; para "para aprovar", os responsáveis das equipes acima
 * dele (supervisor, gerente...) e, sem ninguém, os usuários de perfil gerente/analista/admin do tenant.
 * O texto não leva dado pessoal.
 */
import { definirConsumidor, eventoTolerante } from '@macuxi/platform-sdk';
import { EVENTO_NOTIFICACAO_CRIADA } from '../contracts';
import { EVENTO_PEDIDO_APROVACAO_SOLICITADA, EVENTO_PEDIDO_STATUS_ALTERADO } from '../../vendedor/contracts';
import { apurarPositivacaoDoStatus } from './consumidores-positivacao';
import { notificacaoDePedido } from '../domain';
/** Responsáveis (ativos) das equipes acima do vendedor; sem equipe/responsável, os perfis de alçada do tenant. */
async function aprovadoresDe(ctx, vendedorId) {
    const r = await ctx.db.query(`with recursive acima as (
       select e.id, e.equipe_pai_id, e.responsavel_id from core.equipe e join core.usuario v on v.equipe_id = e.id
        where v.id = $1 and e.deleted_at is null
       union
       select p.id, p.equipe_pai_id, p.responsavel_id from core.equipe p join acima a on p.id = a.equipe_pai_id where p.deleted_at is null
     )
     select u.id from core.usuario u join acima a on a.responsavel_id = u.id
      where u.deleted_at is null and u.ativo and u.id <> $1`, [vendedorId]);
    if (r.rows.length > 0)
        return [...new Set(r.rows.map((l) => l.id))];
    const f = await ctx.db.query("select id from core.usuario where perfil in ('gerente','analista','admin') and ativo and deleted_at is null and id <> $1", [vendedorId]);
    return f.rows.map((l) => l.id);
}
async function notificar(ctx, vendedorId, entrada) {
    const n = notificacaoDePedido(entrada);
    if (!n)
        return;
    const destinatarios = n.destino === 'vendedor' ? [vendedorId] : await aprovadoresDe(ctx, vendedorId);
    for (const uid of destinatarios) {
        const r = await ctx.db.query(`insert into core.notificacao (tenant_id, usuario_id, tipo, titulo, corpo, link, origem_modulo, envio_id, prioridade)
       select plataforma.tenant_atual(), u.id, 'pedido', $2, $3, $4, 'vendedor', $5, $6 from core.usuario u where u.id = $1 and u.deleted_at is null
       on conflict (tenant_id, usuario_id, envio_id) where envio_id is not null do nothing
       returning id`, [uid, n.titulo, n.corpo, n.link, ctx.envelope.evento_id, n.prioridade]);
        if (r.rows[0])
            await ctx.publicar(EVENTO_NOTIFICACAO_CRIADA, { notificacao_id: r.rows[0].id, usuario_id: uid, tipo: 'pedido', prioridade: n.prioridade }, r.rows[0].id);
    }
}
export const consumidorPedidoStatus = definirConsumidor({
    evento: eventoTolerante(EVENTO_PEDIDO_STATUS_ALTERADO),
    executar: async (p, ctx) => {
        await notificar(ctx, p.vendedor_id, { tipo: 'status', para: p.para, pedidoId: p.pedido_id, motivo: p.motivo, numero: p.pedido_numero });
        // RN-CORE-20/26 (T-0073): o mesmo evento alimenta a positivação do dia em core.indicador_diario
        await apurarPositivacaoDoStatus(p, ctx);
    },
});
export const consumidorPedidoParaAprovar = definirConsumidor({
    evento: eventoTolerante(EVENTO_PEDIDO_APROVACAO_SOLICITADA),
    executar: (p, ctx) => notificar(ctx, p.vendedor_id, { tipo: 'aprovacao_solicitada', pedidoId: p.pedido_id, numero: p.pedido_numero }),
});
export const consumidoresDePedido = [consumidorPedidoStatus, consumidorPedidoParaAprovar];
