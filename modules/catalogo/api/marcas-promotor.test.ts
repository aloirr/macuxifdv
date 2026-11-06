/** RN-CAT-09: marcas pelo `promotor.concorrentes@1`; consulta indisponível vira lista vazia (ADR 0027, risco 1). */
import { describe, expect, it, vi } from 'vitest';
import { ConsultaIndisponivel, type TransacaoTenant } from '@macuxi/platform-sdk';
import { MARCAS_DO_PROMOTOR } from './repositorio-postgres';

const ID = '00000000-0000-4000-8000-0000000000a1';

describe('MARCAS_DO_PROMOTOR', () => {
  it('RN-CAT-09: pede também as inativas ao Promotor e devolve id → nome e situação', async () => {
    const consultar = vi.fn(async () => ({ concorrentes: [{ id: ID, nome: 'Freiomax', ativo: false, external_id: null }] }));
    const m = await MARCAS_DO_PROMOTOR({ consultar } as unknown as TransacaoTenant);
    expect(m.get(ID)).toEqual({ nome: 'Freiomax', ativo: false });
    expect(consultar).toHaveBeenCalledWith(expect.objectContaining({ nome: 'promotor.concorrentes@1' }), { incluir_inativos: true });
  });
  it('RN-CAT-09: Promotor indisponível para o tenant ou usuário = lista vazia, sem erro', async () => {
    const consultar = vi.fn(async () => {
      throw new ConsultaIndisponivel('promotor.concorrentes@1', 'promotor', 'sem licença');
    });
    expect((await MARCAS_DO_PROMOTOR({ consultar } as unknown as TransacaoTenant)).size).toBe(0);
  });
  it('RN-CAT-09: outro erro não é engolido', async () => {
    const consultar = vi.fn(async () => {
      throw new Error('falha');
    });
    await expect(MARCAS_DO_PROMOTOR({ consultar } as unknown as TransacaoTenant)).rejects.toThrow('falha');
  });
});
