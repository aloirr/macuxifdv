import { describe, expect, it } from 'vitest';
import { classificarMudancas, deduplicarNoLote, hashRegistro, jsonCanonico, validarLinhas } from './idempotencia';

describe('RN-INT-02: hash canônico estável', () => {
  it('RN-INT-02: a ordem das chaves não muda o hash (em qualquer nível)', () => {
    expect(hashRegistro({ a: 1, b: { x: 1, y: [1, 2] } })).toBe(hashRegistro({ b: { y: [1, 2], x: 1 }, a: 1 }));
    expect(jsonCanonico({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('RN-INT-02: conteúdo diferente muda o hash; ordem de lista importa', () => {
    expect(hashRegistro({ a: 1 })).not.toBe(hashRegistro({ a: 2 }));
    expect(hashRegistro({ l: [1, 2] })).not.toBe(hashRegistro({ l: [2, 1] }));
    expect(hashRegistro({ a: '1' })).not.toBe(hashRegistro({ a: 1 }));
  });

  it('RN-INT-02/09: campo nulo ou ausente é o mesmo conteúdo (campo novo opcional é compatível)', () => {
    expect(hashRegistro({ a: 1, b: null })).toBe(hashRegistro({ a: 1 }));
    expect(hashRegistro({ a: 1, b: undefined })).toBe(hashRegistro({ a: 1 }));
  });

  it('RN-INT-02: alterado_em não entra no hash (rowversion que mudou sem mudar conteúdo não gera evento)', () => {
    expect(hashRegistro({ a: 1, alterado_em: '2026-10-31T10:00:00Z' })).toBe(hashRegistro({ a: 1, alterado_em: '2026-11-01T10:00:00Z' }));
    expect(hashRegistro({ a: 1, alterado_em: 'x' }, { ignorar: [] })).not.toBe(hashRegistro({ a: 1, alterado_em: 'y' }, { ignorar: [] }));
  });

  it('RN-INT-02: hash é determinístico e SHA-256 em 64 hexadecimais (formato do CHECK registro_atual_hash_formato)', () => {
    const h = hashRegistro({ nome: 'Café ☕', n: 10 });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRegistro({ nome: 'Café ☕', n: 10 })).toBe(h);
    expect(hashRegistro({})).toMatch(/^[0-9a-f]{64}$/);
  });

  it('RN-INT-02: -0 e 0 são o mesmo conteúdo; número não finito é recusado', () => {
    expect(hashRegistro({ a: -0 })).toBe(hashRegistro({ a: 0 }));
    expect(() => hashRegistro({ a: Number.NaN })).toThrow();
  });
});

describe('RN-INT-02: external_id repetido no lote', () => {
  it('RN-INT-02: vale a última ocorrência e as anteriores viram aviso duplicado_no_lote', () => {
    const { linhas, avisos } = deduplicarNoLote([
      { external_id: 'A', v: 1 },
      { external_id: 'B', v: 1 },
      { external_id: 'A', v: 2 },
      { external_id: ' A ', v: 3 },
    ]);
    expect(linhas.map((l) => [l.indice, l.external_id])).toEqual([
      [1, 'B'],
      [3, 'A'],
    ]);
    expect(avisos).toHaveLength(2);
    expect(avisos[0]).toMatchObject({ indice: 0, external_id: 'A', codigo: 'duplicado_no_lote' });
    expect(avisos.map((a) => a.indice)).toEqual([0, 2]);
    expect(avisos[0]?.mensagem).toMatch(/linha 4/);
  });

  it('RN-INT-02/03: linha sem external_id legível é mantida para virar erro depois', () => {
    const { linhas, avisos } = deduplicarNoLote([{ v: 1 }, 'texto', { external_id: 5 }, { external_id: '' }]);
    expect(linhas).toHaveLength(4);
    expect(linhas.every((l) => l.external_id === null)).toBe(true);
    expect(avisos).toEqual([]);
  });
});

describe('RN-INT-02/06: classificar contra o que já existe', () => {
  const T1 = '2026-10-31T10:00:00.000Z';
  const T0 = '2026-10-31T09:00:00.000Z';
  const T2 = '2026-10-31T11:00:00.000Z';
  const v = (external_id: string, hash: string, alterado_em = T1, indice = 0) => ({ indice, external_id, hash, alterado_em });
  const ex = (hash: string, alterado_em = T1) => ({ hash, alterado_em });
  it('RN-INT-02: hash igual = inalterada (sem evento); hash diferente = atualizada; sem registro = nova', () => {
    const r = classificarMudancas([v('A', 'h1'), v('B', 'h9', T2), v('C', 'h3')], new Map([['A', ex('h1')], ['B', ex('h2')]]));
    expect(r.inalteradas.map((x) => x.external_id)).toEqual(['A']);
    expect(r.atualizadas.map((x) => x.external_id)).toEqual(['B']);
    expect(r.novas.map((x) => x.external_id)).toEqual(['C']);
    expect(r.obsoletas).toEqual([]);
  });
  it('RN-INT-06: alterado_em menor que o do registro atual = obsoleta, mesmo com hash diferente (reenvio antigo / reprocessamento)', () => {
    const r = classificarMudancas([v('X', 'velho', T0)], new Map([['X', ex('novo', T1)]]));
    expect(r.obsoletas.map((x) => x.external_id)).toEqual(['X']);
    expect(r.atualizadas).toEqual([]);
    expect(r.novas).toEqual([]);
  });
  it('RN-INT-06: obsoleta com hash igual também é obsoleta (a data manda; não vira inalterada)', () => {
    const r = classificarMudancas([v('X', 'h', T0)], new Map([['X', ex('h', T1)]]));
    expect(r.obsoletas).toHaveLength(1);
    expect(r.inalteradas).toEqual([]);
  });
  it('RN-INT-06: empate em alterado_em com hash diferente = atualizada (a última chegada vence); com hash igual = inalterada', () => {
    const r = classificarMudancas([v('A', 'h2', T1), v('B', 'h1', T1)], new Map([['A', ex('h1', T1)], ['B', ex('h1', T1)]]));
    expect(r.atualizadas.map((x) => x.external_id)).toEqual(['A']);
    expect(r.inalteradas.map((x) => x.external_id)).toEqual(['B']);
    expect(r.obsoletas).toEqual([]);
  });
  it('RN-INT-06: cenário do reprocessamento — X velho do lote 1 não desfaz o X novo do lote 2', () => {
    const atual = new Map([['X', ex('hash-lote-2', T2)]]);
    const r = classificarMudancas([v('X', 'hash-lote-1', T0)], atual);
    expect([r.novas.length, r.atualizadas.length, r.inalteradas.length, r.obsoletas.length]).toEqual([0, 0, 0, 1]);
  });
  it('RN-INT-06: compara o instante, não o texto (fusos/precisão diferentes)', () => {
    const r = classificarMudancas([v('X', 'h2', '2026-10-31T10:00:00Z')], new Map([['X', ex('h1', '2026-10-31T10:00:00.000Z')]]));
    expect(r.atualizadas).toHaveLength(1);
  });
});

describe('RN-INT-02/03: validar linhas do lote', () => {
  const ok = (id: string, extra: Record<string, unknown> = {}) => ({ external_id: id, alterado_em: '2026-10-31T10:00:00Z', nome: `Vend ${id}`, ...extra });
  it('RN-INT-02/03: separa válidas (com hash do registro normalizado), erros e avisos, sem travar o lote', () => {
    const r = validarLinhas('vendedor', [ok('V1'), { external_id: 'V2' }, ok('V3'), ok('V1', { nome: 'Outro' })]);
    expect(r.validas.map((l) => [l.indice, l.external_id])).toEqual([
      [2, 'V3'],
      [3, 'V1'],
    ]);
    expect(r.validas[1]?.registro).toMatchObject({ nome: 'Outro', ativo: true });
    expect(r.validas[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.erros.map((e) => [e.indice, e.external_id, e.codigo])).toContainEqual([1, 'V2', 'campo_obrigatorio']);
    expect(r.avisos.map((a) => a.indice)).toEqual([0]);
  });

  it('RN-INT-02: ativo omitido e ativo=true geram o mesmo hash; alterado_em diferente também', () => {
    const a = validarLinhas('vendedor', [ok('V1')]).validas[0]?.hash;
    const b = validarLinhas('vendedor', [ok('V1', { ativo: true, alterado_em: '2026-12-01T00:00:00Z' })]).validas[0]?.hash;
    expect(a).toBe(b);
  });

  it('RN-INT-02/03: se a última ocorrência é inválida, a anterior válida não vale (última vence)', () => {
    const r = validarLinhas('vendedor', [ok('V1'), { external_id: 'V1' }]);
    expect(r.validas).toEqual([]);
    expect(r.erros.length).toBeGreaterThan(0);
    expect(r.erros.every((e) => e.indice === 1)).toBe(true);
    expect(r.avisos).toHaveLength(1);
  });
});

describe('RN-INT-02: contrato do hash com o banco (db/migrations/0010_integracao.up.sql registro_atual_hash_formato)', () => {
  const CHECK_BANCO = /^[0-9a-f]{64}$/;
  it('RN-INT-02: o hash do domain casa com o CHECK do registro_atual (^[0-9a-f]{64}$), com e sem opções', () => {
    for (const r of [{}, { a: 1 }, { nome: 'Café ☕', itens: [1, 2, { x: null }] }, 'texto', 42, [1, 2]]) {
      expect(hashRegistro(r)).toMatch(CHECK_BANCO);
      expect(hashRegistro(r, { ignorar: [] })).toMatch(CHECK_BANCO);
    }
  });
  it('RN-INT-02: SHA-256 de um valor conhecido (a mudança de conteúdo de 1 bit muda os 64 caracteres)', () => {
    expect(hashRegistro({ a: 1 })).toBe('015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862');
    expect(hashRegistro({ a: 1 })).not.toBe(hashRegistro({ a: 2 }));
  });
});
