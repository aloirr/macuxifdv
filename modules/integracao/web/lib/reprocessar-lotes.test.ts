import { describe, expect, it } from 'vitest';
import { paraSeNaoForDoLote, reprocessarLotes, textoResultadoReprocesso } from './reprocessar-lotes';

const erro = (code: string) => Object.assign(new Error(code), { code });
const parar = (e: unknown) => (e as { code?: string }).code === 'autorizador_necessario' || (e as { code?: string }).code === 'senha_incorreta';
const rotulo = (id: string) => `lote ${id}`;
const msg = (e: unknown) => (e as Error).message;

describe('RN-INT-15: reprocessar vários lotes da entidade', () => {
  it('RN-INT-15: o lote que falha (conteudo_expirado) não impede os demais', async () => {
    const feitos: string[] = [];
    const r = await reprocessarLotes(['a', 'b', 'c'], async (id) => {
      if (id === 'a') throw erro('conteudo_expirado');
      feitos.push(id);
    }, parar);
    expect(feitos).toEqual(['b', 'c']);
    expect(r.reprocessados).toEqual(['b', 'c']);
    expect(r.falhas.map((f) => f.loteId)).toEqual(['a']);
    expect(r.interrompido).toBeNull();
    expect(r.restantes).toEqual([]);
  });

  it('RN-INT-16: senha errada ou autorização pendente interrompe e deixa na lista só o que ainda não foi', async () => {
    const r = await reprocessarLotes(['a', 'b', 'c'], async (id) => {
      if (id === 'b') throw erro('senha_incorreta');
    }, parar);
    expect(r.reprocessados).toEqual(['a']);
    expect(r.restantes).toEqual(['b', 'c']);
    expect((r.interrompido as { code: string }).code).toBe('senha_incorreta');
  });
});

describe('RN-INT-16: o que interrompe a fila', () => {
  it('RN-INT-16: erro do lote segue; autorização, senha, limite e serviço indisponível param', () => {
    expect(['conteudo_expirado', 'lote_nao_pode_reprocessar', 'LOTE_NAO_ENCONTRADO'].map(paraSeNaoForDoLote)).toEqual([false, false, false]);
    expect(['autorizador_necessario', 'senha_incorreta', 'muitas_tentativas', 'autorizacao_indisponivel', ''].map(paraSeNaoForDoLote)).toEqual([true, true, true, true, true]);
  });
});

describe('RN-INT-15: texto do resultado do reprocessamento', () => {
  it('RN-INT-15: tudo certo mantém a frase curta', () => {
    expect(textoResultadoReprocesso({ reprocessados: ['a'], falhas: [], restantes: [], interrompido: null }, 1, rotulo, msg)).toBe('Reprocessamento iniciado.');
  });
  it('RN-INT-15: parcial diz quantos foram e quais falharam, com a mensagem', () => {
    const r = { reprocessados: ['b', 'c'], falhas: [{ loteId: 'a', erro: new Error('Conteúdo expirado.') }], restantes: [], interrompido: null };
    expect(textoResultadoReprocesso(r, 3, rotulo, msg)).toBe('2 de 3 lotes reprocessados. Falhou lote a: Conteúdo expirado.');
  });
  it('RN-INT-15: nenhum reprocessado não diz "0 de n lotes reprocessados"', () => {
    const r = { reprocessados: [], falhas: [{ loteId: 'a', erro: new Error('x') }, { loteId: 'b', erro: new Error('y') }], restantes: [], interrompido: null };
    expect(textoResultadoReprocesso(r, 2, rotulo, msg)).toBe('Nenhum lote reprocessado. Falhou lote a: x Falhou lote b: y');
  });
});
