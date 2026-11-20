import { describe, expect, it } from 'vitest';
import { IDS_DOS_MODULOS, MODULOS_NATIVOS, nomeDoModulo } from './modulos';

describe('Mapa único dos módulos (R-20261114-143500; N-1 do v1017)', () => {
  it('os 8 ids da plataforma', () => {
    expect([...IDS_DOS_MODULOS].sort()).toEqual(['catalogo', 'core', 'gestor', 'integracao', 'pesquisa', 'promotor', 'treinamento', 'vendedor']);
  });
  it('Core, Integração e Catálogo são os nativos', () => {
    expect([...MODULOS_NATIVOS].sort()).toEqual(['catalogo', 'core', 'integracao']);
  });
  it('nome com maiúscula e acento, nunca o id', () => {
    expect(nomeDoModulo('catalogo')).toBe('Catálogo');
    expect(nomeDoModulo('integracao')).toBe('Integração com o ERP');
    expect(nomeDoModulo('novo_modulo')).toBe('novo_modulo');
  });
});
