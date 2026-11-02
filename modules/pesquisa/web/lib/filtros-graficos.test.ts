import { describe, expect, it } from 'vitest';
import type { ResultadoPergunta } from '../../contracts';
import { lerFiltrosLista, lerFiltrosResultado, paraBusca, queryDoResultado } from './filtros-url';
import { barrasDaPergunta, resumoDaPergunta, textoTaxa } from './graficos';

const U = '00000000-0000-4000-8000-000000000001';

describe('BKO: filtros da Pesquisa na URL', () => {
  it('lista: situação válida e busca; o resto é ignorado', () => {
    expect(lerFiltrosLista('?situacao=publicada&q=%20gondola%20')).toEqual({ situacao: 'publicada', q: 'gondola' });
    expect(lerFiltrosLista('?situacao=xpto')).toEqual({});
  });

  it('RF-PES-06: resultados — período inválido ou invertido, versão e equipes que não são UUID são ignorados', () => {
    expect(lerFiltrosResultado(`?id=${U}&de=2026-10-01&ate=2026-10-31&versao=${U}&equipes=${U},abc`)).toEqual({ id: U, de: '2026-10-01', ate: '2026-10-31', versao: U, equipes: [U] });
    expect(lerFiltrosResultado('?de=2026-10-31&ate=2026-10-01')).toEqual({ de: '2026-10-31' });
    expect(lerFiltrosResultado('?id=1&de=31/10/2026')).toEqual({});
  });

  it('URL e query da API só com o que foi preenchido', () => {
    expect(paraBusca({ id: U, de: '2026-10-01', ate: undefined, equipes: [] })).toBe(`?id=${U}&de=2026-10-01`);
    expect(paraBusca({})).toBe('');
    expect(queryDoResultado({ de: '2026-10-01', equipes: [U] })).toEqual({ de: '2026-10-01', ate: undefined, versao: undefined, equipes: U });
  });
});

describe('RF-PES-06: gráficos por pergunta', () => {
  const comum = { pergunta_id: U, enunciado: 'P', respondentes: 4, pct_das_respostas: 100 };
  it('RF-PES-06: opções viram barras com contagem e %; escala usa a distribuição', () => {
    const sn: ResultadoPergunta = { ...comum, tipo: 'sim_nao', opcoes: [{ opcao_id: 'sim', rotulo: 'Sim', contagem: 3, pct: 75 }, { opcao_id: 'nao', rotulo: 'Não', contagem: 1, pct: 25 }] };
    expect(barrasDaPergunta(sn)).toEqual([{ rotulo: 'Sim', contagem: 3, pct: 75 }, { rotulo: 'Não', contagem: 1, pct: 25 }]);
    const esc: ResultadoPergunta = { ...comum, tipo: 'escala', media: 3.5, minimo: 1, maximo: 5, distribuicao: [{ valor: 1, contagem: 1 }, { valor: 5, contagem: 3 }] };
    expect(barrasDaPergunta(esc)).toEqual([{ rotulo: '1', contagem: 1, pct: 25 }, { rotulo: '5', contagem: 3, pct: 75 }]);
    expect(resumoDaPergunta(esc)).toBe('4 respostas · média 3,5 · mín. 1 · máx. 5');
  });

  it('RF-PES-06: foto, data e código têm resumo em texto; taxa sem público vira travessão', () => {
    expect(resumoDaPergunta({ ...comum, respondentes: 1, tipo: 'foto', total_fotos: 2 })).toBe('1 resposta · 2 fotos');
    expect(resumoDaPergunta({ ...comum, tipo: 'data', mais_antiga: '2026-10-01', mais_recente: '2026-10-31' })).toBe('4 respostas · de 01/10/2026 a 31/10/2026');
    expect(textoTaxa(null)).toBe('—');
    expect(textoTaxa(50)).toBe('50%');
  });
});
