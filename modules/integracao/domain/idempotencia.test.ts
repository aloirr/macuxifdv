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

  it('RN-INT-02: hash é determinístico, com 16 hexadecimais, sem depender de node:crypto', () => {
    const h = hashRegistro({ nome: 'Café ☕', n: 10 });
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(hashRegistro({ nome: 'Café ☕', n: 10 })).toBe(h);
    expect(hashRegistro({})).toMatch(/^[0-9a-f]{16}$/);
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

describe('RN-INT-02: classificar contra o que já existe', () => {
  const v = (external_id: string, hash: string, indice = 0) => ({ indice, external_id, hash });
  it('RN-INT-02: hash igual = inalterada (sem evento); hash diferente = atualizada; sem hash = nova', () => {
    const r = classificarMudancas([v('A', 'h1', 0), v('B', 'h9', 1), v('C', 'h3', 2)], new Map([['A', 'h1'], ['B', 'h2']]));
    expect(r.inalteradas.map((x) => x.external_id)).toEqual(['A']);
    expect(r.atualizadas.map((x) => x.external_id)).toEqual(['B']);
    expect(r.novas.map((x) => x.external_id)).toEqual(['C']);
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
    expect(r.validas[0]?.hash).toMatch(/^[0-9a-f]{16}$/);
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
