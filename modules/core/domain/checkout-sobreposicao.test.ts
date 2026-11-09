/** T-0140 / relato 5: o fechamento sobreposto às linhas do pull (ADR 0009 §3, D-3) não reabre a visita por conta própria. */
import { describe, expect, it } from 'vitest';
import { aplicarPendentesVisita, type VisitaLinha } from './checkin';

const MANAUS = 'America/Manaus';
const aberta: VisitaLinha = {
  id: 'v1', usuario_id: 'u1', cliente_id: 'c1', rota_parada_id: null, data_local: '2026-11-08', checkin_em: '2026-11-08T14:00:00Z',
  sem_gps: false, fora_do_raio: false, sugere_coordenada: false, extra: false, checkout_em: null, resultado: null, fechada_por: null,
};
const checkout = { tipo: 'checkout' as const, id: 'cmd1', visita_id: 'v1', checkout_em: '2026-11-08T14:30:00Z', resultado: 'sem_pedido', motivo_id: 'm1' };
const ctx = { usuario_id: 'u1', fuso: MANAUS };

describe('RN-CORE-12: checkout sobreposto às linhas do pull', () => {
  it('RN-CORE-12: checkout pendente na fila fecha a visita na tela', () => {
    expect(aplicarPendentesVisita([aberta], [checkout], ctx)[0]?.checkout_em).toBe(checkout.checkout_em);
  });
  it('RN-CORE-12: checkout aceito e pull ainda velho (linha sem checkout): a visita continua fechada (D-3)', () => {
    expect(aplicarPendentesVisita([aberta], [checkout], ctx)[0]?.checkout_em).not.toBeNull();
  });
  it('RN-CORE-12: checkout rejeitado e descartado da fila: a visita volta a ficar aberta (o aviso do servidor é o único sinal)', () => {
    expect(aplicarPendentesVisita([aberta], [], ctx)[0]?.checkout_em).toBeNull();
  });
  it('RN-CORE-12: linha do pull já com este checkout não é sobrescrita pelo pendente', () => {
    const linha = { ...aberta, checkout_em: '2026-11-08T14:31:00Z', checkout_id: 'cmd1' } as VisitaLinha;
    expect(aplicarPendentesVisita([linha], [checkout], ctx)[0]?.checkout_em).toBe('2026-11-08T14:31:00Z');
  });
});
