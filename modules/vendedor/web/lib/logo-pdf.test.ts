import { describe, expect, it } from 'vitest';
import { logoParaPdf } from './logo-pdf';

describe('logoParaPdf (T-0182, MC-0134)', () => {
  it('T-0182: devolve a logo cadastrada da empresa', async () => {
    expect(await logoParaPdf({ logoDaEmpresa: async () => 'data:image/png;base64,AAAA' })).toBe('data:image/png;base64,AAAA');
  });
  it('T-0182: sem logo, ambiente sem a função ou erro = null (logo padrão; o PDF sai sempre)', async () => {
    expect(await logoParaPdf({ logoDaEmpresa: async () => null })).toBeNull();
    expect(await logoParaPdf({})).toBeNull();
    expect(await logoParaPdf({ logoDaEmpresa: async () => { throw new Error('sem rede'); } })).toBeNull();
    expect(await logoParaPdf({ logoDaEmpresa: () => { throw new Error('falha'); } })).toBeNull();
  });
});
