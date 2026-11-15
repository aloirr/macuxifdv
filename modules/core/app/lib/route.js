/**
 * Rota do dia: aplica as visitas do aparelho (check-in aberto ou já com checkout, ainda na fila ou não)
 * sobre a rota sincronizada e projeta as paradas no "mapa" desenhado em SVG. Pura.
 */
import { DEFAULT_TZ } from '@macuxi/ui/mobile/puro';
import { isVisitOpen } from '../../domain';
function toVisit(v, stopId, server) {
    return {
        id: v.id,
        seller_id: v.seller_id,
        customer_id: v.customer_id,
        route_stop_id: stopId,
        checkin_at: v.checkin_at,
        received_at: server?.received_at ?? v.checkin_at,
        lat: v.lat,
        lng: v.lng,
        outcome: v.outcome ?? server?.outcome ?? null,
        no_order_reason: v.no_order_reason || server?.no_order_reason || '',
        order_id: v.order_id ?? server?.order_id ?? null,
        checkout_at: v.checkout_at,
        closed_by: v.closed_by,
        ...(v.etapas_pendentes ? { etapas_pendentes: v.etapas_pendentes } : server?.etapas_pendentes ? { etapas_pendentes: server.etapas_pendentes } : {}),
    };
}
/**
 * Status efetivo de cada parada:
 * - check-in aberto (local ou do servidor, ainda dentro do dia) → `in_progress`;
 * - visita com checkout (ou fechada sozinha na virada do dia) → `done`;
 * - a primeira parada sem visita vira a `next`.
 * A visita do aparelho prevalece sobre a do servidor (o checkout pode estar na fila).
 */
export function effectiveRoute(route, visits, now = new Date(), tz = DEFAULT_TZ) {
    if (!route)
        return null;
    const byStop = new Map();
    const byCustomer = new Map();
    for (const v of [...visits].sort((a, b) => a.checkin_at.localeCompare(b.checkin_at))) {
        if (v.route_stop_id)
            byStop.set(v.route_stop_id, v);
        byCustomer.set(v.customer_id, v);
    }
    let nextAssigned = false;
    const stops = [...route.stops]
        .sort((a, b) => a.sequence - b.sequence)
        .map((s) => {
        const local = byStop.get(s.id) ?? byCustomer.get(s.customer.id);
        const visit = local ? toVisit(local, s.id, s.visit) : s.visit;
        let status;
        if (visit)
            status = isVisitOpen(visit, now, tz) ? 'in_progress' : 'done';
        else if (s.status === 'done')
            status = 'done';
        else if (!nextAssigned) {
            status = 'next';
            nextAssigned = true;
        }
        else
            status = 'pending';
        return { ...s, status, visit, order_total_cents: s.order_total_cents ?? local?.order_total_cents ?? null };
    });
    return { ...route, stops, done_count: stops.filter((s) => s.status === 'done').length };
}
/**
 * Projeta lat/lng num retângulo (norte para cima). Por padrão normaliza cada eixo para ocupar
 * todo o "mapa" (é um esquema, não um mapa em escala) e afasta marcadores que se sobrepõem.
 * `keepAspect` mantém a proporção real (perto do equador 1° lat ≈ 1° lng).
 * Pontos sem coordenada ficam no centro.
 */
export function projectPoints(coords, width, height, padding = 28, opts = {}) {
    const valid = coords.filter((c) => c.lat !== null && c.lng !== null);
    if (valid.length === 0)
        return coords.map(() => ({ x: width / 2, y: height / 2 }));
    const minLat = Math.min(...valid.map((c) => c.lat));
    const maxLat = Math.max(...valid.map((c) => c.lat));
    const minLng = Math.min(...valid.map((c) => c.lng));
    const maxLng = Math.max(...valid.map((c) => c.lng));
    const spanLat = maxLat - minLat;
    const spanLng = maxLng - minLng;
    const innerW = Math.max(1, width - padding * 2);
    const innerH = Math.max(1, height - padding * 2);
    let sx;
    let sy;
    if (opts.keepAspect) {
        const s = spanLat === 0 && spanLng === 0 ? 0 : Math.min(spanLng > 0 ? innerW / spanLng : Infinity, spanLat > 0 ? innerH / spanLat : Infinity);
        sx = s;
        sy = s;
    }
    else {
        sx = spanLng > 0 ? innerW / spanLng : 0;
        sy = spanLat > 0 ? innerH / spanLat : 0;
    }
    const offX = padding + (innerW - spanLng * sx) / 2;
    const offY = padding + (innerH - spanLat * sy) / 2;
    const pts = coords.map((c) => {
        if (c.lat === null || c.lng === null)
            return { x: width / 2, y: height / 2 };
        return { x: offX + (c.lng - minLng) * sx, y: offY + (maxLat - c.lat) * sy };
    });
    if (opts.minDist && opts.minDist > 0)
        separate(pts, opts.minDist, width, height, padding / 2);
    return pts.map((p) => ({ x: round1(p.x), y: round1(p.y) }));
}
/** Empurra pares de pontos mais próximos que `minDist` (relaxação simples, determinística). */
function separate(pts, minDist, width, height, margin) {
    for (let iter = 0; iter < 40; iter++) {
        let moved = false;
        for (let i = 0; i < pts.length; i++) {
            for (let j = i + 1; j < pts.length; j++) {
                const a = pts[i];
                const b = pts[j];
                let dx = b.x - a.x;
                let dy = b.y - a.y;
                let d = Math.hypot(dx, dy);
                if (d >= minDist)
                    continue;
                if (d < 0.01) {
                    dx = 1;
                    dy = 0.5;
                    d = Math.hypot(dx, dy);
                }
                const push = (minDist - d) / 2;
                const ux = dx / d;
                const uy = dy / d;
                a.x -= ux * push;
                a.y -= uy * push;
                b.x += ux * push;
                b.y += uy * push;
                moved = true;
            }
        }
        for (const p of pts) {
            p.x = Math.min(width - margin, Math.max(margin, p.x));
            p.y = Math.min(height - margin, Math.max(margin, p.y));
        }
        if (!moved)
            break;
    }
}
function round1(n) {
    return Math.round(n * 10) / 10;
}
/** Link do Google Maps com rota até o ponto. */
export function mapsUrl(lat, lng, label) {
    if (lat !== null && lng !== null)
        return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label ?? '')}`;
}
/** WhatsApp a partir de "(92) 98237-3437" → https://wa.me/5592982373437 */
export function whatsappUrl(phone) {
    let digits = phone.replace(/\D/g, '');
    if (!digits.startsWith('55'))
        digits = `55${digits}`;
    return `https://wa.me/${digits}`;
}
export function telUrl(phone) {
    return `tel:${phone.replace(/[^\d+]/g, '')}`;
}
