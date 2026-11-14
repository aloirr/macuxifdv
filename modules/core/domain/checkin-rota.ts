/**
 * RN-CORE-52: check-in só no cliente que está na rota do dia do usuário; fora da rota, só com a ação
 * `visita.checkin_fora_de_rota` no perfil de acesso. Função pura: o app (offline) e a API (que sempre revalida) usam a mesma.
 */
export interface EntradaCheckinNaRota {
  clienteId: string;
  /** Clientes das paradas da rota do dia do usuário (vazio = sem rota). */
  clientesDaRota: Iterable<string>;
  /** O perfil do usuário tem `visita.checkin_fora_de_rota`. */
  podeForaDeRota: boolean;
}

export function checkinPermitido(e: EntradaCheckinNaRota): boolean {
  return new Set(e.clientesDaRota).has(e.clienteId) || e.podeForaDeRota;
}
