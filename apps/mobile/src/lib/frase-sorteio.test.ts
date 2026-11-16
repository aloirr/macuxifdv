/**
 * T-0181 (spec carga-aviso-frases §2): sorteio da frase da carga, offline, uma por carga, sem repetir a última.
 */
import { FRASES_CARGA_INICIAIS } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

import { frasesDaResposta, frasesDoAparelho, sortearFrase } from './frase-sorteio';

const f = (id: string, ativa = true) => ({ id, texto: `Frase ${id}`, ativa });

/** Gerador determinístico (congruencial) para as várias rodadas. */
function semente(s: number): () => number {
  let x = s;
  return () => {
    x = (x * 1_103_515_245 + 12_345) % 2_147_483_648;
    return x / 2_147_483_648;
  };
}

describe('sortearFrase', () => {
  it('só entre as ativas; nenhuma ativa → nada', () => {
    expect(sortearFrase([f('a', false), f('b', false)], null, () => 0)).toBeNull();
    expect(sortearFrase([], null, () => 0.5)).toBeNull();
    expect(sortearFrase([f('a', false), f('b')], null, () => 0)?.id).toBe('b');
  });

  it('nunca repete a última (500 rodadas, guardando só o id da última)', () => {
    const lista = [f('a'), f('b'), f('c'), f('d', false)];
    const rnd = semente(7);
    let ultima: string | null = null;
    const vistas = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const s: { id: string } | null = sortearFrase(lista, ultima, rnd);
      expect(s).not.toBeNull();
      expect(s?.id).not.toBe(ultima);
      expect(s?.id).not.toBe('d');
      if (s) vistas.add(s.id);
      ultima = s?.id ?? null;
    }
    expect([...vistas].sort()).toEqual(['a', 'b', 'c']);
  });

  it('com uma ativa só, ela aparece mesmo sendo a última', () => {
    expect(sortearFrase([f('a'), f('b', false)], 'a', () => 0.9)?.id).toBe('a');
  });

  it('rnd nas pontas do intervalo não sai da lista', () => {
    const lista = [f('a'), f('b'), f('c')];
    expect(sortearFrase(lista, 'c', () => 0)?.id).toBe('a');
    expect(sortearFrase(lista, 'c', () => 0.999_999)?.id).toBe('b');
    expect(sortearFrase(lista, null, () => 1)?.id).toBe('c');
  });
});

describe('lista do aparelho', () => {
  it('primeira carga, sem sync: as 30 iniciais do bundle, todas ativas', () => {
    const lista = frasesDoAparelho(null);
    expect(lista).toBe(FRASES_CARGA_INICIAIS);
    expect(lista.filter((x) => x.ativa !== false)).toHaveLength(30);
    expect(sortearFrase(lista, null, () => 0.5)).not.toBeNull();
  });

  it('com a lista do sync, só ela vale (vazia: sem ativas, sem frase)', () => {
    expect(frasesDoAparelho([f('x')]).map((x) => x.id)).toEqual(['x']);
    expect(sortearFrase(frasesDoAparelho([]), null, () => 0)).toBeNull();
  });

  it('resposta do servidor: guarda só id e texto, como veio (o sorteio não usa a ordem); fora do contrato não substitui', () => {
    const [p1, p2] = FRASES_CARGA_INICIAIS;
    expect(
      frasesDaResposta({
        frases: [
          { id: p2?.id, texto: 'Segunda', ordem: 2 },
          { id: p1?.id, texto: 'Primeira', ordem: 1 },
        ],
      }),
    ).toEqual([
      { id: p2?.id, texto: 'Segunda' },
      { id: p1?.id, texto: 'Primeira' },
    ]);
    expect(frasesDaResposta({ frases: [] })).toEqual([]);
    expect(frasesDaResposta(null)).toBeNull();
    expect(frasesDaResposta({ erro: 'FRASES_CARGA_INDISPONIVEIS' })).toBeNull();
    expect(frasesDaResposta({ frases: [{ id: 'x', texto: '', ordem: 1 }] })).toBeNull();
  });
});
