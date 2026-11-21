import { describe, expect, it } from 'vitest';
import { PARAMETROS_PADRAO } from './parametros';
import { parametrosEmUso } from './parametros-em-uso';

describe('parâmetros em uso (RN-TRE-02)', () => {
  it('RN-TRE-02: valores válidos do tenant valem e o fuso informado prevalece', () => {
    const r = parametrosEmUso({ nota_minima_pct: 80, xp_licao: 20 }, 'America/Sao_Paulo');
    expect(r.invalidos).toEqual([]);
    expect(r.parametros).toMatchObject({ nota_minima_pct: 80, xp_licao: 20, fuso: 'America/Sao_Paulo' });
  });
  it('RN-TRE-02: tipo errado em uma chave põe o padrão em todas (nota_minima_pct "x" com xp_licao 20)', () => {
    const r = parametrosEmUso({ nota_minima_pct: 'x', xp_licao: 20 });
    expect(r.parametros).toEqual(PARAMETROS_PADRAO);
    expect(r.invalidos).toContain('nota_minima_pct');
  });
  it('RN-TRE-02: xp_licao -1 e nota_minima_pct 150 caem no padrão em todos', () => {
    expect(parametrosEmUso({ xp_licao: -1, nota_minima_pct: 80 }).parametros).toEqual(PARAMETROS_PADRAO);
    expect(parametrosEmUso({ nota_minima_pct: 150 }).parametros).toEqual(PARAMETROS_PADRAO);
  });
  it('RN-TRE-02: ausente ou vazio = padrão; fuso inválido não derruba', () => {
    expect(parametrosEmUso({}).parametros).toEqual(PARAMETROS_PADRAO);
    expect(parametrosEmUso(undefined).parametros).toEqual(PARAMETROS_PADRAO);
    expect(parametrosEmUso({ xp_licao: 20 }, 'Fuso/Inexistente').parametros).toEqual(PARAMETROS_PADRAO);
  });
});
