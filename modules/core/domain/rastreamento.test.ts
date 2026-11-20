import { describe, expect, it } from 'vitest';
import { PARAMETROS_RASTREAMENTO_PADRAO } from '../contracts';
import { APP_RASTREADO_DO_CARGO, podeRastrear, type EntradaRastreio } from './rastreamento';

// quinta-feira, 19/11/2026, 10h de Manaus (UTC−4) = 14h UTC
const base: EntradaRastreio = {
  ativo: true,
  cargo: 'vendedor',
  app: 'campo',
  expediente: PARAMETROS_RASTREAMENTO_PADRAO.expediente,
  feriados: [],
  ausencias: [],
  permissao: true,
  instante: '2026-11-19T14:00:00Z',
  fuso: 'America/Manaus',
};
const motivo = (o: Partial<EntradaRastreio>) => {
  const r = podeRastrear({ ...base, ...o });
  return r.pode ? 'pode' : r.motivo;
};

describe('RN-CORE-13: portão do rastreamento (podeRastrear, desenho tracking §2)', () => {
  it('RN-CORE-13: com as sete condições valendo, rastreia', () => {
    expect(podeRastrear(base)).toEqual({ pode: true });
    expect(motivo({ cargo: 'promotor' })).toBe('pode');
  });

  it('RN-CORE-13: empresa com o rastreamento desligado (padrão de fábrica)não rastreia', () => {
    expect(motivo({ ativo: false })).toBe('desligado');
  });

  it('RN-CORE-13: só vendedor, promotor e supervisor são rastreados; os outros cargos não', () => {
    for (const cargo of ['gerente', 'analista', 'assistente', 'admin']) expect(motivo({ cargo })).toBe('cargo');
  });

  it('RN-CORE-13: cada cargo é rastreado no app dele (vendedor e promotor no Campo, supervisor no Gestão)', () => {
    expect(motivo({ cargo: 'supervisor', app: 'gestao' })).toBe('pode');
    expect(motivo({ cargo: 'supervisor', app: 'campo' })).toBe('app');
    expect(motivo({ cargo: 'vendedor', app: 'gestao' })).toBe('app');
    expect(APP_RASTREADO_DO_CARGO).toEqual({ vendedor: 'campo', promotor: 'campo', supervisor: 'gestao' });
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

  it('RN-CORE-37: sem a permissão "o tempo todo" o app não rastreia; a API não sabe da permissão e não a confere', () => {
    expect(motivo({ permissao: false })).toBe('sem_permissao');
    expect(motivo({ permissao: undefined })).toBe('pode');
  });
});
