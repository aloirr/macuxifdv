import { describe, expect, it } from 'vitest';
import { autoCheckoutAt, checkCheckin, findOpenVisit, isVisitOpen, visitDuration, visitsToAutoClose, zonedMidnightUtc } from './visit';
const TZ = 'America/Manaus'; // UTC-4
const v = (id, customer, checkin, checkout = null, seller = 's1') => ({
    id,
    seller_id: seller,
    customer_id: customer,
    checkin_at: checkin,
    checkout_at: checkout,
});
describe('virada do dia', () => {
    it('meia-noite de Manaus = 04:00 UTC', () => {
        expect(zonedMidnightUtc('2026-10-13', TZ)).toBe('2026-10-13T04:00:00.000Z');
    });
    it('check-in às 17:51 de 12/10 fecha na meia-noite de 13/10', () => {
        expect(autoCheckoutAt('2026-10-12T21:51:00Z', TZ)).toBe('2026-10-13T04:00:00.000Z');
    });
    it('check-in às 23:30 local (03:30 UTC do dia seguinte) usa o dia local', () => {
        expect(autoCheckoutAt('2026-10-13T03:30:00Z', TZ)).toBe('2026-10-13T04:00:00.000Z');
    });
    it('aberto até a virada, fechado depois', () => {
        const a = v('a', 'c1', '2026-10-12T21:51:00Z');
        expect(isVisitOpen(a, new Date('2026-10-13T03:59:00Z'), TZ)).toBe(true);
        expect(isVisitOpen(a, new Date('2026-10-13T04:00:00Z'), TZ)).toBe(false);
    });
});
describe('um check-in por vez', () => {
    const now = new Date('2026-10-12T22:03:00Z');
    const visits = [v('a', 'c1', '2026-10-12T12:00:00Z', '2026-10-12T12:20:00Z'), v('b', 'c2', '2026-10-12T21:51:00Z'), v('x', 'c9', '2026-10-12T21:00:00Z', null, 's2')];
    it('acha o check-in aberto do vendedor', () => {
        expect(findOpenVisit(visits, 's1', now, TZ)?.id).toBe('b');
        expect(findOpenVisit(visits, 's3', now, TZ)).toBeNull();
    });
    it('proíbe check-in em outro cliente com um aberto', () => {
        const r = checkCheckin(visits, 's1', 'c3', now, TZ);
        expect(r.ok).toBe(false);
        if (!r.ok)
            expect(r.open.customer_id).toBe('c2');
    });
    it('no mesmo cliente devolve o check-in existente (não duplica)', () => {
        expect(checkCheckin(visits, 's1', 'c2', now, TZ)).toMatchObject({ ok: true, existing: { id: 'b' } });
    });
    it('sem check-in aberto, libera', () => {
        expect(checkCheckin(visits.slice(0, 1), 's1', 'c3', now, TZ)).toEqual({ ok: true, existing: null });
    });
    it('outro vendedor com check-in aberto não interfere', () => {
        expect(checkCheckin(visits, 's2', 'c1', now, TZ).ok).toBe(false);
        expect(checkCheckin(visits.slice(0, 2), 's2', 'c1', now, TZ).ok).toBe(true);
    });
    it('check-in esquecido de ontem não bloqueia hoje', () => {
        const old = [v('o', 'c1', '2026-10-11T20:00:00Z')];
        expect(checkCheckin(old, 's1', 'c5', now, TZ).ok).toBe(true);
    });
});
describe('fechamento automático', () => {
    it('fecha o de ontem na meia-noite e o duplicado de hoje na hora', () => {
        const now = new Date('2026-10-12T22:00:00Z');
        const r = visitsToAutoClose([v('old', 'c1', '2026-10-11T20:00:00Z'), v('d1', 'c2', '2026-10-12T21:51:00Z'), v('d2', 'c3', '2026-10-12T21:52:00Z'), v('ok', 'c4', '2026-10-12T13:00:00Z', '2026-10-12T13:30:00Z')], now, TZ);
        expect(r.map((x) => [x.visit.id, x.reason])).toEqual([
            ['old', 'day_end'],
            ['d1', 'duplicate'],
        ]);
        expect(r[0].checkout_at).toBe('2026-10-12T04:00:00.000Z');
    });
    it('duração', () => {
        expect(visitDuration('2026-10-12T21:51:00Z', '2026-10-12T22:03:00Z')).toBe('12 min');
        expect(visitDuration('2026-10-12T21:00:00Z', '2026-10-12T22:05:00Z')).toBe('1 h 05 min');
    });
});
