import { describe, expect, it } from 'vitest';

import { contarPorSituacao, filtrarLista, itemNaSituacao, periodoDe, resumoDaSituacao, type ItemDaBusca } from '../../domain/busca-periodo';

const TZ = 'America/Manaus';
const AGORA = new Date('2026-11-06T14:00:00Z');
const STATUS = ['approved', 'pending_approval', 'integrated', 'invoiced', 'cancelled'] as const;

function pedidos(n: number): ItemDaBusca[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    numero: String(i + 1).padStart(6, '0'),
    nome_fantasia: `Cliente ${i % 80}`,
    razao_social: `Razão Social ${i % 80} Ltda`,
    tipo: i % 7 === 0 ? 'orcamento' : 'pedido',
    status: STATUS[i % STATUS.length]!,
    local: i % 50 === 0,
    total_cents: 10_000 + i,
    emitido_em: new Date(AGORA.getTime() - (i % 400) * 86_400_000).toISOString(),
    status_alterado_em: null,
  })) as ItemDaBusca[];
}

describe('Pedidos: trocar período e situação filtra a memória (T-0090, meta < 100 ms para 500 pedidos)', () => {
  it('RF-VEN-05: filtrar por Dia, Mês e Ano + contagem + situação + resumo de 500 pedidos leva < 100 ms', () => {
    const lista = pedidos(500);
    // a primeira passada calcula a data civil de cada pedido (uma vez, ao abrir a tela); as trocas seguintes reaproveitam
    filtrarLista(lista, { periodo: periodoDe('mes', AGORA, TZ), busca: '', tz: TZ });
    const t0 = performance.now();
    for (const tipo of ['dia', 'mes', 'ano'] as const) {
      const base = filtrarLista(lista, { periodo: periodoDe(tipo, AGORA, TZ), busca: '', tz: TZ });
      contarPorSituacao(base);
      const vis = base.filter((i) => itemNaSituacao(i, 'todos'));
      resumoDaSituacao(vis, 'todos');
    }
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(100);
  });
});
