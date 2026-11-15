'use client';

import { KpiCard, KpiGrid } from '@macuxi/ui/web';
import { cardsPedidosErp, statusDoCard } from '../../lib/cards-erp';
import { usePedidosNoErp } from '../../lib/queries';

/**
 * Cards "Pedidos no ERP" (T-0173, RN-INT-08; spec §8 de docs/design/integracao-simples). Cada card é um botão que filtra a
 * lista pelo status. Sem dados (módulo Integração sem licença, sem permissão ou fora do ar) não renderiza nada.
 * Os erros de retorno ficam só na área Alertas da Integração (RN-VEN-42).
 */
export function CardsPedidosErp({ status, aoFiltrar }: { status: string; aoFiltrar: (status: string) => void }) {
  const { data } = usePedidosNoErp();
  if (!data) return null;
  return (
    <section aria-label="Pedidos no ERP" data-testid="pedidos.cards-erp">
      <KpiGrid min={150}>
        {cardsPedidosErp(data).map((c) => {
          const proximo = statusDoCard(c.id, status);
          const ativo = proximo === '';
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={ativo}
              onClick={() => aoFiltrar(proximo)}
              className={`min-h-[44px] cursor-pointer rounded-[14px] border-0 bg-transparent p-0 text-left outline-offset-2 focus-visible:outline-2 ${ativo ? 'ring-2 ring-ink' : ''}`}
              data-testid={`pedidos.card-erp.${c.id}`}
            >
              <KpiCard label={c.rotulo} value={c.valor} valueClass={c.tom === 'danger' ? 'text-danger' : c.tom === 'warning' ? 'text-warning' : undefined} />
            </button>
          );
        })}
      </KpiGrid>
    </section>
  );
}
