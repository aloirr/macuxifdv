'use client';

import { KpiCard, KpiGrid } from '@macuxi/ui/web';
import { cardsPedidosErp } from '../../lib/cards-erp';
import { usePedidosNoErp } from '../../lib/queries';

/**
 * Cards "Pedidos no ERP" (T-0173, RN-INT-08; spec §8 de docs/design/integracao-simples). Só informativos: sem clique e sem
 * filtro. Sem dados (módulo Integração sem licença, sem permissão ou fora do ar) não renderiza nada.
 * Os erros de retorno ficam só na área Alertas da Integração (RN-VEN-42).
 */
export function CardsPedidosErp() {
  const { data } = usePedidosNoErp();
  if (!data) return null;
  return (
    <section aria-label="Pedidos no ERP" data-testid="pedidos.cards-erp">
      <KpiGrid min={150}>
        {cardsPedidosErp(data).map((c) => (
          <div key={c.id} data-testid={`pedidos.card-erp.${c.id}`}>
            <KpiCard label={c.rotulo} value={c.valor} valueClass={c.tom === 'danger' ? 'text-danger' : c.tom === 'warning' ? 'text-warning' : undefined} />
          </div>
        ))}
      </KpiGrid>
    </section>
  );
}
