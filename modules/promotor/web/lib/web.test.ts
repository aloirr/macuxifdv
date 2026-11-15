import { describe, expect, it } from 'vitest';
import { PARAMETROS_PADRAO } from '../../domain/parametros';
import { painelDeParametrosTrade } from './parametros-trade';
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

describe('Parâmetros › Trade (ADR 0058, só leitura)', () => {
  it('RN-PRO-08/RN-PRO-07/RN-PRO-04/RN-PRO-11: 3 painéis com os 5 parâmetros e sem "Padrão" quando o valor é o padrão', () => {
    const paineis = painelDeParametrosTrade({ ...PARAMETROS_PADRAO });
    expect(paineis.map((p) => [p.id, p.campos.map((c) => c.rotulo)])).toEqual([
      ['validade', ['Crítica até', 'Em atenção até']],
      ['visita-coleta', ['Permanência mínima', 'Variação de preço sem confirmar']],
      ['gondola', ['Peso do parcial na conformidade']],
    ]);
    expect(paineis.flatMap((p) => p.campos).map((c) => c.valor)).toEqual(['7 dias', '30 dias', '10 min', '50%', '0%']);
    expect(paineis.flatMap((p) => p.campos).some((c) => c.padrao)).toBe(false);
  });
  it('RN-PRO-08: "Padrão: X" só no parâmetro que difere (em atenção 45 dias)', () => {
    const campos = painelDeParametrosTrade({ ...PARAMETROS_PADRAO, validade_proxima_dias: 45, peso_parcial_conformidade: 0.5 }).flatMap((p) => p.campos);
    expect(campos.filter((c) => c.padrao).map((c) => [c.chave, c.valor, c.padrao])).toEqual([
      ['validade_proxima_dias', '45 dias', 'Padrão: 30 dias'],
      ['peso_parcial_conformidade', '50%', 'Padrão: 0%'],
    ]);
  });
});
