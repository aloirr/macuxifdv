import { describe, expect, it } from 'vitest';
import { decidirOrdemErp, decidirReativacaoDoErp, ehVersaoNovaDoErp } from './erp-ordem';
describe('guarda de ordem do ERP (T-0095, RN-INT-02/04)', () => {
    it('RN-INT-02: versão mais antiga que a aplicada (reentrega fora de ordem da outbox) é ignorada', () => {
        expect(decidirOrdemErp('2026-11-07T10:00:00Z', '2026-11-07T09:59:59Z')).toBe('ignorar_antigo');
    });
    it('RN-INT-02: versão mais nova vence e igual reaplica (idempotente)', () => {
        expect(decidirOrdemErp('2026-11-07T10:00:00Z', '2026-11-07T10:00:01Z')).toBe('aplicar');
        expect(decidirOrdemErp('2026-11-07T10:00:00Z', '2026-11-07T10:00:00.000Z')).toBe('aplicar');
    });
    it('RN-INT-02: sem versão aplicada ou sem data no evento, aplica', () => {
        expect(decidirOrdemErp(null, '2026-11-07T10:00:00Z')).toBe('aplicar');
        expect(decidirOrdemErp('2026-11-07T10:00:00Z', null)).toBe('aplicar');
        expect(decidirOrdemErp('2026-11-07T10:00:00Z', 'lixo')).toBe('aplicar');
    });
    it('RN-INT-02: instantes iguais em fusos diferentes não são antigos', () => {
        expect(decidirOrdemErp('2026-11-07T10:00:00Z', '2026-11-07T06:00:00-04:00')).toBe('aplicar');
    });
    it('RN-INT-02: vendedor desligado no BKO não é reativado pela carga do ERP e gera aviso', () => {
        expect(decidirReativacaoDoErp({ desligadoNoBkoEm: '2026-11-06T12:00:00Z', ativoNoErp: true })).toEqual({ ativo: false, avisar: true });
    });
    it('RN-INT-02: vendedor desligado no BKO e inativo no ERP segue desligado, sem aviso', () => {
        expect(decidirReativacaoDoErp({ desligadoNoBkoEm: '2026-11-06T12:00:00Z', ativoNoErp: false })).toEqual({ ativo: false, avisar: false });
    });
    it('RN-INT-02: vendedor não desligado no BKO acompanha o ERP', () => {
        expect(decidirReativacaoDoErp({ desligadoNoBkoEm: null, ativoNoErp: true })).toEqual({ ativo: true, avisar: false });
        expect(decidirReativacaoDoErp({ desligadoNoBkoEm: null, ativoNoErp: false })).toEqual({ ativo: false, avisar: false });
    });
    it('RN-INT-02: o aviso de desligado sai uma vez por versão do registro, não a cada carga (T-0095)', () => {
        const desligado = '2026-11-06T12:00:00Z';
        expect(ehVersaoNovaDoErp(null, '2026-11-07T10:00:00Z')).toBe(true);
        expect(ehVersaoNovaDoErp('2026-11-07T10:00:00Z', '2026-11-07T10:00:00.000Z')).toBe(false);
        expect(ehVersaoNovaDoErp('2026-11-07T10:00:00Z', '2026-11-07T10:00:01Z')).toBe(true);
        expect(ehVersaoNovaDoErp('2026-11-07T10:00:00Z', null)).toBe(false);
        expect(decidirReativacaoDoErp({ desligadoNoBkoEm: desligado, ativoNoErp: true, versaoNova: true })).toEqual({ ativo: false, avisar: true });
        expect(decidirReativacaoDoErp({ desligadoNoBkoEm: desligado, ativoNoErp: true, versaoNova: false })).toEqual({ ativo: false, avisar: false });
    });
});
