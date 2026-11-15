/**
 * Notificações de sistema com push (RN-CORE-23 item 3): meta definida (`core.meta.definida@1`) e rota do dia
 * (chamado pelo consumidor da rota do ERP). Cria UMA notificação `sistema` em `core.notificacao` (idempotente por
 * `envio_id`) e publica `core.notificacao.criada@1`; o consumidor de `consumidores.ts` envia o push com
 * `data.entidades` (`meta` ou `rota`, `rota_parada`) e `data.link`. Sem dado pessoal no texto.
 */
import { createHash } from 'node:crypto';
import { definirConsumidor } from '@macuxi/platform-sdk';
import { EVENTO_META_DEFINIDA, EVENTO_NOTIFICACAO_CRIADA } from '../contracts';
import { notificacaoDeMeta } from '../domain';
/** uuid v5-like determinístico (evento + usuário): estável na reentrega e válido mesmo se o id do evento não for uuid. */
function envioIdDe(eventoId, usuarioId, chave) {
    const h = createHash('sha1').update(`macuxi.notificacao.sistema|${eventoId}|${usuarioId}${chave ? `|${chave}` : ''}`).digest();
    h[6] = (h[6] & 0x0f) | 0x50;
    h[8] = (h[8] & 0x3f) | 0x80;
    const x = h.subarray(0, 16).toString('hex');
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}
export async function notificarSistema(ctx, usuarioId, n, chave) {
    // `chave` (opcional) distingue avisos do mesmo evento/usuário que são fatos diferentes (ex.: versão do registro do ERP)
    const r = await ctx.db.query(`insert into core.notificacao (tenant_id, usuario_id, tipo, titulo, corpo, link, origem_modulo, envio_id, prioridade)
     select plataforma.tenant_atual(), u.id, 'sistema', $2, $3, $4, 'core', $5, $6 from core.usuario u where u.id = $1 and u.deleted_at is null
     on conflict (tenant_id, usuario_id, envio_id) where envio_id is not null do nothing
     returning id`, [usuarioId, n.titulo, n.corpo, n.link, envioIdDe(ctx.envelope.evento_id, usuarioId, chave), n.prioridade]);
    if (r.rows[0])
        await ctx.publicar(EVENTO_NOTIFICACAO_CRIADA, { notificacao_id: r.rows[0].id, usuario_id: usuarioId, tipo: 'sistema', prioridade: n.prioridade }, r.rows[0].id);
}
export const consumidorMetaDefinida = definirConsumidor({
    evento: EVENTO_META_DEFINIDA,
    executar: (p, ctx) => notificarSistema(ctx, p.usuario_id, notificacaoDeMeta({ valorAnterior: p.valor_anterior })),
});
