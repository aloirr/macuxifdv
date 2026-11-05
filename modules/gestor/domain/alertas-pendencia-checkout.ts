/**
 * Alerta "Etapa pendente na visita" na aba Alertas do Gestão (T-0039, docs/design/checkout-pendencia.md §4.3).
 * Vem do APARELHO: é a notificação que o Core cria ao supervisor quando a etapa passa do prazo (RN-CORE-12, tarefa
 * `alerta_pendencia_checkout`), lida do pull `notificacao`. O Gestor não consulta `core.visita_etapa` (fronteira).
 * Não é regra de servidor: não entra em `TIPOS_ALERTA` (tabela `alerta`/`alerta_regra`), nem pode ser dispensado.
 * Funções puras. Identificação provisória pelo título/link do Core (pedido de marcador estável ao modulo-core).
 */
import type { NotificacaoSync } from '@macuxi/core/contracts';
import { ALERTA_PENDENCIA_CHECKOUT, type AlertaPendenciaCheckout } from '../contracts';

/**
 * Subconjunto de `NotificacaoSync` (contracts do Core). `subtipo` (T-0039, migração 0030) é lido de forma tolerante:
 * TODO(R-20261105-071923-modulo-core): quando `NotificacaoSyncSchema` publicar `subtipo`, retirar a interseção abaixo.
 */
export type NotificacaoPendencia = Pick<NotificacaoSync, 'id' | 'tipo' | 'origem_modulo' | 'titulo' | 'corpo' | 'link' | 'created_at' | 'deleted_at' | 'expira_em'> & { subtipo?: string | null };

/** Mesma janela do pull `notificacao` do Core (modules/core/api/notificacoes.ts). Enquanto o Core não marca `deleted_at` na baixa. */
export const JANELA_NOTIFICACAO_DIAS = 30;
export const SUBTIPO_ETAPA_PENDENTE = 'etapa_pendente_checkout';

const TITULO_SUPERVISOR = /^Etapa pendente na visita de .+ a .+$/;
const LINK_CLIENTE = /^\/m\/cliente\?id=([0-9a-f-]{36})$/i;

export function ehNotificacaoDePendenciaCheckout(n: NotificacaoPendencia): boolean {
  if (n.origem_modulo !== 'core' || !LINK_CLIENTE.test(n.link ?? '')) return false;
  // marcador estável quando a linha já o traz; título só para linhas antigas (sem subtipo)
  if (n.subtipo) return n.subtipo === SUBTIPO_ETAPA_PENDENTE;
  return n.tipo === 'sistema' && TITULO_SUPERVISOR.test(n.titulo);
}

/** RN-CORE-04: só supervisor e gerente (a equipe deles) veem; o texto é o do Core, sem reescrever. */
export function alertasDePendenciaCheckout(notificacoes: readonly NotificacaoPendencia[], o: { perfil: string | null | undefined; agora: string }): AlertaPendenciaCheckout[] {
  if (o.perfil !== 'supervisor' && o.perfil !== 'gerente') return [];
  const agora = Date.parse(o.agora);
  const limite = agora - JANELA_NOTIFICACAO_DIAS * 86_400_000;
  return notificacoes
    .filter((n) => !n.deleted_at && (!n.expira_em || Date.parse(n.expira_em) > agora) && Date.parse(n.created_at) >= limite && ehNotificacaoDePendenciaCheckout(n))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    .map((n) => ({
      id: n.id,
      tipo: ALERTA_PENDENCIA_CHECKOUT,
      titulo: n.titulo,
      mensagem: n.corpo,
      cliente_id: LINK_CLIENTE.exec(n.link ?? '')![1]!,
      severidade: 'atencao' as const,
      aberto_em: n.created_at,
    }));
}
