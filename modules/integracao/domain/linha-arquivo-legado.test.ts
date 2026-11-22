import { describe, expect, it } from 'vitest';
import { anotarLinhaDoArquivo } from './linha-arquivo-legado';

describe('RF-INT-03: erros do lote legado de arquivo com o número da linha', () => {
  it('RF-INT-03: erro do Hub (índice no lote) ganha o prefixo "Linha N do arquivo:" com a linha física do arquivo; índice sem mapa fica como está', () => {
    const r = anotarLinhaDoArquivo([{ indice: 0, mensagem: 'razão social é obrigatória' }, { indice: 1, mensagem: 'x' }, { indice: 9, mensagem: 'sem mapa' }], [2, 7]);
    expect(r.map((x) => x.mensagem)).toEqual(['Linha 2 do arquivo: razão social é obrigatória', 'Linha 7 do arquivo: x', 'sem mapa']);
  });

  it('RF-INT-03: mensagem que já tem o prefixo não é anotada duas vezes (reprocessar o lote)', () => {
    const r = anotarLinhaDoArquivo([{ indice: 0, mensagem: 'Linha 2 do arquivo: erro' }], [2]);
    expect(r[0]?.mensagem).toBe('Linha 2 do arquivo: erro');
  });

  it('RF-INT-03: sem mapa de linhas (lote do Conector) nada muda', () => {
    const itens = [{ indice: 0, mensagem: 'a' }];
    expect(anotarLinhaDoArquivo(itens, undefined)).toEqual(itens);
  });
});
