import { criarRelogio } from '@macuxi/comum/relogio';
import { describe, expect, it } from 'vitest';
import type { LinhaErro, LoteListagemItem, PendenciaInativacao } from '../../contracts';
import { CSV_BOM, csvCell, errosParaCsv, lotesParaCsv, pendenciaParaCsv, toCsv } from './csv';

const relogio = criarRelogio();
const linhas = (csv: string) => csv.replace(CSV_BOM, '').trimEnd().split('\r\n');

describe('CSV no padrão do Excel brasileiro', () => {
  it('BOM, separador ;, CRLF e aspas quando precisa', () => {
    const csv = toCsv([
      ['a', 'b;c'],
      [1, 'diz "oi"'],
    ]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(linhas(csv)).toEqual(['a;"b;c"', '1;"diz ""oi"""']);
  });

  it('neutraliza fórmula vinda do ERP (=, +, -, @) sem mexer em número', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+55')).toBe("'+55");
    expect(csvCell('@soma')).toBe("'@soma");
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell(null)).toBe('');
  });
});

describe('exportações do monitor', () => {
  it('lotes: uma linha por lote com as contagens e o status em português', () => {
    const lote: LoteListagemItem = {
      lote_id: '3f0c9a8e-1b2d-4c5e-8f90-a1b2c3d4e5f6',
      conector_id: 'erp-matriz',
      entidade: 'cliente',
      modo: 'completo',
      status: 'concluido_com_erros',
      recebidas: 10,
      com_erro: 2,
      novas: 3,
      atualizadas: 4,
      inalteradas: 1,
      obsoletas: 0,
      inativadas: 0,
      recebido_em: relogio.iso(),
      concluido_em: null,
    };
    const l = linhas(lotesParaCsv([lote], relogio.fuso));
    expect(l[0]).toMatch(/^Lote;Conector;Entidade;Modo;Status;Recebidas/);
    expect(l[1]).toContain('erp-matriz;Clientes;Carga completa;Aplicado com erros;10;3;4;1;0;2;0;');
    expect(l).toHaveLength(2);
  });

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

  it('pendência de inativação: resumo e a amostra de códigos do ERP', () => {
    const p: PendenciaInativacao = {
      id: '7d1f6c1e-6d55-4c38-9b1f-1d1f0e8f0a01',
      sessao_id: '7d1f6c1e-6d55-4c38-9b1f-1d1f0e8f0a02',
      entidade: 'produto',
      conector_id: 'erp-matriz',
      lote_id: '7d1f6c1e-6d55-4c38-9b1f-1d1f0e8f0a03',
      estado: 'aguardando',
      candidatos: 420,
      total_ativos: 1000,
      percentual: 42,
      limite_pct: 30,
      amostra: ['P-1', 'P-2'],
      criada_em: relogio.iso(),
      expira_em: relogio.relativo({ dias: 7 }).toISOString(),
      decidida_em: null,
    };
    const l = linhas(pendenciaParaCsv(p, relogio.fuso));
    expect(l[0]).toBe('Entidade;Conector;Lote;Inativaria;Ativos;Percentual;Limite;Criada em;Vale até;Código no ERP');
    expect(l[1]).toMatch(/^Produtos;erp-matriz;7d1f6c1e-6d55-4c38-9b1f-1d1f0e8f0a03;420;1000;42,00;30,00;.+;.+;P-1$/);
    expect(l[2]).toMatch(/;P-2$/);
    expect(l).toHaveLength(3);
  });
});
