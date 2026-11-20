import { describe, expect, it } from 'vitest';
import { linhasDoPerfil } from './perfil-dados';

describe('Perfil: dados do usuário em tabela de rótulo e valor', () => {
  it('RN-CORE-04: cargo, e-mail, empresa e gestor imediato, nessa ordem', () => {
    expect(linhasDoPerfil({ cargo: 'Vendedor', email: 'ana@x.com', empresa: 'Alfa', gestor: 'Sueli Lima' })).toEqual([
      { id: 'cargo', rotulo: 'Cargo', valor: 'Vendedor' },
      { id: 'email', rotulo: 'E-mail', valor: 'ana@x.com' },
      { id: 'empresa', rotulo: 'Empresa', valor: 'Alfa' },
      { id: 'gestor', rotulo: 'Gestor imediato', valor: 'Sueli Lima' },
    ]);
  });
  it('RN-CORE-04: sem gestor imediato (ou sem empresa) a linha não aparece', () => {
    expect(linhasDoPerfil({ cargo: 'Gerente', email: 'g@x.com', empresa: null, gestor: null }).map((l) => l.id)).toEqual(['cargo', 'email']);
    expect(linhasDoPerfil({ cargo: 'Gerente', email: 'g@x.com', empresa: ' ', gestor: undefined }).map((l) => l.id)).toEqual(['cargo', 'email']);
  });
});
