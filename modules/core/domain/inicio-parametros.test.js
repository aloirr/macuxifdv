import { describe, expect, it } from 'vitest';
import { PARADO_MIN_PADRAO } from './inicio';
import { PARAMETROS_INICIO_PADRAO, parametrosInicioDasLinhas, validarParametrosInicio } from './inicio-parametros';
const ok = { dias_uteis_semana: [1, 2, 3, 4, 5] };
describe('RN-CORE-26: parâmetros do Início por tenant', () => {
    it('RN-CORE-26: sem linha vale o padrão (seg a sáb, 60 min)', () => {
        expect(parametrosInicioDasLinhas([])).toEqual(PARAMETROS_INICIO_PADRAO);
        expect(PARAMETROS_INICIO_PADRAO).toEqual({ dias_uteis_semana: [1, 2, 3, 4, 5, 6], parado_min: PARADO_MIN_PADRAO });
    });
    it('RN-CORE-26: lê as duas chaves do módulo core (D2: sem inicio.recado_do_dia_padrao); removida, de outro módulo ou inválida cai no padrão, chave a chave', () => {
        const r = parametrosInicioDasLinhas([
            { modulo: 'core', chave: 'metas.dias_uteis_semana', valor: [1, 2, 3, 4, 5] },
            { modulo: 'core', chave: 'inicio.recado_do_dia_padrao', valor: 'Linha antiga, ignorada' },
            { modulo: 'core', chave: 'inicio.parado_min', valor: 'x' },
            { modulo: 'vendedor', chave: 'inicio.parado_min', valor: 20 },
        ]);
        expect(r).toEqual({ dias_uteis_semana: [1, 2, 3, 4, 5], parado_min: 60 });
        expect(parametrosInicioDasLinhas([{ modulo: 'core', chave: 'inicio.parado_min', valor: 20, deleted_at: '2026-11-01T00:00:00Z' }]).parado_min).toBe(60);
    });
    it('RN-CORE-26: entrada válida é normalizada (dias sem repetição e em ordem)', () => {
        const r = validarParametrosInicio({ ...ok, dias_uteis_semana: [5, 1, 1, 3] });
        expect(r).toEqual({ ok: true, valores: { dias_uteis_semana: [1, 3, 5] } });
    });
    it('RN-CORE-26: semana sem nenhum dia útil, dia fora de 0 a 6 ou fracionado é recusada com a ação seguinte', () => {
        for (const dias of [[], [7], [-1], [1.5]]) {
            const r = validarParametrosInicio({ ...ok, dias_uteis_semana: dias });
            expect(r.ok, JSON.stringify(dias)).toBe(false);
            if (!r.ok)
                expect(r.erros).toEqual([{ campo: 'dias_uteis_semana', mensagem: expect.stringMatching(/dia/i) }]);
        }
    });
    it('RN-CORE-26: cada erro leva a chave do campo (a tela liga por ela, não pela redação)', () => {
        const r = validarParametrosInicio({ dias_uteis_semana: [] });
        expect(r.ok).toBe(false);
        if (!r.ok)
            expect(r.erros.map((e) => e.campo)).toEqual(['dias_uteis_semana']);
    });
});
