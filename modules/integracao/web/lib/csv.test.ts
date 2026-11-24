import { describe, expect, it } from 'vitest';
import type { LinhaErro } from '../../contracts';
import { BOM_CSV } from '@macuxi/comum/csv';
import { errosParaCsv, toCsv } from './csv';

const linhas = (csv: string) => csv.replace(BOM_CSV, '').trimEnd().split('\r\n');

describe('CSV no padrão do Excel brasileiro', () => {
  it('BOM, separador ;, CRLF e aspas quando precisa', () => {
    const csv = toCsv([
      ['a', 'b;c'],
      [1, 'diz "oi"'],
    ]);
    expect(csv.startsWith(BOM_CSV)).toBe(true);
    expect(linhas(csv)).toEqual(['a;"b;c"', '1;"diz ""oi"""']);
  });

  it('CWE-1236: neutraliza fórmula vinda do ERP (=, +, -, @) sem mexer em número', () => {
    expect(linhas(toCsv([['=1+1', '=HYPERLINK("x")', '+55', '@soma', -3, null]]))).toEqual([
      `'=1+1;"'=HYPERLINK(""x"")";'+55;'@soma;-3;`,
    ]);
  });
});

describe('exportações do monitor', () => {
  it('erros por linha: linha em base 1, código, campo, mensagem, reprocessável e origem (sem valor de dado pessoal)', () => {
    const erros: LinhaErro[] = [
      { indice: 0, external_id: 'C-9', codigo: 'campo_obrigatorio', campo: 'nome', mensagem: 'nome é obrigatório', reprocessavel: false, origem: 'hub' },
      { indice: 4, external_id: null, codigo: 'referencia_ausente', campo: null, mensagem: 'vendedor V-1 ainda não chegou', reprocessavel: true },
    ];
    const l = linhas(errosParaCsv(erros));
    expect(l[0]).toBe('Linha;Código no ERP;Erro;Campo;Mensagem;Reprocessável;Origem');
    expect(l[1]).toBe('1;C-9;campo_obrigatorio;nome;nome é obrigatório;Não;Hub');
    expect(l[2]).toBe('5;;referencia_ausente;;vendedor V-1 ainda não chegou;Sim;Hub');
  });
});
