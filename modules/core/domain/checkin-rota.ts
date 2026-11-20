import { perfilUsaApp, type Perfil } from '@macuxi/platform-sdk';

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

/** RN-CORE-13 (T-0187): quem é de gestão (supervisor, gerente) registra visita só com a ação `visita.registrar_gestao`; o Campo não depende dela. */
export function visitaDeGestaoPermitida(e: { perfil: string; podeRegistrarGestao: boolean }): boolean {
  return !perfilUsaApp(e.perfil as Perfil, 'gestao') || e.podeRegistrarGestao;
}
