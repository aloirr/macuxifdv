import { describe, expect, it } from 'vitest';
import { PARAMETROS_PADRAO, resolverParametros } from './parametros';
describe('parâmetros do tenant da Pesquisa', () => {
    it('RN-PES-04: tolerância padrão de 24 h e fuso America/Manaus (doc 03, tabela de parâmetros)', () => {
        expect(PARAMETROS_PADRAO.tolerancia_vigencia_h).toBe(24);
        expect(PARAMETROS_PADRAO.fuso).toBe('America/Manaus');
    });
    it('RN-PES-06: foto até 1600 px no maior lado, JPEG qualidade 80, como parâmetros do tenant', () => {
        expect(PARAMETROS_PADRAO).toMatchObject({ foto_max_lado_px: 1600, foto_jpeg_qualidade: 80 });
        expect(resolverParametros({ foto_max_lado_px: 1280 }).foto_max_lado_px).toBe(1280);
    });
    it('RN-PES-07: limites do construtor (50 perguntas, 20 opções, 10 fotos, 2000 caracteres) são parâmetros do tenant', () => {
        expect(PARAMETROS_PADRAO).toMatchObject({ max_perguntas: 50, max_opcoes_por_pergunta: 20, max_fotos_por_pergunta: 10, texto_max_caracteres: 2000, escala_amplitude_max: 10 });
    });
    it('resolverParametros mistura o parcial com o padrão', () => {
        const p = resolverParametros({ tolerancia_vigencia_h: 48 });
        expect(p.tolerancia_vigencia_h).toBe(48);
        expect(p.max_perguntas).toBe(50);
    });
    it('RN-PES-04: tolerância negativa ou fracionada é recusada, em português', () => {
        expect(() => resolverParametros({ tolerancia_vigencia_h: -1 })).toThrow(/Parâmetro tolerancia_vigencia_h inválido/);
        expect(() => resolverParametros({ tolerancia_vigencia_h: 1.5 })).toThrow(/inválido/);
    });
    it('fuso inexistente é recusado', () => {
        expect(() => resolverParametros({ fuso: 'Marte/Olympus' })).toThrow(/Fuso horário inválido/);
    });
});
