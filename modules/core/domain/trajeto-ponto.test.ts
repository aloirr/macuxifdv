import { describe, expect, it } from 'vitest';
import { PARAMETROS_RASTREAMENTO_PADRAO } from '../contracts';
import { parametrosRastreamentoDasLinhas, feriadosDasLinhas, triarPontoRecebido, type BaseTriagem } from './trajeto-ponto';

const AGORA = '2026-11-19T14:30:00Z'; // quinta, 10h30 de Manaus
const base: BaseTriagem = {
  ativo: true,
  cargo: 'vendedor',
  app: 'campo',
  expediente: PARAMETROS_RASTREAMENTO_PADRAO.expediente,
  feriados: [],
  ausencias: [],
  fuso: 'America/Manaus',
};
const ponto = (o: Partial<{ capturado_em: string; latitude: number; longitude: number }> = {}) => ({ capturado_em: '2026-11-19T14:00:00Z', latitude: -3.1, longitude: -60.0, ...o });
const motivo = (p = ponto(), b: Partial<BaseTriagem> = {}) => triarPontoRecebido(p, AGORA, { ...base, ...b });

describe('RN-CORE-13: triagem do ponto que chega no push (a API sempre revalida)', () => {
  it('RN-CORE-13: ponto dentro do portão é aceito', () => {
    expect(motivo()).toBeNull();
  });
  it('RN-CORE-13: cada condição de cadastro descarta o ponto', () => {
    expect(motivo(ponto(), { ativo: false })).toBe('desligado');
    expect(motivo(ponto(), { cargo: 'gerente' })).toBe('cargo');
    expect(motivo(ponto(), { feriados: ['2026-11-19'] })).toBe('feriado');
    expect(motivo(ponto(), { ausencias: [{ de: '2026-11-18', ate: '2026-11-20' }] })).toBe('ausencia');
    expect(motivo(ponto({ capturado_em: '2026-11-19T13:00:00Z' }), { expediente: { ...base.expediente, '4': [{ inicio_min: 600, fim_min: 700 }] } })).toBe('fora_do_expediente');
  });
  it('RN-CORE-13: mais de 5 minutos no futuro ou mais de 90 dias atrás é descartado', () => {
    expect(motivo(ponto({ capturado_em: '2026-11-19T14:34:00Z' }))).toBeNull();
    expect(motivo(ponto({ capturado_em: '2026-11-19T14:36:00Z' }))).toBe('futuro');
    expect(motivo(ponto({ capturado_em: '2026-08-21T15:00:00Z' }))).toBeNull();
    expect(motivo(ponto({ capturado_em: '2026-08-21T14:00:00Z' }))).toBe('antigo');
  });
  it('RN-CORE-13: coordenada inválida é descartada', () => {
    expect(motivo(ponto({ latitude: Number.NaN }))).toBe('coordenada');
    expect(motivo(ponto({ longitude: 181 }))).toBe('coordenada');
  });
});

describe('RN-CORE-13: parâmetros do rastreamento lidos do tenant', () => {
  it('RN-CORE-13: sem linha ou com valor inválido, fica desligado (padrão de fábrica)', () => {
    expect(parametrosRastreamentoDasLinhas([])).toEqual(PARAMETROS_RASTREAMENTO_PADRAO);
    expect(parametrosRastreamentoDasLinhas([{ modulo: 'core', chave: 'rastreamento', valor: { ativo: true } }]).ativo).toBe(false);
  });
  it('RN-CORE-13: valor válido vale', () => {
    const v = { ...PARAMETROS_RASTREAMENTO_PADRAO, ativo: true };
    expect(parametrosRastreamentoDasLinhas([{ modulo: 'core', chave: 'rastreamento', valor: v }])).toEqual(v);
  });
  it('feriados do tenant: só datas AAAA-MM-DD', () => {
    expect(feriadosDasLinhas([{ modulo: 'core', chave: 'metas.feriados', valor: ['2026-12-25', 'x', 3] }])).toEqual(['2026-12-25']);
    expect(feriadosDasLinhas([])).toEqual([]);
  });
});
