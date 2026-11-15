import { describe, expect, it } from 'vitest';
import { notaPositiva, positivacaoPorNotas } from './positivacao-notas';
const O = { periodo: '2026-11', fuso: 'America/Manaus', hoje: '2026-11-10' };
const nota = (cliente_id, emitida_em, extra = {}) => ({ cliente_id, emitida_em, ...extra });
describe('RN-CORE-27: positivação pelas notas do ERP', () => {
    it('RN-CORE-27: só faturamento não cancelado positiva', () => {
        expect(notaPositiva({ tipo: 'faturamento', cancelada: false })).toBe(true);
        expect(notaPositiva({ tipo: 'faturamento', cancelada: true })).toBe(false);
        expect(notaPositiva({ tipo: 'devolucao', cancelada: false })).toBe(false);
    });
    it('RN-CORE-27: duas notas do mesmo cliente em dias diferentes contam uma vez, no primeiro dia', () => {
        const r = positivacaoPorNotas([nota('c1', '2026-11-03T15:00:00Z'), nota('c1', '2026-11-10T15:00:00Z')], O);
        expect(r).toEqual({ ate_ontem: 1, hoje: 0, mes: 1 });
    });
    it('RN-CORE-27: nota às 23h30 de Manaus do último dia do mês fica no mês do fuso (UTC já é o mês seguinte)', () => {
        const r = positivacaoPorNotas([nota('c1', '2026-12-01T03:30:00Z')], { periodo: '2026-11', fuso: 'America/Manaus', hoje: '2026-11-30' });
        expect(r.mes).toBe(1);
        const sp = positivacaoPorNotas([nota('c1', '2026-12-01T02:30:00Z')], { periodo: '2026-11', fuso: 'America/Sao_Paulo', hoje: '2026-11-30' });
        expect(sp.mes).toBe(1);
        expect(positivacaoPorNotas([nota('c1', '2026-12-01T03:30:00Z')], { periodo: '2026-12', fuso: 'America/Manaus', hoje: '2026-12-01' }).mes).toBe(0);
    });
    it('RN-CORE-27: nota cancelada sozinha tira o cliente; cancelada com outra válida mantém 1, no dia da válida', () => {
        expect(positivacaoPorNotas([nota('c1', '2026-11-03T15:00:00Z', { cancelada: true })], O).mes).toBe(0);
        const r = positivacaoPorNotas([nota('c1', '2026-11-03T15:00:00Z', { cancelada: true }), nota('c1', '2026-11-10T15:00:00Z')], O);
        expect(r).toEqual({ ate_ontem: 0, hoje: 1, mes: 1 });
    });
    it('RN-CORE-27: devolução não positiva nem retira', () => {
        expect(positivacaoPorNotas([nota('c1', '2026-11-03T15:00:00Z', { tipo: 'devolucao' })], O).mes).toBe(0);
        const r = positivacaoPorNotas([nota('c1', '2026-11-03T15:00:00Z'), nota('c1', '2026-11-04T15:00:00Z', { tipo: 'devolucao' })], O);
        expect(r.mes).toBe(1);
    });
    it('RN-CORE-27: primeira nota hoje = hoje 1; nota ontem e hoje = ate_ontem 1 e hoje 0', () => {
        expect(positivacaoPorNotas([nota('c1', '2026-11-10T15:00:00Z')], O)).toEqual({ ate_ontem: 0, hoje: 1, mes: 1 });
        expect(positivacaoPorNotas([nota('c1', '2026-11-09T15:00:00Z'), nota('c1', '2026-11-10T15:00:00Z')], O)).toEqual({ ate_ontem: 1, hoje: 0, mes: 1 });
    });
    it('RN-CORE-27: nota fora do período ou depois de hoje é ignorada', () => {
        expect(positivacaoPorNotas([nota('c1', '2026-10-31T15:00:00Z'), nota('c2', '2026-11-11T15:00:00Z')], O).mes).toBe(0);
    });
});
