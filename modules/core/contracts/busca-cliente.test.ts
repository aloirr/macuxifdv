import { describe, expect, it } from 'vitest';
import * as contrato from './busca-cliente';
import * as dominio from '../domain/clientes';

describe('busca de clientes (contrato)', () => {
  it('RD-1229: o domain reexporta a mesma regra do contrato', () => {
    expect(dominio.clienteCasaBusca).toBe(contrato.clienteCasaBusca);
    expect(dominio.normalizarBusca).toBe(contrato.normalizarBusca);
    expect(dominio.documentoCasa).toBe(contrato.documentoCasa);
  });
  it('RD-1229: casa por código, CNPJ com máscara, razão social e fantasia, sem acento', () => {
    const c = { external_id: 'C-100', razao_social: 'Mercado São João', nome_fantasia: 'Mercadinho', documento: '12345678000190' };
    expect(contrato.clienteCasaBusca('c-100', c)).toBe(true);
    expect(contrato.clienteCasaBusca('12.345.678', c)).toBe(true);
    expect(contrato.clienteCasaBusca('sao joao', c)).toBe(true);
    expect(contrato.clienteCasaBusca('mercadinho', c)).toBe(true);
    expect(contrato.clienteCasaBusca('12', c)).toBe(false);
  });
});
