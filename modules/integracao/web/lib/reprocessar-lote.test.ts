import { describe, expect, it, vi } from 'vitest';
import { reprocessarLote } from './reprocessar-lote';

const LOTE = '3f0c1a52-8a5e-4d2b-9a6f-1c2d3e4f5a6b';
const resposta = { lote_id: LOTE, reenfileiradas: 3, status: 'processando' };

describe('RN-INT-15/16: reprocessarLote', () => {
  it('RN-INT-15: chama o POST do lote com corpo vazio e valida a resposta', async () => {
    const chamar = vi.fn().mockResolvedValue(resposta);
    const r = await reprocessarLote({ chamar } as never, 'a b');
    expect(chamar).toHaveBeenCalledWith('/integracao/lotes/a%20b/reprocessar', { method: 'POST', body: {} });
    expect(r.reenfileiradas).toBe(3);
  });

  it('RN-INT-16: leva autorizador e senha no corpo só quando vêm os dois', async () => {
    const chamar = vi.fn().mockResolvedValue(resposta);
    await reprocessarLote({ chamar } as never, LOTE, { autorizadorId: 'u1', senha: 's' });
    expect(chamar.mock.calls[0]![1].body).toEqual({ autorizador_id: 'u1', senha: 's' });
    await reprocessarLote({ chamar } as never, LOTE, { autorizadorId: 'u1' });
    expect(chamar.mock.calls[1]![1].body).toEqual({});
  });

  it('rejeita resposta fora do contrato', async () => {
    await expect(reprocessarLote({ chamar: async () => ({ x: 1 }) } as never, LOTE)).rejects.toThrow();
  });
});
