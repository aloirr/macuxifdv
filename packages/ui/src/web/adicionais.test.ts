import { describe, expect, it } from 'vitest';
import { ADICIONAIS_DO_PLANO, iconeDoAdicional, nomeDoAdicional } from './adicionais';
import { IconPesquisa, IconPromotor, IconTreinamento } from './icons';
import { nomeDoModulo } from './modulos';

// MC-0042 e RD-0366: um mapa só. Nome e ícone vêm do mapa dos módulos (`modulos.tsx`).
describe('adicionais do plano', () => {
  it('cobre os três adicionais do contrato, na ordem da tela', () => {
    expect(ADICIONAIS_DO_PLANO.map((a) => a.id)).toEqual(['promotor', 'pesquisa', 'treinamento']);
  });

  it('nome com maiúscula e ícone próprio de cada um', () => {
    expect(nomeDoAdicional('promotor')).toBe('Promotor');
    expect(nomeDoAdicional('pesquisa')).toBe('Pesquisa');
    expect(nomeDoAdicional('treinamento')).toBe('Treinamento');
    expect(iconeDoAdicional('promotor')).toBe(IconPromotor);
    expect(iconeDoAdicional('pesquisa')).toBe(IconPesquisa);
    expect(iconeDoAdicional('treinamento')).toBe(IconTreinamento);
    expect(new Set(ADICIONAIS_DO_PLANO.map((a) => a.Icone)).size).toBe(3);
  });

  it('o nome é o do mapa dos módulos (RD-0366)', () => {
    for (const a of ADICIONAIS_DO_PLANO) expect(a.nome).toBe(nomeDoModulo(a.id));
  });

  it('id desconhecido: o nome volta como veio e sem ícone', () => {
    expect(nomeDoAdicional('outro')).toBe('outro');
    expect(iconeDoAdicional('outro')).toBeUndefined();
  });
});
