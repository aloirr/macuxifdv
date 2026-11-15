import { describe, expect, it } from 'vitest';
import { CODIGOS_CODIGO_FDV, formatarCodigoFdv, recusarCodigoFdvNoCorpo, validarCodigoFdv } from './codigo-fdv';
describe('RN-CORE-59: Código FDV (código próprio do Macuxi, gerado, só de leitura)', () => {
    it('RN-CORE-59: formata em 5 dígitos, sem prefixo, e cresce passando de 99999', () => {
        expect(formatarCodigoFdv(1)).toBe('00001');
        expect(formatarCodigoFdv(42)).toBe('00042');
        expect(formatarCodigoFdv(99999)).toBe('99999');
        expect(formatarCodigoFdv(100000)).toBe('100000');
        expect(formatarCodigoFdv(1234567)).toBe('1234567');
    });
    it('RN-CORE-59: o sequencial é inteiro a partir de 1; fora disso é erro', () => {
        for (const ruim of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
            expect(() => formatarCodigoFdv(ruim)).toThrow();
    });
    it('RN-CORE-59: valida o formato e devolve o sequencial', () => {
        expect(validarCodigoFdv('99999').ok).toBe(true);
        expect(validarCodigoFdv('00001')).toEqual({ ok: true, sequencial: 1, codigo: '00001' });
        expect(validarCodigoFdv('100000')).toEqual({ ok: true, sequencial: 100000, codigo: '100000' });
        for (const ruim of ['', '1', '0001', '00000', '000001', '0100000', 'FDV-0001', 'FDV-00001', '0000a', '00001 ', ' 00001', '1e5000']) {
            expect(validarCodigoFdv(ruim).ok, ruim).toBe(false);
        }
    });
    it('RN-CORE-59: o formato é redondo (formatar e validar se desfazem)', () => {
        for (const n of [1, 9, 10, 999, 9999, 10000, 99999, 100000, 1000000]) {
            const v = validarCodigoFdv(formatarCodigoFdv(n));
            expect(v.ok && v.sequencial).toBe(n);
        }
    });
    it('RN-CORE-59: criar ou editar com codigo_fdv no corpo é recusado (422), mesmo igual ao atual', () => {
        expect(recusarCodigoFdvNoCorpo({ nome: 'A' })).toBeNull();
        expect(recusarCodigoFdvNoCorpo({ codigo_fdv: undefined })).toBeNull();
        for (const valor of ['00001', null, '', 7]) {
            const e = recusarCodigoFdvNoCorpo({ codigo_fdv: valor });
            expect(e?.codigo).toBe(CODIGOS_CODIGO_FDV.somenteLeitura);
            expect(e?.campo).toBe('codigo_fdv');
            expect(e?.mensagem).toMatch(/gerado pelo sistema/);
        }
    });
});
