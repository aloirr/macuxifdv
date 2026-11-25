import { describe, expect, it } from 'vitest';
import { JANELAS_CORE as J } from './janelas-sync';
const H = '2026-11-09';
describe('T-0121: naJanela das entidades do Core espelha o SQL de janela (ADR 0009 §5)', () => {
    it('carteira: fim nulo ou >= hoje-40 fica; fim anterior sai', () => {
        expect(J.carteira({ fim: null }, H)).toBe(true);
        expect(J.carteira({ fim: '2026-09-30' }, H)).toBe(true);
        expect(J.carteira({ fim: '2026-09-29' }, H)).toBe(false);
    });
    it('titulo: aberto sempre fica; liquidado só com vencimento >= hoje-90', () => {
        expect(J.titulo({ situacao: 'aberto', vencimento: '2020-01-01' }, H)).toBe(true);
        expect(J.titulo({ situacao: 'liquidado', vencimento: '2026-08-11' }, H)).toBe(true);
        expect(J.titulo({ situacao: 'liquidado', vencimento: '2026-08-10' }, H)).toBe(false);
    });
    it('historico_compra: ano_mes >= hoje-12 meses', () => {
        expect(J.historico_compra({ ano_mes: '2025-11' }, H)).toBe(true);
        expect(J.historico_compra({ ano_mes: '2025-10' }, H)).toBe(false);
    });
    it('rota, rota_parada e visita: >= least(hoje-40, início do mês anterior), sem limite superior', () => {
        for (const [j, campo] of [[J.rota, 'data'], [J.rota_parada, 'data'], [J.visita, 'data_local']]) {
            expect(j({ [campo]: '2026-09-30' }, H)).toBe(true);
            expect(j({ [campo]: '2027-01-01' }, H)).toBe(true);
            expect(j({ [campo]: '2026-09-29' }, H)).toBe(false);
            // T-0170: no fim do mês o mês anterior inteiro continua (hoje-40 = 21/10, mas 01/10 fica)
            expect(j({ [campo]: '2026-10-01' }, '2026-11-30')).toBe(true);
            expect(j({ [campo]: '2026-09-30' }, '2026-11-30')).toBe(false);
        }
    });
    it('meta: periodo >= mês anterior; indicador_diario: data >= início do mês anterior', () => {
        expect(J.meta({ periodo: '2026-10' }, H)).toBe(true);
        expect(J.meta({ periodo: '2026-09' }, H)).toBe(false);
        expect(J.indicador_diario({ data: '2026-10-01' }, H)).toBe(true);
        expect(J.indicador_diario({ data: '2026-09-30' }, H)).toBe(false);
    });
    it('notificacao: expirada sai; sem expiração fica', () => {
        expect(J.notificacao({ expira_em: null }, H)).toBe(true);
        expect(J.notificacao({ expira_em: '2026-11-09T10:00:00.000Z' }, H)).toBe(true);
        expect(J.notificacao({ expira_em: '2026-11-08T10:00:00.000Z' }, H)).toBe(false);
    });
    it('na dúvida (campo ausente ou formato estranho) a linha fica', () => {
        for (const j of Object.values(J))
            expect(j({}, H)).toBe(true);
        expect(J.rota({ data: 123 }, H)).toBe(true);
    });
});
