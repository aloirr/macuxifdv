import { describe, expect, it } from 'vitest';

import { pedidosDaLista, rotuloDaAba, subtituloDaLista } from './lista-pedidos';

const base = { local: false, local_error: '' };
const ped = (id: string, received_at: string, extra: object = {}) => ({ id, received_at, status: 'approved', total_cents: 100, ...base, ...extra }) as never;

describe('lista de pedidos', () => {
  it('Gestão não mostra Na fila nem Integrados', () => {
    expect(rotuloDaAba('queued', true)).toBe(false);
    expect(rotuloDaAba('queued', false)).toBe(true);
  });
  it('Campo: só o mês corrente no fuso do tenant, mais fila e pendentes; Gestão: toda a janela', () => {
    const lista = [
      ped('a', '2026-11-01T03:30:00Z'), // 31/10 23:30 em Manaus: mês anterior
      ped('b', '2026-11-01T04:30:00Z'), // 01/11 00:30 em Manaus
      ped('c', '2026-09-10T12:00:00Z', { status: 'pending_approval' }),
      ped('d', '2026-09-10T12:00:00Z', { local: true }),
      ped('e', '2026-09-10T12:00:00Z'),
    ];
    const campo = pedidosDaLista(lista, { gestao: false, mes: '2026-11', tz: 'America/Manaus' }).map((o) => o.id);
    expect(campo).toEqual(['b', 'c', 'd']);
    expect(pedidosDaLista(lista, { gestao: true, mes: '2026-11', tz: 'America/Manaus' })).toHaveLength(5);
  });
  it('subtítulo: o Campo mostra o mês; a Gestão mostra "Equipe" (a lista não é filtrada por mês)', () => {
    expect(subtituloDaLista({ gestao: false, mesNome: 'Novembro', quantidade: 2, totalTexto: 'R$ 1' })).toBe('Novembro · 2 pedidos · R$ 1');
    expect(subtituloDaLista({ gestao: true, mesNome: 'Novembro', quantidade: 1, totalTexto: 'R$ 1' })).toBe('Equipe · 1 pedido · R$ 1');
  });
});
