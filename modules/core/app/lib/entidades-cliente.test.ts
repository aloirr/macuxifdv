import { describe, expect, it } from 'vitest';
import { entidadesCliente } from './entidades-cliente';

describe('RN-CORE-23 / RN-CORE-61: entidades de cliente na sincronização parcial (ADR 0057)', () => {
  it('só carteira, cliente, cliente_endereco e cliente_contato são parciais', () => {
    const parciais = entidadesCliente.filter((e) => e.parcial === true).map((e) => e.nome);
    expect(parciais.sort()).toEqual(['carteira', 'cliente', 'cliente_contato', 'cliente_endereco']);
  });

  it('cliente_financeiro e titulo não são parciais e nenhuma é de cadência diária', () => {
    for (const nome of ['cliente_financeiro', 'titulo']) {
      expect(entidadesCliente.find((e) => e.nome === nome)?.parcial).not.toBe(true);
    }
    expect(entidadesCliente.some((e) => e.cadencia === 'diaria')).toBe(false);
  });
});
