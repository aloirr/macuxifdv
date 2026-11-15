import { describe, expect, it } from 'vitest';
import { buscaDosFiltrosMarcas, FILTROS_MARCAS_PADRAO, filtrosMarcasLigados, lerFiltrosMarcas, marcasParaCsv } from './marcas';

describe('BKO Marcas concorrentes (RN-CAT-13)', () => {
  it('RN-CAT-13: os filtros vão e voltam pela URL; o padrão (ativas, sem busca) não suja o endereço', () => {
    expect(lerFiltrosMarcas('')).toEqual({ situacao: 'ativas', q: '' });
    expect(lerFiltrosMarcas('?situacao=todas&q=freio')).toEqual({ situacao: 'todas', q: 'freio' });
    expect(lerFiltrosMarcas('?situacao=xpto')).toEqual({ situacao: 'ativas', q: '' });
    expect(buscaDosFiltrosMarcas({ situacao: 'ativas', q: '' })).toBe('');
    expect(buscaDosFiltrosMarcas({ situacao: 'inativas', q: ' freio ' })).toBe('?situacao=inativas&q=freio');
  });
  it('RN-CAT-13: o CSV usa ; e CRLF, protege fórmula e mostra situação e referências', () => {
    const csv = marcasParaCsv([
      { id: 'a', nome: '=Freio', ativo: false, external_id: null, referencias: 3 },
      { id: 'b', nome: 'Pneu; Max', ativo: true, external_id: 'X1', referencias: 0 },
    ]);
    expect(csv.startsWith('﻿Marca;Situação;Referências;Código no ERP\r\n')).toBe(true);
    expect(csv).toContain("'=Freio;Inativa;3;");
    expect(csv).toContain('"Pneu; Max";Ativa;0;X1');
  });
  it('RN-CAT-13: "Limpar filtros" só aparece com situação diferente de ativas ou busca com texto', () => {
    expect(filtrosMarcasLigados(FILTROS_MARCAS_PADRAO)).toBe(false);
    expect(filtrosMarcasLigados({ situacao: 'ativas', q: '   ' })).toBe(false);
    expect(filtrosMarcasLigados({ situacao: 'ativas', q: 'freio' })).toBe(true);
    expect(filtrosMarcasLigados({ situacao: 'todas', q: '' })).toBe(true);
    expect(filtrosMarcasLigados({ situacao: 'inativas', q: '' })).toBe(true);
  });
});
