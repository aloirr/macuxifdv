import { describe, expect, it } from 'vitest';
import { PARAMETROS_RASTREAMENTO_PADRAO } from '../../contracts';
import { dataCivilBr, lerExpedienteTexto, lerFrequenciaTexto, textosDaFrequencia, textosDoExpediente } from './rastreamento';

describe('RN-CORE-13: expediente do rastreamento digitado no BKO', () => {
  it('RN-CORE-13: o padrão vai para texto e volta igual', () => {
    const t = textosDoExpediente(PARAMETROS_RASTREAMENTO_PADRAO.expediente);
    expect(t['1']).toEqual([{ inicio: '08:00', fim: '18:00' }, { inicio: '', fim: '' }]);
    expect(t['0']).toEqual([{ inicio: '', fim: '' }, { inicio: '', fim: '' }]);
    expect(lerExpedienteTexto(t)).toEqual({ ok: true, expediente: PARAMETROS_RASTREAMENTO_PADRAO.expediente });
  });
  it('RN-CORE-13: duas faixas no dia valem; a 2ª depois do fim da 1ª', () => {
    const t = textosDoExpediente(PARAMETROS_RASTREAMENTO_PADRAO.expediente);
    t['1'] = [{ inicio: '08:00', fim: '12:00' }, { inicio: '14:00', fim: '18:00' }];
    const r = lerExpedienteTexto(t);
    expect(r.ok && r.expediente['1']).toEqual([{ inicio_min: 480, fim_min: 720 }, { inicio_min: 840, fim_min: 1080 }]);
    t['1'][1] = { inicio: '11:00', fim: '18:00' };
    expect(lerExpedienteTexto(t)).toEqual({ ok: false, erros: { '1.1': 'A 2ª faixa começa depois do fim da 1ª.' } });
  });
  it('RN-CORE-13: horário inválido, fim antes do início e 2ª faixa sem a 1ª dão erro na faixa', () => {
    const t = textosDoExpediente(PARAMETROS_RASTREAMENTO_PADRAO.expediente);
    t['2'][0] = { inicio: '8h', fim: '18:00' };
    t['3'][0] = { inicio: '18:00', fim: '08:00' };
    t['4'] = [{ inicio: '', fim: '' }, { inicio: '14:00', fim: '18:00' }];
    const r = lerExpedienteTexto(t);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erros).sort()).toEqual(['2.0', '3.0', '4.1']);
  });
});

describe('RN-CORE-13: frequência da captura', () => {
  it('RN-CORE-13: valores dentro da faixa passam', () => {
    expect(lerFrequenciaTexto(textosDaFrequencia(PARAMETROS_RASTREAMENTO_PADRAO.frequencia))).toEqual({ ok: true, frequencia: PARAMETROS_RASTREAMENTO_PADRAO.frequencia });
  });
  it('RN-CORE-13: fora da faixa ou não inteiro dá erro no campo', () => {
    const r = lerFrequenciaTexto({ distancia_m: '10', intervalo_min: '5,5', lote_min: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erros).sort()).toEqual(['distancia_m', 'intervalo_min', 'lote_min']);
  });
  it('data civil em dd/mm/aaaa', () => {
    expect(dataCivilBr('2026-11-19')).toBe('19/11/2026');
  });
});
