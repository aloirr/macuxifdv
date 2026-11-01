/**
 * Consumidores de evento do Core (ADR 0007; T-0022). Hoje: push da central de notificações (RF-CORE-09).
 * O despachante da outbox roda o handler como `macuxi_app` em `comTenant(tenant do evento)`; `ctx.db` é a MESMA transação
 * do registro em `plataforma.evento_consumo`, então reentrega não repete o efeito no banco. O envio ao Expo é "no mínimo
 * uma vez": `push_enviado_em` evita repetir depois do commit. Sem `MACUXI_PUSH_ATIVO=1` o evento é consumido sem rede
 * (a caixa segue pelo sync). O evento não leva título/corpo: o texto é lido do banco e nunca é logado.
 */
import { definirConsumidor, type ConsumidorEvento, type ContextoConsumo } from '@macuxi/platform-sdk';
import { EVENTO_NOTIFICACAO_CRIADA } from '../contracts';
import { enviarPush, pushAtivo } from './push';

interface NotificacaoParaPush {
  titulo: string;
  corpo: string;
  link: string | null;
  prioridade: 'normal' | 'alta';
  push_enviado_em: Date | null;
  lida_em: Date | null;
}

export interface OpcoesPush {
  env?: Readonly<Record<string, string | undefined>>;
  fetcher?: typeof fetch;
}

export function criarConsumidorPushNotificacao(opcoes: OpcoesPush = {}): ConsumidorEvento {
  return definirConsumidor({
    evento: EVENTO_NOTIFICACAO_CRIADA,
    async executar(p, ctx: ContextoConsumo) {
      if (!pushAtivo(opcoes.env ?? process.env)) return;
      const n = (
        await ctx.db.query<NotificacaoParaPush>(
          'select titulo, corpo, link, prioridade, push_enviado_em, lida_em from core.notificacao where id = $1 and usuario_id = $2 and deleted_at is null',
          [p.notificacao_id, p.usuario_id],
        )
      ).rows[0];
      if (!n || n.push_enviado_em || n.lida_em) return;
      const tokens = (
        await ctx.db.query<{ push_token: string }>(
          'select push_token from core.dispositivo where usuario_id = $1 and push_token is not null and bloqueado_em is null and deleted_at is null',
          [p.usuario_id],
        )
      ).rows;
      const r = await enviarPush(
        tokens.map((t) => ({ token: t.push_token, titulo: n.titulo, corpo: n.corpo, link: n.link, prioridade: n.prioridade })),
        { env: opcoes.env, fetcher: opcoes.fetcher },
      );
      if (r.enviadas > 0) await ctx.db.query('update core.notificacao set push_enviado_em = $2 where id = $1', [p.notificacao_id, ctx.agora()]);
    },
  });
}

export const consumidorPushNotificacao = criarConsumidorPushNotificacao();
