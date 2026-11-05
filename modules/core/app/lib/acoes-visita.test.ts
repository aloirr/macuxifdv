import { describe, expect, it, vi } from 'vitest';

vi.mock('./dispositivo', () => ({ uuid: () => '11111111-1111-4111-8111-111111111111', gpsAgora: async () => null }));

import type { CustomerSummary } from '../../contracts';
import { MSG_FALHA_CHECKIN, tentarCheckin, type ContextoAcao } from './acoes-visita';

const cliente = { id: '22222222-2222-4222-8222-222222222222', trade_name: 'Mercado Sol', lat: null, lng: null } as unknown as CustomerSummary;

function contexto(over: { enfileirar?: () => Promise<void>; carregar?: () => Promise<void> }): ContextoAcao {
  return {
    tz: 'America/Manaus',
    vendedorId: '33333333-3333-4333-8333-333333333333',
    motor: { enfileirar: over.enfileirar ?? (async () => {}), enviar: async () => {} },
    armazem: { obter: () => ({ visitas: [], raioCheckinM: null }), carregar: over.carregar ?? (async () => {}) },
  } as unknown as ContextoAcao;
}

describe('RN-CORE-10: falha ao gravar o check-in no aparelho não prende a folha', () => {
  it('RN-CORE-10: erro ao enfileirar vira { kind: erro } com mensagem em português e a ação seguinte', async () => {
    const r = await tentarCheckin(
      contexto({
        enfileirar: async () => {
          throw new Error('disk full');
        },
      }),
      cliente,
      null,
      { posicao: null },
    );
    expect(r).toEqual({ kind: 'erro', mensagem: MSG_FALHA_CHECKIN });
    expect(MSG_FALHA_CHECKIN).toMatch(/tentar de novo$/);
  });

  it('RN-CORE-10: visita que não aparece depois de gravar também vira erro (sem lançar)', async () => {
    const r = await tentarCheckin(contexto({}), cliente, null, { posicao: null });
    expect(r.kind).toBe('erro');
  });
});
