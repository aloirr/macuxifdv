import { describe, expect, it } from 'vitest';
import { PARADO_MIN_PADRAO, RECADO_DO_DIA_PADRAO } from './inicio';
import { PARAMETROS_INICIO_PADRAO, parametrosInicioDasLinhas, validarParametrosInicio } from './inicio-parametros';

const ok = { dias_uteis_semana: [1, 2, 3, 4, 5], recado_do_dia_padrao: 'Vamos vender!', parado_min: 45 };

describe('RN-CORE-26: parâmetros do Início por tenant', () => {
  it('RN-CORE-26: sem linha vale o padrão (seg a sáb, "Bom trabalho hoje!", 60 min)', () => {
    expect(parametrosInicioDasLinhas([])).toEqual(PARAMETROS_INICIO_PADRAO);
    expect(PARAMETROS_INICIO_PADRAO).toEqual({ dias_uteis_semana: [1, 2, 3, 4, 5, 6], recado_do_dia_padrao: RECADO_DO_DIA_PADRAO, parado_min: PARADO_MIN_PADRAO });
  });
  it('RN-CORE-26: lê as três chaves do módulo core; removida, de outro módulo ou inválida cai no padrão, chave a chave', () => {
    const r = parametrosInicioDasLinhas([
      { modulo: 'core', chave: 'metas.dias_uteis_semana', valor: [1, 2, 3, 4, 5] },
      { modulo: 'core', chave: 'inicio.recado_do_dia_padrao', valor: '  Vamos vender!  ' },
      { modulo: 'core', chave: 'inicio.parado_min', valor: 'x' },
      { modulo: 'vendedor', chave: 'inicio.parado_min', valor: 20 },
    ]);
    expect(r).toEqual({ dias_uteis_semana: [1, 2, 3, 4, 5], recado_do_dia_padrao: 'Vamos vender!', parado_min: 60 });
    expect(parametrosInicioDasLinhas([{ modulo: 'core', chave: 'inicio.parado_min', valor: 20, deleted_at: '2026-11-01T00:00:00Z' }]).parado_min).toBe(60);
  });
  it('RN-CORE-26: entrada válida é normalizada (dias sem repetição e em ordem, texto aparado)', () => {
    const r = validarParametrosInicio({ ...ok, dias_uteis_semana: [5, 1, 1, 3], recado_do_dia_padrao: '  Vamos vender!  ' });
    expect(r).toEqual({ ok: true, valores: { dias_uteis_semana: [1, 3, 5], recado_do_dia_padrao: 'Vamos vender!', parado_min: 45 } });
  });
  it('RN-CORE-26: semana sem nenhum dia útil, dia fora de 0 a 6 ou fracionado é recusada com a ação seguinte', () => {
    for (const dias of [[], [7], [-1], [1.5]]) {
      const r = validarParametrosInicio({ ...ok, dias_uteis_semana: dias });
      expect(r.ok, JSON.stringify(dias)).toBe(false);
      if (!r.ok) expect(r.erros).toEqual([{ campo: 'dias_uteis_semana', mensagem: expect.stringMatching(/dia/i) }]);
    }
  });
  it('RN-CORE-26: recado padrão vazio volta ao padrão do sistema; acima de 140 caracteres é recusado', () => {
    const vazio = validarParametrosInicio({ ...ok, recado_do_dia_padrao: '   ' });
    expect(vazio).toMatchObject({ ok: true, valores: { recado_do_dia_padrao: RECADO_DO_DIA_PADRAO } });
    expect(validarParametrosInicio({ ...ok, recado_do_dia_padrao: 'a'.repeat(141) })).toMatchObject({ ok: false, erros: [{ campo: 'recado_do_dia_padrao' }] });
    expect(validarParametrosInicio({ ...ok, recado_do_dia_padrao: 'a'.repeat(140) }).ok).toBe(true);
  });
  it('RN-CORE-26: parado_min aceita inteiro de 15 a 480; fora disso é recusado', () => {
    for (const n of [15, 60, 480]) expect(validarParametrosInicio({ ...ok, parado_min: n }).ok, String(n)).toBe(true);
    for (const n of [14, 481, 0, 30.5, Number.NaN]) expect(validarParametrosInicio({ ...ok, parado_min: n }), String(n)).toMatchObject({ ok: false, erros: [{ campo: 'parado_min' }] });
  });
  it('RN-CORE-26: cada erro leva a chave do campo (a tela liga por ela, não pela redação); vários erros juntos', () => {
    const r = validarParametrosInicio({ dias_uteis_semana: [], recado_do_dia_padrao: 'a'.repeat(141), parado_min: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.map((e) => e.campo)).toEqual(['dias_uteis_semana', 'recado_do_dia_padrao', 'parado_min']);
  });
});
