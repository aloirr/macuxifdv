import { describe, expect, it } from 'vitest';
import { abcCurve, averageMix, delinquencyPct, overdue, positivatedCustomers } from './analytics';
describe('abcCurve', () => {
    it('80/15/5: classifica pelo acumulado ANTES do cliente (o maior é sempre A)', () => {
        const m = new Map([
            ['a', 7000],
            ['b', 1500],
            ['c', 1000],
            ['d', 500],
            ['e', 0],
        ]);
        const r = abcCurve(m);
        expect(r.get('a')).toBe('A');
        expect(r.get('b')).toBe('A');
        expect(r.get('c')).toBe('B');
        expect(r.get('d')).toBe('C');
        expect(r.get('e')).toBe('C');
    });
});
describe('positivação', () => {
    const inv = [
        { customer_id: 'c1', seller_id: 's1', issued_at: '2026-10-02T10:00:00Z', total_cents: 100 },
        { customer_id: 'c1', seller_id: 's1', issued_at: '2026-10-05T10:00:00Z', total_cents: 100 },
        { customer_id: 'c2', seller_id: 's2', issued_at: '2026-10-05T10:00:00Z', total_cents: 100 },
        { customer_id: 'c3', seller_id: 's1', issued_at: '2026-09-30T10:00:00Z', total_cents: 100 },
        { customer_id: 'c4', seller_id: 's1', issued_at: '2026-10-03T10:00:00Z', total_cents: 0 },
    ];
    it('conta cliente uma vez, no mês, pelo vendedor da nota', () => {
        expect([...positivatedCustomers(inv, '2026-10', 's1')]).toEqual(['c1']);
        expect(positivatedCustomers(inv, '2026-10').size).toBe(2);
    });
});
describe('mix e inadimplência', () => {
    it('média de linhas', () => {
        expect(averageMix(new Map([['c1', new Set(['x', 'y'])], ['c2', new Set(['x', 'y', 'z', 'w'])]]))).toBe(3);
        expect(averageMix(new Map())).toBe(0);
    });
    const rec = [
        { due_date: '2026-08-01', open_amount_cents: 2000 },
        { due_date: '2026-10-01', open_amount_cents: 3000 },
        { due_date: '2026-11-01', open_amount_cents: 95000 },
    ];
    it('vencidos', () => expect(overdue(rec, '2026-10-12')).toEqual({ count: 2, cents: 5000 }));
    it('inadimplência acima de 30 dias', () => expect(delinquencyPct(rec, '2026-10-12', 30)).toBe(2));
    it('sem títulos = 0', () => expect(delinquencyPct([], '2026-10-12', 30)).toBe(0));
});
