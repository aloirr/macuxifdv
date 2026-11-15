export const FUSO = 'America/Manaus';
/** Instante UTC (ISO) de "AAAA-MM-DD HH:MM" em Manaus. */
export const em = (data, hhmm) => new Date(`${data}T${hhmm}:00-04:00`).toISOString();
/**
 * Visita do cliente no dia, com check-in às `ini` e check-out às `fim` (nulo = aberta). Padrão: check-out real pelo usuário,
 * resultado 'atendido', com GPS e a 50 m do cliente.
 */
export function visita(cliente_id, data, ini, fim, o = {}) {
    return {
        cliente_id,
        data_local: data,
        checkin_em: em(data, ini),
        checkout_em: fim === null ? null : em(data, fim),
        resultado: fim === null ? null : (o.resultado ?? 'atendido'),
        fechada_por: fim === null ? null : o.fechada_por === undefined ? 'usuario' : o.fechada_por,
        sem_gps: o.sem_gps ?? false,
        distancia_m: o.distancia_m === undefined ? 50 : o.distancia_m,
        deleted_at: o.deleted_at ?? null,
    };
}
/** Visita fechada na virada do dia (RN-CORE-11): check-out automático às 23:59, `nao_finalizado`. */
export const fechadaNaVirada = (cliente_id, data, ini, o = {}) => visita(cliente_id, data, ini, '23:59', { ...o, resultado: 'nao_finalizado', fechada_por: 'auto' });
