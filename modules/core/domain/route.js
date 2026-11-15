export const ROAD_FACTOR = 1.3;
export function haversineKm(a, b) {
    if (a.lat === null || a.lng === null || b.lat === null || b.lng === null)
        return 0;
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}
/** Distância aproximada de rua, 1 casa decimal. */
export function roadKm(a, b) {
    return Math.round(haversineKm(a, b) * ROAD_FACTOR * 10) / 10;
}
/** Km total do percurso: saída → paradas na ordem (sem voltar). */
export function routeDistanceKm(start, stops) {
    let total = 0;
    let prev = start;
    for (const s of stops) {
        total += roadKm(prev, s);
        if (s.lat !== null && s.lng !== null)
            prev = s;
    }
    return Math.round(total * 10) / 10;
}
/**
 * Ordena as paradas pelo vizinho mais próximo, começando do ponto de saída.
 * Paradas sem coordenada vão para o fim, na ordem original.
 */
export function nearestNeighborOrder(start, stops) {
    const withGeo = stops.filter((s) => s.lat !== null && s.lng !== null);
    const without = stops.filter((s) => s.lat === null || s.lng === null);
    const out = [];
    const left = [...withGeo];
    let cur = start;
    while (left.length) {
        let best = 0;
        let bestD = Infinity;
        left.forEach((s, i) => {
            const d = haversineKm(cur, s);
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        });
        const [next] = left.splice(best, 1);
        out.push(next);
        cur = next;
    }
    return [...out, ...without];
}
/**
 * Melhora uma ordem trocando trechos (2-opt) enquanto o km total cair. Percurso aberto (sem volta ao CD).
 * Nunca devolve uma ordem mais longa que a recebida. Paradas sem coordenada não pesam na distância.
 */
export function improveOrder(start, order) {
    let best = order;
    let bestKm = routeDistanceKm(start, best);
    let improved = true;
    while (improved) {
        improved = false;
        for (let i = 0; i < best.length - 1; i++) {
            for (let k = i + 1; k < best.length; k++) {
                const cand = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
                const km = routeDistanceKm(start, cand);
                if (km < bestKm - 0.05) {
                    best = cand;
                    bestKm = km;
                    improved = true;
                }
            }
        }
    }
    return best;
}
/**
 * Ordem sugerida: vizinho mais próximo refinado com 2-opt, comparado com a ordem atual refinada;
 * fica a mais curta. Paradas sem coordenada vão para o fim, na ordem original.
 */
export function optimizeRoute(start, stops) {
    const withGeo = stops.filter((s) => s.lat !== null && s.lng !== null);
    const without = stops.filter((s) => s.lat === null || s.lng === null);
    const nn = improveOrder(start, nearestNeighborOrder(start, withGeo));
    const current = improveOrder(start, withGeo);
    const best = routeDistanceKm(start, current) < routeDistanceKm(start, nn) ? current : nn;
    return [...best, ...without];
}
