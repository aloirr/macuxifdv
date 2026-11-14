import { describe, expect, it } from 'vitest';
import { ADICIONAIS_DO_PLANO, iconeDoAdicional, nomeDoAdicional } from './adicionais';
import { IconPesquisa, IconPromotor, IconTreinamento } from './icons';

// MC-0042: um mapa só, id do contrato → nome → ícone.
describe('adicionais do plano', () => {
  it('cobre os três adicionais do contrato, na ordem da tela', () => {
    expect(ADICIONAIS_DO_PLANO.map((a) => a.id)).toEqual(['promotor', 'pesquisa', 'treinamento']);
  });

  it('nome com maiúscula e ícone próprio de cada um', () => {
    expect(nomeDoAdicional('promotor')).toBe('Promotor Avulso');
    expect(nomeDoAdicional('pesquisa')).toBe('Pesquisa');
    expect(nomeDoAdicional('treinamento')).toBe('Treinamento');
    expect(iconeDoAdicional('promotor')).toBe(IconPromotor);
    expect(iconeDoAdicional('pesquisa')).toBe(IconPesquisa);
    expect(iconeDoAdicional('treinamento')).toBe(IconTreinamento);
    expect(new Set(ADICIONAIS_DO_PLANO.map((a) => a.Icone)).size).toBe(3);
  });

  it('id desconhecido: o nome volta como veio e sem ícone', () => {
    expect(nomeDoAdicional('outro')).toBe('outro');
    expect(iconeDoAdicional('outro')).toBeUndefined();
  });
});
