import { describe, expect, it } from 'vitest';
import { MODULOS } from '@macuxi/platform-sdk';

import { ehModuloSempre, modulosDoPortal } from './portal-modulos';

describe('módulos do portal (RD-2617)', () => {
  it('só Core e Integração entram sempre; o Catálogo é opcional', () => {
    expect(MODULOS.filter(ehModuloSempre)).toEqual(['core', 'integracao']);
    expect(ehModuloSempre('catalogo')).toBe(false);
  });
  it('lista: Catálogo e os contratáveis, com o nome do kit, em ordem alfabética', () => {
    expect(modulosDoPortal(MODULOS).map((m) => m.nome)).toEqual(['Catálogo', 'Gestor', 'Pesquisa', 'Promotor', 'Treinamento', 'Vendedor']);
    expect(modulosDoPortal(['core', 'vendedor']).map((m) => m.id)).toEqual(['vendedor']);
  });
});
