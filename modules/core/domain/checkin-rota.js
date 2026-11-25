import { perfilUsaApp } from '@macuxi/platform-sdk';
export function checkinPermitido(e) {
    return new Set(e.clientesDaRota).has(e.clienteId) || e.podeForaDeRota;
}
/** RN-CORE-13 (T-0187): quem é de gestão (supervisor, gerente) registra visita só com a ação `visita.registrar_gestao`; o Campo não depende dela. */
export function visitaDeGestaoPermitida(e) {
    return !perfilUsaApp(e.perfil, 'gestao') || e.podeRegistrarGestao;
}
