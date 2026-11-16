import { describe, expect, it } from 'vitest';
import { logoParaPdf, logoSrcDoPdf, nomeDaEmpresaParaPdf } from './empresa-pdf';

describe('logoParaPdf (T-0182, MC-0134, RD-0705)', () => {
  it('T-0182: devolve a logo cadastrada da empresa', async () => {
    expect(await logoParaPdf({ logoDaEmpresa: async () => 'data:image/png;base64,AAAA' })).toBe('data:image/png;base64,AAAA');
  });
  it('T-0182: sem logo, ambiente sem a função ou erro (síncrono ou não) = null', async () => {
    expect(await logoParaPdf({ logoDaEmpresa: async () => null })).toBeNull();
    expect(await logoParaPdf({})).toBeNull();
    expect(await logoParaPdf({ logoDaEmpresa: async () => { throw new Error('sem rede'); } })).toBeNull();
    expect(await logoParaPdf({ logoDaEmpresa: () => { throw new Error('falha'); } })).toBeNull();
  });
});

describe('logoSrcDoPdf (RD-1744)', () => {
  it('RD-1744: com logo devolve { logo_src }; sem logo, string vazia ou erro devolve {}', async () => {
    expect(await logoSrcDoPdf({ logoDaEmpresa: async () => 'data:image/png;base64,AAAA' })).toEqual({ logo_src: 'data:image/png;base64,AAAA' });
    expect(await logoSrcDoPdf({ logoDaEmpresa: async () => null })).toEqual({});
    expect(await logoSrcDoPdf({ logoDaEmpresa: async () => '' })).toEqual({});
    expect(await logoSrcDoPdf({})).toEqual({});
  });
});

describe('nomeDaEmpresaParaPdf (T-0182, RD-0920, MC-0404)', () => {
  it('RD-0920: o nome vem de empresa_nome dos parâmetros do Core e tenant_nome não conta', () => {
    expect(nomeDaEmpresaParaPdf({ empresa_nome: ' Norte Bebidas ', tenant_nome: 'Outro' })).toBe('Norte Bebidas');
  });
  it('MC-0404: sem nome da empresa o texto fica vazio, nunca "Macuxi"', () => {
    expect(nomeDaEmpresaParaPdf({ tenant_nome: 'Norte' })).toBe('');
    expect(nomeDaEmpresaParaPdf({ empresa_nome: '  ' })).toBe('');
    expect(nomeDaEmpresaParaPdf(undefined)).toBe('');
  });
});
