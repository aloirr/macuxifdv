import { ORDEM_CARGA_ENTIDADES } from '@macuxi/integracao/contracts';
import { describe, expect, it } from 'vitest';
import { ORDEM_CARGA } from '../src/config/entidades';

describe('RN-INT-04: ordem de carga do Conector alinhada ao Hub', () => {
  it('RN-INT-04: o Conector usa a lista única do contrato (a conferência das dependências está em domain/ordem.test.ts)', () => {
    expect(ORDEM_CARGA).toBe(ORDEM_CARGA_ENTIDADES);
  });
});
