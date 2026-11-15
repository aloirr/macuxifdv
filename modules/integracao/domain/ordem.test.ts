import { describe, expect, it } from 'vitest';
import { ENTIDADES, ORDEM_CARGA_ENTIDADES, type Entidade } from '../contracts';
import { DEPENDENCIAS, ordenarCarga, referenciasDoRegistro, verificarReferencias } from './ordem';

describe('RN-INT-04: ordem topológica de carga', () => {
  it('RN-INT-04: vendedor → cliente → (rota, título, nota); produto → (preço, estoque)', () => {
    const r = ordenarCarga([...ENTIDADES].reverse());
    if (!r.ok) throw new Error('ciclo inesperado');
    const pos = (e: Entidade) => r.ordem.indexOf(e);
    expect(pos('vendedor')).toBeLessThan(pos('cliente'));
    for (const e of ['rota', 'titulo', 'nota'] as const) expect(pos('cliente')).toBeLessThan(pos(e));
    for (const e of ['preco', 'estoque'] as const) expect(pos('produto')).toBeLessThan(pos(e));
    expect(r.ordem).toHaveLength(ENTIDADES.length);
  });

  it('RN-INT-04: a faixa escalonada vem depois de produto e de preco (a tabela nasce no consumidor do preco)', () => {
    const r = ordenarCarga([...ENTIDADES].reverse());
    if (!r.ok) throw new Error('ciclo inesperado');
    expect(r.ordem.indexOf('tabela_escalonada')).toBeGreaterThan(r.ordem.indexOf('preco'));
    expect(r.ordem.indexOf('tabela_escalonada')).toBeGreaterThan(r.ordem.indexOf('produto'));
  });

  it('RN-INT-04: ordem estável (preserva a ordem pedida quando não há dependência)', () => {
    const r = ordenarCarga(['estoque', 'preco', 'produto']);
    expect(r).toEqual({ ok: true, ordem: ['produto', 'estoque', 'preco'] });
  });

  it('RN-INT-04: dependência fora da seleção é ignorada (já carregada antes)', () => {
    expect(ordenarCarga(['nota', 'titulo'])).toEqual({ ok: true, ordem: ['nota', 'titulo'] });
  });

  it('RN-INT-04: detecta ciclo e devolve o caminho', () => {
    const r = ordenarCarga(['a', 'b', 'c'], { a: ['b'], b: ['c'], c: ['a'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.ciclo).toEqual(['a', 'b', 'c', 'a']);
  });

  it('RN-INT-04: o mapa de dependências padrão não tem ciclo', () => {
    expect(ordenarCarga(ENTIDADES, DEPENDENCIAS).ok).toBe(true);
  });
});

describe('RN-INT-04: lista única da ordem de carga (ORDEM_CARGA_ENTIDADES)', () => {
  it('RN-INT-04: cobre as 16 entidades uma vez e cada uma vem depois de tudo de que depende (DEPENDENCIAS)', () => {
    expect([...ORDEM_CARGA_ENTIDADES].sort()).toEqual([...ENTIDADES].sort());
    ORDEM_CARGA_ENTIDADES.forEach((e, i) => {
      for (const d of DEPENDENCIAS[e]) expect(ORDEM_CARGA_ENTIDADES.indexOf(d), `${e} depende de ${d}`).toBeLessThan(i);
    });
    expect(ORDEM_CARGA_ENTIDADES.slice(0, 2)).toEqual(['filial', 'vendedor']);
  });
});

describe('RN-INT-04: referências entre entidades', () => {
  it('RN-INT-04: extrai as referências de cada entidade', () => {
    expect(referenciasDoRegistro('cliente', { vendedor_external_id: 'V1' })).toEqual([{ entidade: 'vendedor', campo: 'vendedor_external_id', external_id: 'V1' }]);
    expect(referenciasDoRegistro('cliente', { vendedor_external_id: null })).toEqual([]);
    expect(referenciasDoRegistro('rota', { vendedor_external_id: 'V1', paradas: [{ ordem: 1, cliente_external_id: 'C1' }, { ordem: 2, cliente_external_id: 'C2' }] })).toEqual([
      { entidade: 'vendedor', campo: 'vendedor_external_id', external_id: 'V1' },
      { entidade: 'cliente', campo: 'paradas[0].cliente_external_id', external_id: 'C1' },
      { entidade: 'cliente', campo: 'paradas[1].cliente_external_id', external_id: 'C2' },
    ]);
    expect(referenciasDoRegistro('estoque', { produto_external_id: 'P1', deposito_external_id: 'D1' })).toEqual([{ entidade: 'produto', campo: 'produto_external_id', external_id: 'P1' }]);
    expect(referenciasDoRegistro('produto', { sku: 'x' })).toEqual([]);
  });

  it('RN-INT-04: referência inexistente vira referencia_ausente reprocessável, sem criar órfão', () => {
    const linhas = [
      { indice: 0, external_id: 'T1', registro: { cliente_external_id: 'C1' } },
      { indice: 1, external_id: 'T2', registro: { cliente_external_id: 'C404' } },
    ];
    const r = verificarReferencias('titulo', linhas, { cliente: new Set(['C1']) });
    expect(r.aceitas.map((l) => l.external_id)).toEqual(['T1']);
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0]).toMatchObject({ indice: 1, external_id: 'T2', codigo: 'referencia_ausente', campo: 'cliente_external_id', reprocessavel: true });
    expect(r.erros[0]?.mensagem).toMatch(/cliente/);
  });

  it('RN-INT-04: sem conjunto informado para a entidade alvo, tudo é ausente (nunca assume que existe)', () => {
    const r = verificarReferencias('titulo', [{ indice: 0, external_id: 'T1', registro: { cliente_external_id: 'C1' } }], {});
    expect(r.aceitas).toEqual([]);
    expect(r.erros).toHaveLength(1);
  });

  it('RN-INT-04: uma rota com duas paradas ausentes gera um erro por parada e a linha é recusada', () => {
    const registro = { vendedor_external_id: 'V1', paradas: [{ ordem: 1, cliente_external_id: 'X' }, { ordem: 2, cliente_external_id: 'Y' }] };
    const r = verificarReferencias('rota', [{ indice: 5, external_id: 'R1', registro }], { vendedor: new Set(['V1']), cliente: new Set() });
    expect(r.erros.map((e) => e.campo)).toEqual(['paradas[0].cliente_external_id', 'paradas[1].cliente_external_id']);
    expect(r.aceitas).toEqual([]);
  });
});
