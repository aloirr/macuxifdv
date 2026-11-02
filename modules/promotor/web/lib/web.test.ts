import { describe, expect, it } from 'vitest';
import { CSV_BOM, csvCelula, rupturaCsv, shareCsv } from './csv';
import { lerFiltrosTrade, paraBuscaTrade, paraQueryTrade } from './filtros';

const LOJA = '00000000-0000-4000-8000-0000000000c1';
const CAT = '00000000-0000-4000-8000-0000000000e1';

describe('filtros do BKO de trade na URL', () => {
  it('lê período e loja válidos e ignora o resto', () => {
    expect(lerFiltrosTrade(`?de=2026-10-01&ate=2026-10-31&loja=${LOJA}&x=1`)).toEqual({ de: '2026-10-01', ate: '2026-10-31', cliente_id: LOJA });
    expect(lerFiltrosTrade('?de=ontem&loja=abc')).toEqual({});
    expect(lerFiltrosTrade('?de=2026-11-05&ate=2026-11-01')).toEqual({ de: '2026-11-05' });
  });

  it('ida e volta URL ↔ filtros ↔ query da API', () => {
    const f = { de: '2026-10-01', cliente_id: LOJA };
    expect(lerFiltrosTrade(paraBuscaTrade(f))).toEqual(f);
    expect(paraBuscaTrade({})).toBe('');
    expect(paraQueryTrade(f)).toEqual({ de: '2026-10-01', cliente_id: LOJA });
  });
});

describe('CSV do BKO de trade', () => {
  it('célula com ; ou aspas vai entre aspas; número com vírgula decimal', () => {
    expect(csvCelula('A;B')).toBe('"A;B"');
    expect(csvCelula('diz "oi"')).toBe('"diz ""oi"""');
    expect(csvCelula(83.33)).toBe('83,33');
    expect(csvCelula(null)).toBe('');
  });

  it('share × meta e ruptura por loja, com BOM e CRLF', () => {
    const s = shareCsv({
      de: '2026-10-05',
      ate: '2026-11-03',
      resumo: { share_medio_pct: 30, meta_media_pct: 40, atingimento_pct: 75, categorias_medidas: 1 },
      linhas: [{ cliente_id: LOJA, cliente_nome: 'Mercado; Centro', categoria_gondola_id: CAT, categoria_nome: null, share_pct: 30, meta_pct: 40, atingimento_pct: 75, desvio_pp: -10, situacao: 'abaixo', medido_em: '2026-11-03T13:05:00.000Z' }],
    });
    expect(s.startsWith(CSV_BOM)).toBe(true);
    expect(s.split('\r\n')[1]).toBe(`"Mercado; Centro";${CAT};30;40;75;-10;Abaixo da meta;2026-11-03T13:05:00.000Z`);
    const r = rupturaCsv({
      de: '2026-10-05',
      ate: '2026-11-03',
      linhas: [{ cliente_id: LOJA, cliente_nome: null, visita_loja_id: CAT, checkin_em: '2026-11-03T13:00:00.000Z', total: 10, presentes: 7, ruptura_gondola: 1, ruptura_total: 2, em_ruptura: 3, ruptura_pct: 30, falha_reposicao_pct: 10, ruptura_total_pct: 20, quantidade_reposta: 4 }],
    });
    expect(r.split('\r\n')[1]).toBe(`${LOJA};10;7;1;2;30;10;20;4;2026-11-03T13:00:00.000Z`);
  });
});
