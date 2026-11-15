import { describe, expect, it } from 'vitest';
import { prazoAceito, situacaoTarefa } from './situacao';
const FUSO = 'America/Manaus'; // UTC-4
const linha = (p = {}) => ({ prazo: '2026-11-13', concluida_em: null, cancelada_em: null, ...p });
const ctx = (hoje) => ({ hoje, fuso: FUSO });
describe('RN-CORE-TAR-02: situação e atraso (data civil no fuso do tenant)', () => {
    it('RN-CORE-TAR-02: aberta até o dia do prazo, inclusive', () => {
        expect(situacaoTarefa(linha(), ctx('2026-11-12'))).toBe('aberta');
        expect(situacaoTarefa(linha(), ctx('2026-11-13'))).toBe('aberta');
    });
    it('RN-CORE-TAR-02: atrasada = hoje > prazo, sem conclusão e sem cancelamento; continua podendo ser concluída', () => {
        expect(situacaoTarefa(linha(), ctx('2026-11-14'))).toBe('atrasada');
    });
    it('RN-CORE-TAR-02: feita no prazo = data local da conclusão ≤ prazo', () => {
        // 23h30 de 13/11 em Manaus = 03h30 de 14/11 em UTC: ainda no prazo.
        expect(situacaoTarefa(linha({ concluida_em: '2026-11-14T03:30:00.000Z' }), ctx('2026-11-20'))).toBe('feita_no_prazo');
    });
    it('RN-CORE-TAR-02: feita com atraso = data local da conclusão > prazo', () => {
        expect(situacaoTarefa(linha({ concluida_em: '2026-11-14T04:30:00.000Z' }), ctx('2026-11-20'))).toBe('feita_com_atraso');
    });
    it('RN-CORE-TAR-08: cancelada sai das abertas', () => {
        expect(situacaoTarefa(linha({ cancelada_em: '2026-11-12T15:00:00Z' }), ctx('2026-11-20'))).toBe('cancelada');
    });
    it('RN-CORE-TAR-08: conclusão que chegou depois do cancelamento não conta (fica cancelada)', () => {
        const l = linha({ cancelada_em: '2026-11-12T15:00:00Z', concluida_em: '2026-11-12T14:00:00Z', recebida_em: '2026-11-12T16:00:00Z' });
        expect(situacaoTarefa(l, ctx('2026-11-20'))).toBe('cancelada');
    });
    it('RN-CORE-TAR-08: conclusão recebida antes do cancelamento continua feita', () => {
        const l = linha({ cancelada_em: '2026-11-12T15:00:00Z', concluida_em: '2026-11-12T14:00:00Z', recebida_em: '2026-11-12T14:01:00Z' });
        expect(situacaoTarefa(l, ctx('2026-11-20'))).toBe('feita_no_prazo');
    });
    it('RN-CORE-TAR-10: aberta de consultor desligado = sem consultor ativo (não conta como aberta nem atrasada)', () => {
        expect(situacaoTarefa(linha(), { ...ctx('2026-11-20'), consultor_ativo: false })).toBe('sem_consultor_ativo');
        expect(situacaoTarefa(linha({ concluida_em: '2026-11-13T12:00:00Z' }), { ...ctx('2026-11-20'), consultor_ativo: false })).toBe('feita_no_prazo');
    });
    it('RN-CORE-TAR-11: pesquisa aberta com o módulo desligado = sem módulo (não conta como atrasada)', () => {
        expect(situacaoTarefa(linha(), { ...ctx('2026-11-20'), modulo_ativo: false })).toBe('sem_modulo');
    });
    it('RN-CORE-TAR-02: hoje e prazo precisam ser datas civis válidas', () => {
        expect(() => situacaoTarefa(linha(), ctx('20/11/2026'))).toThrow(RangeError);
        expect(() => situacaoTarefa(linha({ prazo: '2026-02-30' }), ctx('2026-11-20'))).toThrow(RangeError);
    });
});
describe('RN-CORE-TAR-02/09: prazo na criação e na edição', () => {
    it('RN-CORE-TAR-02: hoje ou depois', () => {
        expect(prazoAceito('2026-11-13', '2026-11-13')).toBe(true);
        expect(prazoAceito('2026-12-01', '2026-11-13')).toBe(true);
        expect(prazoAceito('2026-11-12', '2026-11-13')).toBe(false);
    });
    it('RN-CORE-TAR-02: data inválida é erro de quem chama', () => {
        expect(() => prazoAceito('2026-11-31', '2026-11-13')).toThrow(RangeError);
    });
});
