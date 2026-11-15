import { describe, expect, it } from 'vitest';
import { CALENDARIO_PADRAO } from '../meta-do-dia';
import { duDoMes } from './du';
const SEG_A_SEX = { dias_uteis_semana: [1, 2, 3, 4, 5] };
describe('RN-CORE-43: DU no Início (com os feriados nacionais, D3 aprovada)', () => {
    it('RN-CORE-43: quinta, 12/11/2026, segunda a sábado = "DU 9 de 23" (Finados e Consciência Negra fora)', () => {
        expect(duDoMes('2026-11-12', CALENDARIO_PADRAO)).toEqual({ atual: 9, total: 23 });
    });
    it('RN-CORE-43: o primeiro dia útil do mês é o DU 1 (02/11 é Finados; 03/11 é o 1º útil de novembro/2026)', () => {
        expect(duDoMes('2026-11-03', CALENDARIO_PADRAO)).toEqual({ atual: 1, total: 23 });
    });
    it('RN-CORE-43: o último dia útil é o DU N', () => {
        expect(duDoMes('2026-11-30', CALENDARIO_PADRAO)).toEqual({ atual: 23, total: 23 });
    });
    it('RN-CORE-43: feriado nacional não é dia útil (atual = null)', () => {
        expect(duDoMes('2026-11-02', CALENDARIO_PADRAO)).toEqual({ atual: null, total: 23 });
        expect(duDoMes('2026-11-20', CALENDARIO_PADRAO)).toEqual({ atual: null, total: 23 });
    });
    it('RN-CORE-43: dia fora da semana útil do tenant (domingo) não é dia útil', () => {
        expect(duDoMes('2026-11-15', CALENDARIO_PADRAO)).toEqual({ atual: null, total: 23 });
    });
    it('RN-CORE-43: segue a semana útil do tenant (segunda a sexta: sábado não conta)', () => {
        expect(duDoMes('2026-11-12', SEG_A_SEX)).toEqual({ atual: 8, total: 19 });
        expect(duDoMes('2026-11-14', SEG_A_SEX).atual).toBeNull();
    });
    it('RN-CORE-43: feriados do tenant somam aos nacionais', () => {
        expect(duDoMes('2026-11-12', { ...CALENDARIO_PADRAO, feriados: ['2026-11-11'] })).toEqual({ atual: 8, total: 22 });
    });
    it('RN-CORE-43: data inválida é erro de quem chama', () => {
        expect(() => duDoMes('2026-11-31', CALENDARIO_PADRAO)).toThrow(RangeError);
    });
});
