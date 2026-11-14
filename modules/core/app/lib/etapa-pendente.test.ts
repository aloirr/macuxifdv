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
  it('RD-0181 RN-CORE-12: com a etapa na fila a faixa não aparece (a fila sobe sozinha)', () => {
    expect(avisoDeEtapaPendente({ ...base, checkin_at: '2026-11-05T12:00:00Z', etapas: 1, naFila: 2 })).toBeNull();
    expect(avisoDeEtapaPendente({ ...base, checkin_at: '2026-11-04T12:00:00Z', etapas: 3, naFila: 1 })).toBeNull();
  });
  it('RD-0181 RN-CORE-12: sem item na fila a faixa pede ação ao supervisor, no fuso do tenant', () => {
    expect(avisoDeEtapaPendente({ ...base, checkin_at: '2026-11-05T12:00:00Z', etapas: 1, naFila: 0 })).toEqual({ linha1: 'Uma etapa da visita de hoje não chegou', linha2: 'Fale com seu supervisor' });
    expect(avisoDeEtapaPendente({ ...base, checkin_at: '2026-11-04T12:00:00Z', etapas: 2, naFila: 0 })).toEqual({ linha1: '2 etapas da visita de 04/11 não chegaram', linha2: 'Fale com seu supervisor' });
  });
});
