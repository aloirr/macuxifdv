import { ENTIDADES } from '@macuxi/integracao/contracts';
import { describe, expect, it } from 'vitest';
import { ORDEM_CARGA } from '../src/config/entidades';

describe('RN-INT-04: ordem de carga do Conector alinhada ao Hub', () => {
  it('RN-INT-04: toda entidade aparece uma vez e a faixa escalonada vem depois de produto e preco', () => {
    expect([...ORDEM_CARGA].sort()).toEqual([...ENTIDADES].sort());
    expect(ORDEM_CARGA.indexOf('tabela_escalonada')).toBeGreaterThan(ORDEM_CARGA.indexOf('preco'));
    expect(ORDEM_CARGA.indexOf('tabela_escalonada')).toBeGreaterThan(ORDEM_CARGA.indexOf('produto'));
  });
});
