/**
 * ADR 0058: `modulos_contratados` de `GET /v1/me/modulos` lido de forma defensiva (campo aditivo e só de exibição).
 */
import { describe, expect, it } from 'vitest';

import { separarContratados } from './modulos-contratados';

const BASE = { modulos: [{ id: 'core' }], versao_licencas: 'v1', calculado_em: '2026-11-15T16:00:00Z' };

describe('modulos_contratados (ADR 0058)', () => {
  it('ausente: undefined (nada fica desativado) e a resposta segue igual', () => {
    expect(separarContratados(BASE)).toEqual({ resto: BASE, contratados: undefined });
  });

  it('presente: lido à parte e tirado da resposta (o schema é estrito)', () => {
    const { resto, contratados } = separarContratados({ ...BASE, modulos_contratados: ['core', 'promotor'] });
    expect(contratados).toEqual(['core', 'promotor']);
    expect(resto).toEqual(BASE);
  });

  it('inválido: undefined, sem derrubar a resposta', () => {
    expect(separarContratados({ ...BASE, modulos_contratados: ['nao-existe'] }).contratados).toBeUndefined();
    expect(separarContratados({ ...BASE, modulos_contratados: null }).resto).toEqual(BASE);
    expect(separarContratados(null)).toEqual({ resto: null, contratados: undefined });
  });
});
