import { describe, expect, it } from 'vitest';
import type { FormaPagamento, PrazoPagamento } from '../../contracts';
import { descricaoDoPrazo } from '../../domain/pagamento';
import { buscaDosFiltrosFormas, descricaoNaTabela, lerFiltrosFormas, linhasDePrazos, prazoEfetivamenteAtivo, prazosToCsv, diasDasParcelas, textoDoPrazoMedio } from './formas-pagamento';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const forma = (n: number, codigo: string, nome: string, o: Partial<FormaPagamento> = {}): FormaPagamento => ({ id: U(n), codigo, nome, ativo: true, ordem: n, external_id: `E${n}`, updated_at: '2026-11-06T00:00:00.000000Z', ...o });
const prazo = (n: number, formaId: string, codigo: string, parcelas: number[], medio: number, o: Partial<PrazoPagamento> = {}): PrazoPagamento => ({
  id: U(n),
  forma_pagamento_id: formaId,
  codigo,
  descricao: parcelas.join('/') + ' dias',
  parcelas_dias: parcelas,
  prazo_medio_dias: medio,
  ativo: true,
  ordem: n,
  external_id: `E${n}`,
  updated_at: '2026-11-06T00:00:00.000000Z',
  ...o,
});

describe('RN-VEN-24 (ADR 0072): BKO só consulta formas e prazos do ERP', () => {
  const formas = [forma(1, 'PIX', 'Pix'), forma(2, 'BOLETO', 'Boleto', { ativo: false }), forma(3, 'CARTAO', 'Cartão de crédito')];
  const prazos = [prazo(10, U(1), 'PIX-AV', [0], 0), prazo(11, U(2), 'BOL-28', [28], 28), prazo(12, U(2), 'BOL-30', [30, 60, 90], 60, { ativo: false, descricao: 'Boleto 30/60/90' })];
  const vazios = { q: '', forma: '', ativas: '' } as const;

  it('RN-VEN-24: o prazo mostra só os dias ("30/60/90"; à vista = "À vista") e o prazo médio digitado no ERP', () => {
    expect(diasDasParcelas([30, 60, 90])).toBe('30/60/90');
    expect(diasDasParcelas([0])).toBe('À vista');
    expect(textoDoPrazoMedio(1)).toBe('1 dia');
    expect(textoDoPrazoMedio(60)).toBe('60 dias');
  });
  it('RN-VEN-24: os filtros (busca, forma, situação) vão e voltam pela URL', () => {
    expect(lerFiltrosFormas('')).toEqual(vazios);
    const f = lerFiltrosFormas(`?q=bol&forma=${U(2)}&ativas=1`);
    expect(f).toEqual({ q: 'bol', forma: U(2), ativas: '1' });
    expect(buscaDosFiltrosFormas(f)).toBe(`?q=bol&forma=${U(2)}&ativas=1`);
    expect(buscaDosFiltrosFormas(vazios)).toBe('');
  });
  it('RN-VEN-24: a tabela única tem uma linha por prazo, com o nome da forma como coluna', () => {
    expect(linhasDePrazos(formas, prazos, vazios).map((x) => [x.formaNome, x.prazo.codigo])).toEqual([['Pix', 'PIX-AV'], ['Boleto', 'BOL-28'], ['Boleto', 'BOL-30']]);
  });
  it('RN-VEN-24: a busca olha código, descrição e nome da forma, sem maiúsculas nem acentos', () => {
    expect(linhasDePrazos(formas, prazos, { ...vazios, q: 'BOL-30' }).map((x) => x.prazo.codigo)).toEqual(['BOL-30']);
    expect(linhasDePrazos(formas, prazos, { ...vazios, q: 'boleto' })).toHaveLength(2);
    expect(linhasDePrazos(formas, prazos, { ...vazios, q: '28 dias' }).map((x) => x.prazo.codigo)).toEqual(['BOL-28']);
    expect(linhasDePrazos(formas, prazos, { ...vazios, q: 'nada' })).toEqual([]);
  });
  it('R-20261115-121500: o filtro Forma deixa só os prazos da forma escolhida', () => {
    expect(linhasDePrazos(formas, prazos, { ...vazios, forma: U(2) }).map((x) => x.prazo.codigo)).toEqual(['BOL-28', 'BOL-30']);
  });
  it('RN-VEN-24: "só ativos" tira prazo inativo e prazo de forma inativa', () => {
    expect(linhasDePrazos(formas, prazos, { ...vazios, ativas: '1' }).map((x) => x.prazo.codigo)).toEqual(['PIX-AV']);
    expect(prazoEfetivamenteAtivo({ prazo: prazos[0]!, formaAtiva: false })).toBe(false);
  });
  it('RN-VEN-24: prazo inativo ou de forma inativa leva " · inativo" na Descrição da tabela; o CSV não muda', () => {
    const ativo = linhasDePrazos(formas, prazos, { ...vazios, ativas: '1' })[0]!;
    expect(descricaoNaTabela(ativo)).not.toContain('inativo');
    expect(descricaoNaTabela({ prazo: ativo.prazo, formaAtiva: false })).toBe(`${descricaoDoPrazo(ativo.prazo)} · inativo`);
    expect(prazosToCsv([{ ...ativo, formaAtiva: false }])).not.toContain('inativo');
  });
  it('RN-VEN-24: o CSV segue as colunas da tabela, em padrão brasileiro', () => {
    const csv = prazosToCsv(linhasDePrazos(formas, prazos, vazios));
    expect(csv).toContain('"Código";"Descrição";"Forma";"Prazo (dias)";"Prazo médio (dias)"');
    expect(csv).toContain('"BOL-30";"Boleto 30/60/90";"Boleto";"30/60/90";"60"');
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(1 + 3);
  });
});
