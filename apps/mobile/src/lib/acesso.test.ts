/** RD-0016: a decisão de acesso é testada no SDK (`acesso-sessao.test.ts`); aqui só a frase da lista da demonstração. */
import { describe, expect, it } from 'vitest';
import { ondeOPerfilEntra } from './acesso';

describe('onde o perfil entra (lista da demonstração)', () => {
  it('RN-CORE-33: supervisor só no Gestão; gerente no Gestão e no BKO; vendedor no Campo; admin no BKO', () => {
    expect(ondeOPerfilEntra('supervisor')).toBe('o app Macuxi Gestão');
    expect(ondeOPerfilEntra('gerente')).toBe('o app Macuxi Gestão ou o backoffice (web)');
    expect(ondeOPerfilEntra('vendedor')).toBe('o app Macuxi Campo');
    expect(ondeOPerfilEntra('admin')).toBe('o backoffice (web)');
    expect(ondeOPerfilEntra(null)).toBeNull();
  });
});
