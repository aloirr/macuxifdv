/**
 * RN-CORE-52: check-in só no cliente que está na rota do dia do usuário; fora da rota, só com a ação
 * `visita.checkin_fora_de_rota` no perfil de acesso. Função pura: o app (offline) e a API (que sempre revalida) usam a mesma.
 */
import { ACAO_CHECKIN_FORA_DE_ROTA } from '../contracts/visita';

export { ACAO_CHECKIN_FORA_DE_ROTA };

export interface EntradaCheckinNaRota {
  clienteId: string;
  /** Clientes das paradas da rota do dia do usuário (vazio = sem rota). */
  clientesDaRota: Iterable<string>;
  /** O perfil do usuário tem `visita.checkin_fora_de_rota`. */
  podeForaDeRota: boolean;
}

export function checkinPermitido(e: EntradaCheckinNaRota): { permitido: boolean; foraDeRota: boolean } {
  const naRota = new Set(e.clientesDaRota).has(e.clienteId);
  return { permitido: naRota || e.podeForaDeRota, foraDeRota: !naRota };
}
