/**
 * Notificações de pedido (RN-CORE-23 item 3; RF-CORE-09). Consome os eventos públicos do Vendedor
 * (`vendedor.pedido.status_alterado@1` e `vendedor.pedido.aprovacao_solicitada@1`; definições do `contracts` do Vendedor, leitura tolerante, T-0024), gera UMA notificação por
 * destinatário em `core.notificacao` e publica `core.notificacao.criada@1` (o consumidor de `consumidores.ts` envia o
 * push com `data.link` e `data.entidades`). Idempotente: `envio_id` = id do evento, único por destinatário
 * (reentrega não repete). Destinatários: o vendedor do pedido; para "para aprovar", os responsáveis das equipes acima
 * dele (supervisor, gerente...) e, sem ninguém, os usuários de perfil gerente/analista/admin do tenant.
 * O texto não leva dado pessoal.
 */
import { definirConsumidor, eventoTolerante, type ConsumidorEvento, type ContextoConsumo } from '@macuxi/platform-sdk';
import { EVENTO_NOTIFICACAO_CRIADA } from '../contracts';
import { EVENTO_PEDIDO_APROVACAO_SOLICITADA, EVENTO_PEDIDO_APROVACAO_SOLICITADA_V2, EVENTO_PEDIDO_STATUS_ALTERADO, NIVEIS_APROVACAO, ROTULO_MOTIVO_APROVACAO, quemDecide } from '../../vendedor/contracts';
import { apurarPositivacaoDoStatus } from './consumidores-positivacao';
import { notificacaoDePedido, notificacoesDeAprovacaoPorAprovador, type NotificacaoDePedido, type UsuarioAprovador, type EntradaNotificacaoPedido } from '../domain';

/** Responsáveis (ativos) das equipes acima do vendedor, com o perfil. Única cópia da consulta recursiva (@1 e @2). */
async function responsaveisAcima(ctx: ContextoConsumo, vendedorId: string): Promise<UsuarioAprovador[]> {
  const r = await ctx.db.query<UsuarioAprovador>(
    `with recursive acima as (
       select e.id, e.equipe_pai_id, e.responsavel_id from core.equipe e join core.usuario v on v.equipe_id = e.id
        where v.id = $1 and e.deleted_at is null
       union
       select p.id, p.equipe_pai_id, p.responsavel_id from core.equipe p join acima a on p.id = a.equipe_pai_id where p.deleted_at is null
     )
     select distinct u.id, u.perfil from core.usuario u join acima a on a.responsavel_id = u.id
      where u.deleted_at is null and u.ativo and u.id <> $1`,
    [vendedorId],
  );
  return r.rows;
}

/** Perfis de alçada do tenant (fallback de quem não tem responsável acima). */
async function alcadaDoTenant(ctx: ContextoConsumo, vendedorId: string): Promise<UsuarioAprovador[]> {
  const f = await ctx.db.query<UsuarioAprovador>("select id, perfil from core.usuario where perfil in ('gerente','analista','admin') and ativo and deleted_at is null and id <> $1", [vendedorId]);
  return f.rows;
}

/** @1: responsáveis das equipes acima do vendedor; sem ninguém, os perfis de alçada do tenant. */
async function aprovadoresDe(ctx: ContextoConsumo, vendedorId: string): Promise<string[]> {
  const acima = await responsaveisAcima(ctx, vendedorId);
  const lista = acima.length > 0 ? acima : await alcadaDoTenant(ctx, vendedorId);
  return [...new Set(lista.map((u) => u.id))];
}

async function notificar(ctx: ContextoConsumo, vendedorId: string, entrada: EntradaNotificacaoPedido): Promise<void> {
  const n = notificacaoDePedido(entrada);
  if (!n) return;
  const destinatarios = n.destino === 'vendedor' ? [vendedorId] : await aprovadoresDe(ctx, vendedorId);
  await gravar(ctx, destinatarios, n);
}

async function gravar(ctx: ContextoConsumo, destinatarios: string[], n: NotificacaoDePedido): Promise<void> {
  for (const uid of destinatarios) {
    const r = await ctx.db.query<{ id: string }>(
      `insert into core.notificacao (tenant_id, usuario_id, tipo, titulo, corpo, link, origem_modulo, envio_id, prioridade)
       select plataforma.tenant_atual(), u.id, 'pedido', $2, $3, $4, 'vendedor', $5, $6 from core.usuario u where u.id = $1 and u.deleted_at is null
       on conflict (tenant_id, usuario_id, envio_id) where envio_id is not null do nothing
       returning id`,
      [uid, n.titulo, n.corpo, n.link, ctx.envelope.evento_id, n.prioridade],
    );
    if (r.rows[0]) await ctx.publicar(EVENTO_NOTIFICACAO_CRIADA, { notificacao_id: r.rows[0].id, usuario_id: uid, tipo: 'pedido', prioridade: n.prioridade }, r.rows[0].id);
  }
}

export const consumidorPedidoStatus: ConsumidorEvento = definirConsumidor({
  evento: eventoTolerante(EVENTO_PEDIDO_STATUS_ALTERADO),
  executar: async (p, ctx) => {
    await notificar(ctx, p.vendedor_id, { tipo: 'status', para: p.para, pedidoId: p.pedido_id, motivo: p.motivo, numero: p.pedido_numero });
    // RN-CORE-20/26 (T-0073): o mesmo evento alimenta a positivação do dia em core.indicador_diario
    await apurarPositivacaoDoStatus(p, ctx);
  },
});

export const consumidorPedidoParaAprovar: ConsumidorEvento = definirConsumidor({
  evento: eventoTolerante(EVENTO_PEDIDO_APROVACAO_SOLICITADA),
  executar: (p, ctx) => notificar(ctx, p.vendedor_id, { tipo: 'aprovacao_solicitada', pedidoId: p.pedido_id, numero: p.pedido_numero }),
});

/**
 * `@2` (T-0184, RN-GES-04): uma notificação por aprovador, com todos os motivos que ele decide (domínio puro). A reentrega
 * não duplica: `envio_id` é único por destinatário.
 */
export const consumidorPedidoParaAprovarV2: ConsumidorEvento = definirConsumidor({
  evento: eventoTolerante(EVENTO_PEDIDO_APROVACAO_SOLICITADA_V2),
  executar: async (p, ctx) => {
    const lista = notificacoesDeAprovacaoPorAprovador({
      pedidoId: p.pedido_id,
      numero: p.pedido_numero,
      vendedorId: p.vendedor_id,
      aprovacoes: p.aprovacoes,
      acima: await responsaveisAcima(ctx, p.vendedor_id),
      alcada: await alcadaDoTenant(ctx, p.vendedor_id),
      ordemNiveis: NIVEIS_APROVACAO,
      decide: (perfil, nivel) => quemDecide(perfil, nivel as Parameters<typeof quemDecide>[1]).pode,
      rotuloMotivo: ROTULO_MOTIVO_APROVACAO,
    });
    for (const { usuarioId, notificacao } of lista) await gravar(ctx, [usuarioId], notificacao);
  },
});

export const consumidoresDePedido: ConsumidorEvento[] = [consumidorPedidoStatus, consumidorPedidoParaAprovar, consumidorPedidoParaAprovarV2];
