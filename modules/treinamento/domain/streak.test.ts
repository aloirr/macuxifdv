import { describe, expect, it } from 'vitest';
import { atividadesQueContam, diasComAtividade, maiorSequencia, sequenciaAtual, sequenciaNaData } from './streak';

describe('RF-TRE-03: streak (dias consecutivos com atividade, no fuso do tenant)', () => {
  it('RF-TRE-03: atividade perto da meia-noite UTC cai no dia do fuso do tenant (Manaus, UTC−4)', () => {
    // 01/11 02:00Z = 31/10 22:00 em Manaus; 01/11 04:30Z = 01/11 00:30 em Manaus.
    expect(diasComAtividade(['2026-11-01T02:00:00Z', '2026-11-01T04:30:00Z', '2026-11-01T05:00:00Z'])).toEqual(['2026-10-31', '2026-11-01']);
  });

  it('RF-TRE-03: várias atividades no mesmo dia contam um dia só; resultado ordenado', () => {
    expect(diasComAtividade(['2026-10-31T15:00:00Z', '2026-10-30T15:00:00Z', '2026-10-31T13:00:00Z'])).toEqual(['2026-10-30', '2026-10-31']);
  });

  it('RF-TRE-03: respeita o fuso informado', () => {
    expect(diasComAtividade(['2026-11-01T02:00:00Z'], 'UTC')).toEqual(['2026-11-01']);
  });

  it('RN-TRE-01: sequência na data = dias consecutivos terminando nela (3 dias seguidos = 3)', () => {
    const dias = ['2026-10-28', '2026-10-30', '2026-10-31', '2026-11-01'];
    expect(sequenciaNaData(dias, '2026-11-01')).toBe(3);
    expect(sequenciaNaData(dias, '2026-10-30')).toBe(1);
    expect(sequenciaNaData(dias, '2026-10-29')).toBe(0);
  });

  it('RF-TRE-03: sequência atual com atividade hoje', () => {
    expect(sequenciaAtual(['2026-10-30', '2026-10-31'], '2026-10-31')).toEqual({ dias: 2, ativa_hoje: true, em_risco: false });
  });

  it('RF-TRE-03: sem atividade hoje mas com ontem, a sequência segue viva e "em risco"', () => {
    expect(sequenciaAtual(['2026-10-29', '2026-10-30'], '2026-10-31')).toEqual({ dias: 2, ativa_hoje: false, em_risco: true });
  });

  it('RF-TRE-03: parou há 2 dias ou mais, a sequência zera', () => {
    expect(sequenciaAtual(['2026-10-28'], '2026-10-31')).toEqual({ dias: 0, ativa_hoje: false, em_risco: false });
    expect(sequenciaAtual([], '2026-10-31')).toEqual({ dias: 0, ativa_hoje: false, em_risco: false });
  });

  it('RF-TRE-03: sequência atravessa mês e ano', () => {
    expect(sequenciaNaData(['2025-12-30', '2025-12-31', '2026-01-01'], '2026-01-01')).toBe(3);
  });

  it('RF-TRE-03: maior sequência histórica (base da medalha de sequência)', () => {
    expect(maiorSequencia(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-10', '2026-10-11'])).toBe(3);
    expect(maiorSequencia([])).toBe(0);
  });
});

describe('Ajuste B: o streak só conta lição concluída ou quiz respondido até o fim', () => {
  it('RN-TRE-01: lição concluída e quiz finalizado contam; abrir e abandonar não', () => {
    const registros = [
      { tipo: 'licao_concluida', em: '2026-10-29T13:00:00Z' },
      { tipo: 'quiz_finalizado', em: '2026-10-30T13:00:00Z' },
      { tipo: 'licao_aberta', em: '2026-10-31T13:00:00Z' },
      { tipo: 'quiz_iniciado', em: '2026-10-31T14:00:00Z' },
      { tipo: 'quiz_abandonado', em: '2026-10-31T15:00:00Z' },
    ] as const;
    expect(atividadesQueContam(registros)).toEqual(['2026-10-29T13:00:00Z', '2026-10-30T13:00:00Z']);
  });

  it('RN-TRE-01: dia só com quiz abandonado quebra a sequência (abrir e sair não mantém o streak)', () => {
    const contam = atividadesQueContam([
      { tipo: 'licao_concluida', em: '2026-10-29T13:00:00Z' },
      { tipo: 'licao_concluida', em: '2026-10-30T13:00:00Z' },
      { tipo: 'quiz_abandonado', em: '2026-10-31T13:00:00Z' },
    ]);
    const dias = diasComAtividade(contam);
    expect(sequenciaAtual(dias, '2026-10-31')).toEqual({ dias: 2, ativa_hoje: false, em_risco: true });
  });

  it('RN-TRE-01: tipo de atividade desconhecido não conta (padrão seguro)', () => {
    expect(atividadesQueContam([{ tipo: 'qualquer_coisa', em: '2026-10-31T13:00:00Z' }])).toEqual([]);
  });
});
