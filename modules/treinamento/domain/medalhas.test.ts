import { describe, expect, it } from 'vitest';
import { avaliarMedalhas, MEDALHAS_PADRAO, medalhasPadrao, type EstadoMedalhas, type Medalha } from './medalhas';

const vazio: EstadoMedalhas = { trilhas_concluidas: 0, melhor_nota_pct: null, maior_sequencia_dias: 0 };

describe('RF-TRE-03: medalhas por regra', () => {
  it('RF-TRE-03: catálogo padrão tem primeira trilha, nota máxima e sequência de 7 dias', () => {
    expect(MEDALHAS_PADRAO.map((m) => m.codigo)).toEqual(['primeira_trilha', 'nota_maxima', 'sequencia_7_dias']);
  });

  it('RF-TRE-03: sem conquista nenhuma, nada é concedido', () => {
    expect(avaliarMedalhas(MEDALHAS_PADRAO, vazio, [])).toEqual([]);
  });

  it('RF-TRE-03: primeira trilha concluída concede a medalha', () => {
    expect(avaliarMedalhas(MEDALHAS_PADRAO, { ...vazio, trilhas_concluidas: 1 }, []).map((m) => m.codigo)).toEqual(['primeira_trilha']);
  });

  it('RF-TRE-03: nota máxima exige 100 no quiz (99,99 não vale)', () => {
    expect(avaliarMedalhas(MEDALHAS_PADRAO, { ...vazio, melhor_nota_pct: 99.99 }, [])).toEqual([]);
    expect(avaliarMedalhas(MEDALHAS_PADRAO, { ...vazio, melhor_nota_pct: 100 }, []).map((m) => m.codigo)).toEqual(['nota_maxima']);
  });

  it('RF-TRE-03: sequência de 7 dias concede só com 7 ou mais', () => {
    expect(avaliarMedalhas(MEDALHAS_PADRAO, { ...vazio, maior_sequencia_dias: 6 }, [])).toEqual([]);
    expect(avaliarMedalhas(MEDALHAS_PADRAO, { ...vazio, maior_sequencia_dias: 7 }, []).map((m) => m.codigo)).toEqual(['sequencia_7_dias']);
  });

  it('RF-TRE-03: não concede em duplicidade — o que o usuário já tem fica de fora', () => {
    const estado: EstadoMedalhas = { trilhas_concluidas: 3, melhor_nota_pct: 100, maior_sequencia_dias: 10 };
    expect(avaliarMedalhas(MEDALHAS_PADRAO, estado, ['primeira_trilha']).map((m) => m.codigo)).toEqual(['nota_maxima', 'sequencia_7_dias']);
    expect(avaliarMedalhas(MEDALHAS_PADRAO, estado, new Set(['primeira_trilha', 'nota_maxima', 'sequencia_7_dias']))).toEqual([]);
  });

  it('RF-TRE-03: catálogo do tenant com sequência de 30 dias e de N trilhas', () => {
    const catalogo: Medalha[] = [
      { codigo: 'sequencia_30', nome: 'Um mês seguido', regra: { tipo: 'sequencia_dias', dias: 30 } },
      { codigo: 'tres_trilhas', nome: 'Trilheiro', regra: { tipo: 'trilhas_concluidas', quantidade: 3 } },
    ];
    expect(avaliarMedalhas(catalogo, { trilhas_concluidas: 3, melhor_nota_pct: null, maior_sequencia_dias: 29 }, []).map((m) => m.codigo)).toEqual(['tres_trilhas']);
    expect(avaliarMedalhas(catalogo, { trilhas_concluidas: 3, melhor_nota_pct: null, maior_sequencia_dias: 30 }, []).map((m) => m.codigo)).toEqual(['sequencia_30', 'tres_trilhas']);
  });

  it('RF-TRE-03: o tenant troca o N da sequência (streak_medalha_dias) e o código acompanha', () => {
    const catalogo = medalhasPadrao(3);
    expect(catalogo.map((m) => m.codigo)).toEqual(['primeira_trilha', 'nota_maxima', 'sequencia_3_dias']);
    expect(avaliarMedalhas(catalogo, { ...vazio, maior_sequencia_dias: 3 }, []).map((m) => m.codigo)).toEqual(['sequencia_3_dias']);
  });
});
