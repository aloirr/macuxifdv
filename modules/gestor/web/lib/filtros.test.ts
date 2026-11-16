import { describe, expect, it } from 'vitest';
import { lerFiltrosAlertas, lerFiltrosPainel, lerFiltrosRanking, paraQuery, queryAlertas } from './filtros';

const busca = (q: string) => new URLSearchParams(q);

describe('filtros do BKO do Gestor na URL', () => {
  it('lê data, indicador, período e status válidos', () => {
    expect(lerFiltrosPainel(busca('data=2026-11-03'))).toEqual({ data: '2026-11-03' });
    expect(lerFiltrosRanking(busca('indicador=cobertura_pct&periodo=semanal'))).toEqual({ indicador: 'cobertura_pct', periodo: 'semanal', data: null });
    expect(lerFiltrosAlertas(busca('status=dispensado'))).toEqual({ status: 'dispensado' });
  });

  it('valor inválido na URL cai no padrão (a página nunca quebra)', () => {
    expect(lerFiltrosPainel(busca('data=ontem'))).toEqual({ data: null });
    expect(lerFiltrosRanking(busca('indicador=lucro&periodo=anual'))).toEqual({ indicador: 'vendas_cents', periodo: 'mensal', data: null });
    expect(lerFiltrosAlertas(busca('status=x'))).toEqual({ status: null });
  });

  it('T-0180: a lista de alertas pede os alertas de produtividade (produtividade=1) junto com o filtro da URL', () => {
    expect(queryAlertas({ status: null })).toEqual({ produtividade: '1' });
    expect(queryAlertas({ status: 'dispensado' })).toEqual({ status: 'dispensado', produtividade: '1' });
  });

  it('a query sai sem os vazios', () => {
    expect(paraQuery({ indicador: 'pedidos', data: null, status: '' })).toEqual({ indicador: 'pedidos' });
  });
});
