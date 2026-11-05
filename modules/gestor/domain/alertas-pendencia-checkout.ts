/**
 * Alerta "Etapa pendente na visita" na aba Alertas do Gestão (T-0039, docs/design/checkout-pendencia.md §4.3).
 * Vem do APARELHO: é a notificação que o Core cria ao supervisor quando a etapa passa do prazo (RN-CORE-12, tarefa
 * `alerta_pendencia_checkout`), lida do pull `notificacao`. O Gestor não consulta `core.visita_etapa` (fronteira).
 * Não é regra de servidor: não entra em `TIPOS_ALERTA` (tabela `alerta`/`alerta_regra`), nem pode ser dispensado.
 * Funções puras. Identificação provisória pelo título/link do Core (pedido de marcador estável ao modulo-core).
 */
import type { NotificacaoSync } from '@macuxi/core/contracts';
import { ALERTA_PENDENCIA_CHECKOUT, type AlertaPendenciaCheckout } from '../contracts';

/** Subconjunto de `NotificacaoSync` (contracts do Core); `subtipo` vem do contrato (migração 0030). */
export type NotificacaoPendencia = Pick<NotificacaoSync, 'id' | 'tipo' | 'origem_modulo' | 'titulo' | 'corpo' | 'link' | 'updated_at' | 'deleted_at' | 'expira_em' | 'subtipo'>;

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
    .flatMap((n) => {
      if (n.deleted_at || (n.expira_em && Date.parse(n.expira_em) <= agora) || Date.parse(n.updated_at) < limite || !ehNotificacaoDePendenciaCheckout(n)) return [];
      // o link já foi validado por ehNotificacaoDePendenciaCheckout; aqui só extrai o id do cliente
      const clienteId = LINK_CLIENTE.exec(n.link ?? '')?.[1];
      return clienteId ? [{ n, clienteId }] : [];
    })
    .sort((a, b) => (a.n.updated_at < b.n.updated_at ? 1 : a.n.updated_at > b.n.updated_at ? -1 : 0))
    .map(({ n, clienteId }) => ({
      id: n.id,
      tipo: ALERTA_PENDENCIA_CHECKOUT,
      titulo: n.titulo,
      mensagem: n.corpo,
      cliente_id: clienteId,
      severidade: 'atencao' as const,
      aberto_em: n.updated_at,
    }));
}
