export function checkinPermitido(e) {
    return new Set(e.clientesDaRota).has(e.clienteId) || e.podeForaDeRota;
}
