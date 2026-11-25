import { describe, expect, it } from 'vitest';
import { haversineKm, improveOrder, nearestNeighborOrder, optimizeRoute, roadKm, routeDistanceKm } from './route';
const cd = { lat: -3.1, lng: -60.0 };
const p = (id, lat, lng) => ({ id, lat, lng });
describe('roteirização', () => {
    it('distância: 0,01° de latitude ≈ 1,1 km; rua ×1,3', () => {
        expect(haversineKm(cd, { lat: -3.11, lng: -60.0 })).toBeCloseTo(1.11, 1);
        expect(roadKm(cd, { lat: -3.11, lng: -60.0 })).toBe(1.4);
    });
    it('sem coordenada não soma distância', () => {
        expect(roadKm(cd, { lat: null, lng: null })).toBe(0);
    });
    it('vizinho mais próximo a partir do CD; sem coordenada vai para o fim', () => {
        const stops = [p('longe', -3.2, -60.0), p('sem', null, null), p('perto', -3.11, -60.0), p('meio', -3.15, -60.0)];
        expect(nearestNeighborOrder(cd, stops).map((s) => s.id)).toEqual(['perto', 'meio', 'longe', 'sem']);
    });
    it('ordenar reduz (ou mantém) o km total', () => {
        const stops = [p('a', -3.2, -60.0), p('b', -3.11, -60.0), p('c', -3.18, -60.0), p('d', -3.12, -60.0)];
        expect(routeDistanceKm(cd, nearestNeighborOrder(cd, stops))).toBeLessThan(routeDistanceKm(cd, stops));
    });
    it('2-opt desfaz cruzamento e nunca piora', () => {
        const cruz = [p('a', -3.11, -60.0), p('c', -3.13, -60.0), p('b', -3.12, -60.0), p('d', -3.14, -60.0)];
        const out = improveOrder(cd, cruz);
        expect(out.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
        expect(routeDistanceKm(cd, out)).toBeLessThanOrEqual(routeDistanceKm(cd, cruz));
    });
    it('optimizeRoute: mais curta entre sugestão e ordem atual; sem coordenada no fim', () => {
        const stops = [p('sem', null, null), p('d', -3.14, -60.0), p('a', -3.11, -60.0), p('c', -3.13, -60.0), p('b', -3.12, -60.0)];
        const out = optimizeRoute(cd, stops);
        expect(out.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd', 'sem']);
        expect(optimizeRoute(cd, [])).toEqual([]);
    });
});
