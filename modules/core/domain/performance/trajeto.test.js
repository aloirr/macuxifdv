import { describe, expect, it } from 'vitest';
import { haversineM, metrosDoTrajeto, TRAJETO_PADRAO } from './trajeto';
/** 0,01° de latitude ≈ 1.111,95 m (raio médio 6.371.008,8 m). */
const P0 = { latitude: -3.13, longitude: -60.02 };
const ponto = (dLat, hhmmss, precisao_m = 10) => ({
    latitude: P0.latitude + dLat,
    longitude: P0.longitude,
    precisao_m,
    capturado_em: `2026-11-12T${hhmmss}Z`,
});
describe('RN-CORE-46: km do dia pelos pontos do rastreamento (metrosDoTrajeto)', () => {
    it('RN-CORE-46: haversine de 0,01° de latitude ≈ 1.112 m', () => {
        expect(Math.round(haversineM(P0, { ...P0, latitude: P0.latitude + 0.01 }))).toBe(1112);
        expect(haversineM(P0, P0)).toBe(0);
    });
    it('RN-CORE-46: soma as distâncias entre pontos consecutivos, em metros inteiros', () => {
        const t = metrosDoTrajeto([ponto(0, '12:00:00'), ponto(0.01, '12:02:00'), ponto(0.02, '12:04:00')]);
        expect(t).toEqual({ metros: 2224, pontos: 3 });
    });
    it('RN-CORE-46: ordena pelo instante antes de somar', () => {
        const t = metrosDoTrajeto([ponto(0.02, '12:04:00'), ponto(0, '12:00:00'), ponto(0.01, '12:02:00')]);
        expect(t).toEqual({ metros: 2224, pontos: 3 });
    });
    it('RN-CORE-46: descarta ponto com precisão pior que 50 m ou sem precisão; 50 m exatos entram', () => {
        expect(metrosDoTrajeto([ponto(0, '12:00:00'), ponto(0.05, '12:01:00', 51), ponto(0.01, '12:02:00', 50)])).toEqual({ metros: 1112, pontos: 2 });
        expect(metrosDoTrajeto([ponto(0, '12:00:00'), ponto(0.01, '12:02:00', null)])).toEqual({
            metros: 0,
            pontos: 1,
        });
    });
    it('RN-CORE-46: descarta o salto acima de 150 km/h e mede o ponto seguinte desde o último aceito', () => {
        // 0,1° (≈ 11,1 km) em 1 min = 667 km/h: salto. Depois, 1,1 km em 2 min desde o primeiro ponto.
        const t = metrosDoTrajeto([ponto(0, '12:00:00'), ponto(0.1, '12:01:00'), ponto(0.01, '12:02:00')]);
        expect(t).toEqual({ metros: 1112, pontos: 2 });
    });
    it('RN-CORE-46: 150 km/h exatos entram (≈ 1.112 m em 26,7 s)', () => {
        const segundos = Math.ceil((haversineM(P0, { ...P0, latitude: P0.latitude + 0.01 }) / (150 / 3.6)) * 1000) / 1000;
        const fim = new Date(Date.parse('2026-11-12T12:00:00Z') + segundos * 1000).toISOString();
        expect(metrosDoTrajeto([ponto(0, '12:00:00'), { ...ponto(0.01, '12:00:00'), capturado_em: fim }]).pontos).toBe(2);
    });
    it('RN-CORE-46: ponto repetido no mesmo instante e lugar não soma nada; no mesmo instante em outro lugar é salto', () => {
        expect(metrosDoTrajeto([ponto(0, '12:00:00'), ponto(0, '12:00:00')])).toEqual({ metros: 0, pontos: 2 });
        expect(metrosDoTrajeto([ponto(0, '12:00:00'), ponto(0.001, '12:00:00')])).toEqual({
            metros: 0,
            pontos: 1,
        });
    });
    it('RN-CORE-46: coordenada ou instante inválidos ficam fora', () => {
        const ruins = [
            { ...ponto(0, '12:01:00'), latitude: 91 },
            { ...ponto(0, '12:01:00'), longitude: Number.NaN },
            { ...ponto(0, '12:01:00'), capturado_em: 'ontem' },
            { ...ponto(0, '12:01:00'), precisao_m: -1 },
        ];
        expect(metrosDoTrajeto([ponto(0, '12:00:00'), ...ruins])).toEqual({ metros: 0, pontos: 1 });
    });
    it('RN-CORE-46: sem ponto, 0 m e 0 pontos (o resumo do dia sai "sem dado" na Performance)', () => {
        expect(metrosDoTrajeto([])).toEqual({ metros: 0, pontos: 0 });
    });
    it('RN-CORE-46: os limites vêm dos parâmetros do tenant', () => {
        const l = [ponto(0, '12:00:00'), ponto(0.01, '12:02:00', 80)];
        expect(metrosDoTrajeto(l).pontos).toBe(1);
        expect(metrosDoTrajeto(l, { ...TRAJETO_PADRAO, precisao_max_m: 100 })).toEqual({
            metros: 1112,
            pontos: 2,
        });
        expect(metrosDoTrajeto([ponto(0, '12:00:00'), ponto(0.01, '12:02:00')], {
            ...TRAJETO_PADRAO,
            velocidade_max_kmh: 20,
        }).pontos).toBe(1);
    });
});
