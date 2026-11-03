import { describe, expect, it } from 'vitest';
import { validarAlvo, validarCategoria, validarChecklist, validarConcorrente, validarMetaShare, validarPrecoCents, validarProdutoConcorrente, validarVigencia } from './cadastros';

const ID1 = '00000000-0000-4000-8000-000000000001';
const ID2 = '00000000-0000-4000-8000-000000000002';
const etapa = (id: string, extra: Partial<{ rotulo: string; obrigatoria: boolean }> = {}) => ({ id, rotulo: 'Medir o share', obrigatoria: true, ...extra });

describe('validarMetaShare (unidade: percentual, 40 = 40%; coluna meta_pct numeric(5,2))', () => {
  it('RN-PRO-03: aceita de 0 a 100, inclusive', () => {
    for (const v of [0, 0.01, 40, 99.99, 100]) expect(validarMetaShare(v), String(v)).toEqual([]);
  });
  it('RN-PRO-03: recusa negativa e acima de 100', () => {
    expect(validarMetaShare(-0.01)[0]).toMatch(/entre 0 e 100/);
    expect(validarMetaShare(100.01)[0]).toMatch(/entre 0 e 100/);
  });
  it('RN-PRO-03: recusa NaN, infinito e mais de 2 casas (o banco arredondaria sem avisar)', () => {
    expect(validarMetaShare(Number.NaN)).toHaveLength(1);
    expect(validarMetaShare(Number.POSITIVE_INFINITY)).toHaveLength(1);
    expect(validarMetaShare(33.333)[0]).toMatch(/2 casas/);
  });
});

describe('validarChecklist', () => {
  it('RN-PRO-06: exige pelo menos 1 etapa', () => {
    expect(validarChecklist({ nome: 'Rotina', itens: [] })[0]).toMatch(/ao menos uma etapa/i);
    expect(validarChecklist({ nome: 'Rotina', itens: [etapa(ID1)] })).toEqual([]);
  });
  it('RN-PRO-06: a etapa pode ser obrigatória ou opcional; só rótulo vazio e id repetido são recusados', () => {
    expect(validarChecklist({ nome: 'Rotina', itens: [etapa(ID1), etapa(ID2, { obrigatoria: false })] })).toEqual([]);
    expect(validarChecklist({ nome: 'Rotina', itens: [etapa(ID1, { rotulo: '   ' })] })[0]).toMatch(/nome/i);
    expect(validarChecklist({ nome: 'Rotina', itens: [etapa(ID1), etapa(ID1)] })[0]).toMatch(/repetid/i);
  });
  it('nome obrigatório (vazio ou só espaços)', () => {
    expect(validarChecklist({ nome: '  ', itens: [etapa(ID1)] })[0]).toMatch(/nome/i);
  });
});

describe('nomes e preço', () => {
  it('categoria, concorrente e produto do concorrente exigem nome', () => {
    expect(validarCategoria({ nome: ' ', ordem: 0 })[0]).toMatch(/nome/i);
    expect(validarCategoria({ nome: 'Massas', ordem: 1.5 })[0]).toMatch(/ordem/i);
    expect(validarCategoria({ nome: 'Massas', ordem: 1 })).toEqual([]);
    expect(validarConcorrente({ nome: '' })[0]).toMatch(/nome/i);
    expect(validarProdutoConcorrente({ nome: 'Macarrão 500 g' })).toEqual([]);
    expect(validarProdutoConcorrente({ nome: 'x'.repeat(201) })[0]).toMatch(/200/);
  });
  it('RN-PRO-04: preço em centavos inteiros e nunca negativo', () => {
    expect(validarPrecoCents(0)).toEqual([]);
    expect(validarPrecoCents(599)).toEqual([]);
    expect(validarPrecoCents(-1)[0]).toMatch(/negativ/i);
    expect(validarPrecoCents(5.99)[0]).toMatch(/centavos/i);
  });
});

describe('alvo e vigência (RN-PRO-10)', () => {
  it('RN-PRO-10: loja OU segmento OU todas; os dois juntos são recusados', () => {
    expect(validarAlvo({ cliente_id: ID1, segmento: null })).toEqual([]);
    expect(validarAlvo({ cliente_id: null, segmento: 'Atacado' })).toEqual([]);
    expect(validarAlvo({ cliente_id: null, segmento: null })).toEqual([]);
    expect(validarAlvo({ cliente_id: ID1, segmento: 'Atacado' })[0]).toMatch(/loja ou um segmento/i);
    expect(validarAlvo({ cliente_id: null, segmento: '  ' })[0]).toMatch(/segmento/i);
  });
  it('RN-PRO-10: o fim da vigência não pode ser anterior ao início', () => {
    expect(validarVigencia('2026-11-01', null)).toEqual([]);
    expect(validarVigencia('2026-11-01', '2026-11-01')).toEqual([]);
    expect(validarVigencia('2026-11-02', '2026-11-01')[0]).toMatch(/anterior/i);
  });
});
