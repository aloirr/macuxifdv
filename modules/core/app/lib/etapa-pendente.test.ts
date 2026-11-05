import { describe, expect, it } from 'vitest';

import { avisoDeEtapaPendente, visitaComEtapaPendente } from './etapa-pendente';

const v = (cliente: string, em: string, n?: number) => ({ customer_id: cliente, checkin_at: em, ...(n === undefined ? {} : { etapas_pendentes: n }) });

describe('RN-CORE-12: etapa pendente no aparelho (T-0039)', () => {
  it('RN-CORE-12: vale a visita mais recente ENTRE as que têm pendência (contagem maior que zero)', () => {
    const lista = [v('c1', '2026-11-04T12:00:00Z', 1), v('c1', '2026-11-05T12:00:00Z', 0), v('c2', '2026-11-05T13:00:00Z', 2)];
    expect(visitaComEtapaPendente(lista, 'c1')).toEqual({ checkin_at: '2026-11-04T12:00:00Z', etapas: 1 });
    expect(visitaComEtapaPendente(lista, 'c2')).toEqual({ checkin_at: '2026-11-05T13:00:00Z', etapas: 2 });
    expect(visitaComEtapaPendente(lista, 'c3')).toBeNull();
    expect(visitaComEtapaPendente([v('c1', '2026-11-05T12:00:00Z')], 'c1')).toBeNull();
  });

  const base = { agora: new Date('2026-11-05T15:00:00Z'), fuso: 'America/Manaus' };
  it('RN-CORE-12: uma etapa da visita de hoje, com fila e sinal', () => {
    expect(avisoDeEtapaPendente({ ...base, checkin_at: '2026-11-05T12:00:00Z', etapas: 1, naFila: 2, semSinal: false })).toEqual({
      linha1: 'Uma etapa da visita de hoje ainda não chegou ao Macuxi',
      linha2: 'Ela vai sozinha da fila quando houver sinal. Se a fila mostrar erro, fale com seu supervisor',
    });
  });
  it('RN-CORE-12: N etapas de outro dia usam dd/mm no fuso do tenant; sem sinal e fila vazia mudam a linha 2', () => {
    const r = avisoDeEtapaPendente({ ...base, checkin_at: '2026-11-04T12:00:00Z', etapas: 2, naFila: 1, semSinal: true });
    expect(r.linha1).toBe('2 etapas da visita de 04/11 ainda não chegaram ao Macuxi');
    expect(r.linha2).toBe('Elas vão sozinhas da fila quando houver sinal');
    expect(avisoDeEtapaPendente({ ...base, checkin_at: '2026-11-04T12:00:00Z', etapas: 3, naFila: 1, semSinal: false }).linha2).toBe('Elas vão sozinhas da fila quando houver sinal. Se a fila mostrar erro, fale com seu supervisor');
    expect(avisoDeEtapaPendente({ ...base, checkin_at: '2026-11-04T12:00:00Z', etapas: 1, naFila: 0, semSinal: false }).linha2).toBe('Fale com seu supervisor');
  });
});
