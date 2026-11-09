/**
 * Caixa de notificações no aparelho (RF-CORE-09; T-0019). Puro: recebe as linhas do pull `notificacao` e a fila
 * (`notificacao_leitura` ainda não enviada) e devolve a lista ordenada com a leitura offline já aplicada.
 * Ler uma notificação é um comando de envio (UUID do aparelho); o servidor guarda a primeira hora (ADR 0009).
 */
import type { LeituraNotificacao, NotificacaoSync } from '../../contracts';

export interface NotificacaoLocal extends NotificacaoSync {
  /** `true` quando a leitura está só na fila (ainda não subiu). */
  leituraPendente: boolean;
}

interface ItemFila {
  entidade: string;
  payload: unknown;
}

/** Remove as removidas e as expiradas, aplica a leitura da fila e ordena: não lidas primeiro, alta prioridade, mais novas. */
export function montarCaixa(linhas: readonly NotificacaoSync[], fila: readonly ItemFila[], agora: Date): NotificacaoLocal[] {
  const lidasNaFila = new Map<string, string>();
  for (const i of fila) {
    if (i.entidade !== 'notificacao_leitura') continue;
    const p = i.payload as Partial<LeituraNotificacao> | null;
    if (p?.notificacao_id && p.lida_em && !lidasNaFila.has(p.notificacao_id)) lidasNaFila.set(p.notificacao_id, p.lida_em);
  }
  return linhas
    .filter((n) => !n.deleted_at && !(n.expira_em && new Date(n.expira_em).getTime() <= agora.getTime()))
    .map((n): NotificacaoLocal => {
      const pendente = !n.lida_em && lidasNaFila.has(n.id);
      return { ...n, lida_em: n.lida_em ?? lidasNaFila.get(n.id) ?? null, leituraPendente: pendente };
    })
    .sort((a, b) => {
      const naoLidaA = a.lida_em ? 1 : 0;
      const naoLidaB = b.lida_em ? 1 : 0;
      if (naoLidaA !== naoLidaB) return naoLidaA - naoLidaB;
      if (a.prioridade !== b.prioridade) return a.prioridade === 'alta' ? -1 : 1;
      return b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id);
    });
}

export const contarNaoLidas = (caixa: readonly NotificacaoLocal[]): number => caixa.filter((n) => !n.lida_em).length;

/** Comando de leitura: o `id` do item da fila é o do comando; reenviar não duplica. */
export function comandoDeLeitura(notificacaoId: string, agora: Date, novoId: () => string): LeituraNotificacao {
  return { id: novoId(), notificacao_id: notificacaoId, lida_em: agora.toISOString() };
}

export const rotuloDoTipo: Record<NotificacaoSync['tipo'], string> = {
  recado: 'Recado',
  sistema: 'Aviso do sistema',
  pedido: 'Pedido',
  treinamento: 'Treinamento',
  trade: 'Trade marketing',
};
