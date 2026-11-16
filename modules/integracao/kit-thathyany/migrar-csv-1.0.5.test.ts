/**
 * Conversor dos CSVs 1.0.5 → modelo atual (scripts/migrar-csv-1.0.5.ts). Os dados são os modelos fictícios do kit; nunca os da empresa.
 */
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { BOM_CSV } from '@macuxi/comum/csv';
import { codigoMarcaPeloNome } from '../domain/marca-referencia-codigo';
import { converterCsv, converterPasta } from './scripts/migrar-csv-1.0.5';

const MODELOS = fileURLToPath(new URL('modelos', import.meta.url));
const lerModelo = (f: string): string => readFileSync(join(MODELOS, f), 'utf8');
const cabecalho = (f: string): string[] => (lerModelo(f).replace(BOM_CSV, '').split(/\r?\n/)[0] ?? '').split(';');

/** produto.csv como saiu no kit 1.0.5 (sem `marca_referencia_codigo_N`). */
const PRODUTO_105 =
  BOM_CSV +
  'external_id;sku;nome;unidade;alterado_em;ativo;ean;marca;marca_codigo;categoria;embalagem_medida;embalagem_quantidade;catalogo_no_external_id;custo_cents;preco_venda_cents;desconto_maximo_pct;aplicacao;referencia_1;marca_referencia_1;referencia_2;marca_referencia_2;referencia_3;marca_referencia_3\r\n' +
  'PRO-001;SKU-001;Refrigerante Cola 2L;UN;2026-11-01T12:00:00Z;sim;7891234567895;Marca Alfa;980;Bebidas;CX;12;CAT-001;850;1290;10;;PAF-0503;Marca Beta;;;;\r\n' +
  'PRO-002;SKU-002;Suco 1L;UN;2026-11-01T12:00:00Z;sim;;Marca Beta;981;Bebidas;;;;;;;"usa; com aspas ""x""";R-2;Marca Gama;R-3;marca beta;R-4;\r\n';

const temporarias: string[] = [];
afterEach(() => {
  for (const d of temporarias.splice(0)) rmSync(d, { recursive: true, force: true });
});
const pasta = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'migrar-105-'));
  temporarias.push(d);
  return d;
};

describe('conversor dos CSVs 1.0.5 para o modelo atual', () => {
  it('produto.csv: copia as colunas, sai no cabeçalho atual e preenche o código da marca da referência (RN-CAT-09)', () => {
    const { convertido, resumo } = converterCsv('produto.csv', PRODUTO_105, cabecalho('produto.csv'));
    const [cab, l1, l2] = convertido.csv.replace(BOM_CSV, '').split('\r\n');
    expect(cab).toBe(cabecalho('produto.csv').join(';'));
    expect(convertido.colunasNovas).toEqual(['marca_referencia_codigo_1', 'marca_referencia_codigo_2', 'marca_referencia_codigo_3']);
    // Marca Beta tem código no ERP (981, do produto PRO-002): a referência usa esse; Marca Gama não tem, ganha o gerado
    expect(l1).toBe('PRO-001;SKU-001;Refrigerante Cola 2L;UN;2026-11-01T12:00:00Z;sim;7891234567895;Marca Alfa;980;Bebidas;CX;12;CAT-001;850;1290;10;;PAF-0503;981;Marca Beta;;;;;;');
    expect(l2).toBe(`PRO-002;SKU-002;Suco 1L;UN;2026-11-01T12:00:00Z;sim;;Marca Beta;981;Bebidas;;;;;;;"usa; com aspas ""x""";R-2;${codigoMarcaPeloNome('Marca Gama')};Marca Gama;R-3;981;marca beta;R-4;;`);
    expect(resumo).toEqual({ codigosGerados: 1, codigosDoErp: 1, celulasPreenchidas: 3 });
  });

  it('os 16 modelos do 1.0.5 convertem; os 15 sem mudança saem idênticos aos modelos atuais', () => {
    const entrada = pasta();
    for (const f of readdirSync(MODELOS)) copyFileSync(join(MODELOS, f), join(entrada, f));
    writeFileSync(join(entrada, 'produto.csv'), PRODUTO_105);
    const { arquivos } = converterPasta(entrada);
    expect(arquivos).toHaveLength(16);
    for (const a of arquivos.filter((x) => x.arquivo !== 'produto.csv')) expect(a.csv.replaceAll('\r\n', '\n'), a.arquivo).toBe(lerModelo(a.arquivo).replaceAll('\r\n', '\n'));
  });

  it('coluna nova do modelo atual sai vazia; coluna sem lugar no modelo ou arquivo sem modelo é erro', () => {
    const cab = cabecalho('prazo_pagamento.csv');
    const semUltima = cab.slice(0, -1);
    const r = converterCsv('prazo_pagamento.csv', `${semUltima.join(';')}\r\n${semUltima.map(() => 'x').join(';')}\r\n`, cab);
    expect(r.convertido.colunasNovas).toEqual([cab.at(-1)]);
    expect(r.convertido.csv.split('\r\n')[1]).toBe(`${semUltima.map(() => 'x').join(';')};`);
    expect(() => converterCsv('filial.csv', 'external_id;coluna_velha\r\nF1;x\r\n', cabecalho('filial.csv'))).toThrow(/coluna_velha/);
    const entrada = pasta();
    writeFileSync(join(entrada, 'desconhecido.csv'), 'a\r\n1\r\n');
    expect(() => converterPasta(entrada)).toThrow(/desconhecido\.csv/);
  });
});
