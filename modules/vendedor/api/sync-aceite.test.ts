import { describe, expect, it, vi } from 'vitest';
import { CONSULTA_CANCELAMENTO_ERP } from '@macuxi/integracao/contracts';
import { PedidoSyncSchema } from '../contracts/sync';
import { marcarAceiteDeCancelamento } from './sync';

const linha = (status: string) => ({ id: status, status }) as never;
const txCom = (aceita: boolean) => ({ consultar: vi.fn(async () => ({ aceita })) }) as never;

describe('T-0138 (RN-VEN-31, exceção T-0114): o pull marca o aceite de cancelamento nos pedidos enviados/integrados', () => {
  it('RN-VEN-31: com o aceite, só enviado/integrado ganha a marca, com UMA consulta de licença tenant por página', async () => {
    const tx = txCom(true);
    const r = await marcarAceiteDeCancelamento([linha('sent_to_erp'), linha('integrated'), linha('invoiced'), linha('queued')], tx);
    expect(r.map((l) => (l as { erp_aceita_cancelamento?: boolean }).erp_aceita_cancelamento)).toEqual([true, true, undefined, undefined]);
    expect((tx as unknown as { consultar: ReturnType<typeof vi.fn> }).consultar).toHaveBeenCalledTimes(1);
    expect((tx as unknown as { consultar: ReturnType<typeof vi.fn> }).consultar).toHaveBeenCalledWith(CONSULTA_CANCELAMENTO_ERP, {}, { licenca: 'tenant' });
  });
  it('RN-VEN-31: sem o aceite, a linha segue sem a marca', async () => {
    const r = await marcarAceiteDeCancelamento([linha('integrated')], txCom(false));
    expect(r[0]).not.toHaveProperty('erp_aceita_cancelamento');
  });
  it('RN-VEN-31: página sem pedido enviado não consulta', async () => {
    const tx = txCom(true);
    await marcarAceiteDeCancelamento([linha('draft'), linha('approved')], tx);
    expect((tx as unknown as { consultar: ReturnType<typeof vi.fn> }).consultar).not.toHaveBeenCalled();
  });
  it('o schema do pull aceita a marca (opcional)', () => {
    expect(PedidoSyncSchema.shape.erp_aceita_cancelamento.safeParse(true).success).toBe(true);
    expect(PedidoSyncSchema.shape.erp_aceita_cancelamento.safeParse(undefined).success).toBe(true);
  });
});
