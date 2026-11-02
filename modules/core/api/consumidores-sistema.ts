/**
 * Notificações de sistema com push (RN-CORE-23 item 3): meta definida (`core.meta.definida@1`) e rota do dia
 * (chamado pelo consumidor da rota do ERP). Cria UMA notificação `sistema` em `core.notificacao` (idempotente por
 * `envio_id`) e publica `core.notificacao.criada@1`; o consumidor de `consumidores.ts` envia o push com
 * `data.entidades` (`meta` ou `rota`, `rota_parada`) e `data.link`. Sem dado pessoal no texto.
 */
import { definirConsumidor, type ConsumidorEvento, type ContextoConsumo } from '@macuxi/platform-sdk';
import { EVENTO_META_DEFINIDA, EVENTO_NOTIFICACAO_CRIADA } from '../contracts';
import { notificacaoDeMeta, type NotificacaoDeSistema } from '../domain';

export async function notificarSistema(ctx: ContextoConsumo, usuarioId: string, n: NotificacaoDeSistema): Promise<void> {
  const r = await ctx.db.query<{ id: string }>(
    `insert into core.notificacao (tenant_id, usuario_id, tipo, titulo, corpo, link, origem_modulo, envio_id, prioridade)
     select plataforma.tenant_atual(), u.id, 'sistema', $2, $3, $4, 'core', $5, $6 from core.usuario u where u.id = $1 and u.deleted_at is null
     on conflict (tenant_id, usuario_id, envio_id) where envio_id is not null do nothing
     returning id`,
    [usuarioId, n.titulo, n.corpo, n.link, ctx.envelope.evento_id, n.prioridade],
  );
  if (r.rows[0]) await ctx.publicar(EVENTO_NOTIFICACAO_CRIADA, { notificacao_id: r.rows[0].id, usuario_id: usuarioId, tipo: 'sistema', prioridade: n.prioridade }, r.rows[0].id);
}

export const consumidorMetaDefinida: ConsumidorEvento = definirConsumidor({
  evento: EVENTO_META_DEFINIDA,
  executar: (p, ctx) => notificarSistema(ctx, p.usuario_id, notificacaoDeMeta({ valorAnterior: p.valor_anterior })),
});
