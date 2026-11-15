import { describe, expect, it } from 'vitest';
import { filiaisInexistentes, perfilEditaFilial, validarFiliaisDoUsuario, vendedorBloqueadoPorFilial } from './filial-usuario';

const F1 = '0f000000-0000-4000-8000-000000000001';
const F2 = '0f000000-0000-4000-8000-000000000002';

describe('RN-CORE-39: filiais do usuário por cargo', () => {
  it('RN-CORE-39: vendedor tem exatamente 1 filial', () => {
    expect(validarFiliaisDoUsuario('vendedor', [F1])).toBeNull();
    expect(validarFiliaisDoUsuario('vendedor', [])).toEqual({ codigo: 'USUARIO_FILIAL_QUANTIDADE', mensagem: 'Escolha a filial do vendedor.' });
    expect(validarFiliaisDoUsuario('vendedor', [F1, F2])?.mensagem).toBe('Escolha a filial do vendedor.');
  });
  it('RN-CORE-39: a mesma filial repetida conta uma vez', () => {
    expect(validarFiliaisDoUsuario('vendedor', [F1, F1])).toBeNull();
  });
  it.each(['supervisor', 'promotor', 'gerente'] as const)('RN-CORE-39: %s tem 1 ou mais filiais', (cargo) => {
    expect(validarFiliaisDoUsuario(cargo, [F1])).toBeNull();
    expect(validarFiliaisDoUsuario(cargo, [F1, F2])).toBeNull();
    expect(validarFiliaisDoUsuario(cargo, [])).toEqual({ codigo: 'USUARIO_FILIAL_QUANTIDADE', mensagem: 'Escolha ao menos uma filial.' });
  });
  it('RN-CORE-39: admin e analista (administrativo) têm 0 ou mais', () => {
    expect(validarFiliaisDoUsuario('administrativo', [])).toBeNull();
    expect(validarFiliaisDoUsuario('administrativo', [F1, F2])).toBeNull();
    expect(validarFiliaisDoUsuario(null, [])).toBeNull();
  });
  it('RN-CORE-39: filial inexistente, excluída ou de outro tenant (fora das existentes) é recusada', () => {
    expect(filiaisInexistentes([F1, F2], [F1])).toEqual([F2]);
    expect(filiaisInexistentes([F1, F1], [F1])).toEqual([]);
    expect(filiaisInexistentes([], [])).toEqual([]);
  });
  it('RN-CORE-39: vendedor sem filial fica bloqueado; com filial ou de outro cargo, não', () => {
    expect(vendedorBloqueadoPorFilial({ cargo: 'vendedor', filiais: [] })).toBe(true);
    expect(vendedorBloqueadoPorFilial({ cargo: 'vendedor', filiais: [F1] })).toBe(false);
    expect(vendedorBloqueadoPorFilial({ cargo: 'supervisor', filiais: [] })).toBe(false);
    expect(vendedorBloqueadoPorFilial({ cargo: null, filiais: [] })).toBe(false);
  });
  it('RN-CORE-39: só admin e analista editam a filial', () => {
    expect(perfilEditaFilial('admin')).toBe(true);
    expect(perfilEditaFilial('analista')).toBe(true);
    for (const p of ['vendedor', 'promotor', 'supervisor', 'gerente']) expect(perfilEditaFilial(p)).toBe(false);
  });
});
