import { describe, expect, it } from 'vitest';
import { minutoDoTextoHora, textoDoMinuto } from '../contracts/jornada';
import { almocoDoUsuario, almocoPadraoDasLinhas, rotuloDoAlmoco, validarAlmocoDoUsuario, validarHorarioAlmoco } from './jornada';

const PADRAO = { inicio_min: 720, fim_min: 780 };

describe('RN-CORE-44 (D5): horário de almoço', () => {
  it('RN-CORE-44: o padrão da empresa é 12:00 às 13:00 quando o parâmetro não existe ou é inválido', () => {
    expect(almocoPadraoDasLinhas([])).toEqual(PADRAO);
    expect(almocoPadraoDasLinhas([{ modulo: 'core', chave: 'jornada.almoco_padrao', valor: { inicio_min: 900, fim_min: 800 } }])).toEqual(PADRAO);
    expect(almocoPadraoDasLinhas([{ modulo: 'core', chave: 'jornada.almoco_padrao', valor: { inicio_min: 690, fim_min: 780 } }])).toEqual({ inicio_min: 690, fim_min: 780 });
    expect(almocoPadraoDasLinhas([{ modulo: 'core', chave: 'jornada.almoco_padrao', valor: { inicio_min: 690, fim_min: 780 }, deleted_at: '2026-01-01T00:00:00Z' }])).toEqual(PADRAO);
  });
  it('RN-CORE-44: o fim deve ser depois do início', () => {
    const r = validarHorarioAlmoco({ inicio_min: 780, fim_min: 720 });
    expect(r).toEqual({ ok: false, erros: [{ campo: 'almoco_fim', mensagem: 'O fim do almoço deve ser depois do início.' }] });
  });
  it('RN-CORE-44: a duração vai de 15 min a 3 h (limites valem)', () => {
    expect(validarHorarioAlmoco({ inicio_min: 720, fim_min: 734 }).ok).toBe(false);
    expect(validarHorarioAlmoco({ inicio_min: 720, fim_min: 735 }).ok).toBe(true);
    expect(validarHorarioAlmoco({ inicio_min: 720, fim_min: 900 }).ok).toBe(true);
    expect(validarHorarioAlmoco({ inicio_min: 720, fim_min: 901 }).ok).toBe(false);
  });
  it('RN-CORE-44: horário fora do dia ou não inteiro aponta o campo', () => {
    const r = validarHorarioAlmoco({ inicio_min: -1, fim_min: 1440 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.map((e) => e.campo)).toEqual(['almoco_inicio', 'almoco_fim']);
  });
  it('RN-CORE-44: todo usuário tem horário: o próprio ou o padrão (nulo ou um só campo = padrão)', () => {
    expect(almocoDoUsuario({ almoco_inicio_min: 690, almoco_fim_min: 750 }, PADRAO)).toEqual({ inicio_min: 690, fim_min: 750 });
    expect(almocoDoUsuario({ almoco_inicio_min: null, almoco_fim_min: null }, PADRAO)).toEqual(PADRAO);
    expect(almocoDoUsuario({ almoco_inicio_min: 690, almoco_fim_min: null }, PADRAO)).toEqual(PADRAO);
    expect(almocoDoUsuario(undefined, PADRAO)).toEqual(PADRAO);
  });
  it('RN-CORE-44: na edição do usuário os dois nulos valem (padrão); um só é erro no campo que falta', () => {
    expect(validarAlmocoDoUsuario({ almoco_inicio_min: null, almoco_fim_min: null })).toEqual([]);
    expect(validarAlmocoDoUsuario({ almoco_inicio_min: 690, almoco_fim_min: null })[0]?.campo).toBe('almoco_fim');
    expect(validarAlmocoDoUsuario({ almoco_inicio_min: null, almoco_fim_min: 750 })[0]?.campo).toBe('almoco_inicio');
    expect(validarAlmocoDoUsuario({ almoco_inicio_min: 690, almoco_fim_min: 750 })).toEqual([]);
  });
  it('texto das horas', () => {
    expect(textoDoMinuto(720)).toBe('12:00');
    expect(minutoDoTextoHora('7:05')).toBe(425);
    expect(minutoDoTextoHora('24:00')).toBeNull();
    expect(rotuloDoAlmoco(PADRAO)).toBe('12:00 às 13:00');
  });
});
