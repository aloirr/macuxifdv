import { describe, expect, it } from 'vitest';
import { PARAMETROS_RASTREAMENTO_PADRAO } from '../contracts';
import { podeRastrear, type EntradaRastreio } from './rastreamento';

// quinta-feira, 19/11/2026, 10h de Manaus (UTC−4) = 14h UTC
const base: EntradaRastreio = {
  ativo: true,
  expediente: PARAMETROS_RASTREAMENTO_PADRAO.expediente,
  feriados: [],
  ausencias: [],
  instante: '2026-11-19T14:00:00Z',
  fuso: 'America/Manaus',
};
const motivo = (o: Partial<EntradaRastreio>) => {
  const r = podeRastrear({ ...base, ...o });
  return r.pode ? 'pode' : r.motivo;
};

describe('RN-CORE-13: portão do rastreamento (podeRastrear, desenho tracking §2)', () => {
  it('RN-CORE-13: com as três condições valendo, rastreia', () => {
    expect(podeRastrear(base)).toEqual({ pode: true });
  });

  it('RN-CORE-13: empresa com o rastreamento desligado (padrão de fábrica)não rastreia', () => {
    expect(motivo({ ativo: false })).toBe('desligado');
  });

  it('RN-CORE-13: expediente no fuso do tenant: início entra, fim não; domingo sem expediente; sábado só de manhã', () => {
    expect(motivo({ instante: '2026-11-19T12:00:00Z' })).toBe('pode'); // 08:00 de Manaus
    expect(motivo({ instante: '2026-11-19T11:59:00Z' })).toBe('fora_do_expediente'); // 07:59
    expect(motivo({ instante: '2026-11-19T21:59:00Z' })).toBe('pode'); // 17:59
    expect(motivo({ instante: '2026-11-19T22:00:00Z' })).toBe('fora_do_expediente'); // 18:00
    expect(motivo({ instante: '2026-11-22T14:00:00Z' })).toBe('fora_do_expediente'); // domingo
    expect(motivo({ instante: '2026-11-21T15:59:00Z' })).toBe('pode'); // sábado 11:59
    expect(motivo({ instante: '2026-11-21T16:00:00Z' })).toBe('fora_do_expediente'); // sábado 12:00
    // 01h UTC de sexta ainda é quinta 21h em Manaus: fora
    expect(motivo({ instante: '2026-11-20T01:00:00Z' })).toBe('fora_do_expediente');
  });

  it('RN-CORE-13: feriado do tenant ou nacional e ausência cadastrada fecham o dia inteiro', () => {
    expect(motivo({ feriados: ['2026-11-19'] })).toBe('feriado');
    expect(motivo({ instante: '2026-11-20T14:00:00Z' })).toBe('feriado'); // 20/11, Consciência Negra (nacional)
    expect(motivo({ ausencias: [{ de: '2026-11-18', ate: '2026-11-19' }] })).toBe('ausencia');
    expect(motivo({ ausencias: [{ de: '2026-11-20', ate: '2026-11-30' }] })).toBe('pode');
  });

  it('RN-CORE-13: o portão tem só 3 condições; cargo, app e permissão não são entrada', () => {
    expect(Object.keys(base).sort()).toEqual(['ativo', 'ausencias', 'expediente', 'feriados', 'fuso', 'instante']);
    expect(motivo({ ativo: false, feriados: ['2026-11-19'] })).toBe('desligado');
  });
});
