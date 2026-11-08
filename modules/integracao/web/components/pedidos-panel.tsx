'use client';

import { Badge, Panel } from '@macuxi/ui/web';
import { ESTADOS_PEDIDO_ERP, type AlertaMonitor, type MonitorResumo } from '../../contracts';
import { ROTULO_ESTADO_PEDIDO } from '../lib/apresentacao';

/** Alertas da fila de pedidos e do retorno do ERP (RN-INT-08, P-4; cancelamento recusado pelo ERP, T-0114). */
const ALERTAS_DE_PEDIDO: ReadonlySet<AlertaMonitor['codigo']> = new Set(['pedido_preso', 'pedido_retido_sem_mapeamento', 'retorno_com_itens_descartados', 'cancelamento_recusado']);

const ROTULO_ALERTA_PEDIDO: Partial<Record<AlertaMonitor['codigo'], string>> = {
  retorno_com_itens_descartados: 'Itens descartados',
  pedido_preso: 'Preso',
  cancelamento_recusado: 'Cancelamento recusado',
};

/**
 * Pedidos no ERP (RN-INT-08): contagem por estado, presos (entregues ao Conector várias vezes sem retorno) e retidos sem
 * mapeamento, e os erros de retorno (itens faturados descartados nas últimas 24 h, P-4) vindos dos alertas do monitor.
 */
export function PedidosPanel({ pedidos, alertas }: { pedidos: MonitorResumo['pedidos']; alertas: readonly AlertaMonitor[] }) {
  const deRetorno = alertas.filter((a) => ALERTAS_DE_PEDIDO.has(a.codigo));
  return (
    <Panel label="Pedidos no ERP" title="Pedidos no ERP">
      <dl className="m-0 grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2" data-testid="integracao.pedidos">
        {ESTADOS_PEDIDO_ERP.map((e) => (
          <div key={e} className="rounded-xl border border-line-2 p-2">
            <dt className="text-[12px] text-ink-2">{ROTULO_ESTADO_PEDIDO[e]}</dt>
            <dd className="m-0 text-[18px] font-bold tabular-nums">{pedidos.por_estado[e] ?? 0}</dd>
          </div>
        ))}
        <div className="rounded-xl border border-line-2 p-2">
          <dt className="text-[12px] text-ink-2">Presos sem retorno</dt>
          <dd className={`m-0 text-[18px] font-bold tabular-nums ${pedidos.presos > 0 ? 'text-danger' : ''}`}>{pedidos.presos}</dd>
        </div>
        <div className="rounded-xl border border-line-2 p-2">
          <dt className="text-[12px] text-ink-2">Retidos sem mapeamento</dt>
          <dd className={`m-0 text-[18px] font-bold tabular-nums ${pedidos.retidos > 0 ? 'text-warning' : ''}`}>{pedidos.retidos}</dd>
        </div>
      </dl>

      <h3 className="m-0 mt-2 text-[14px] font-semibold">Erros de retorno</h3>
      {deRetorno.length === 0 ? (
        <span className="text-[13px] text-ink-2" data-testid="integracao.retornos.vazio">
          Nenhum erro de retorno do ERP nem cancelamento recusado.
        </span>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="integracao.retornos">
          {deRetorno.map((a, i) => (
            <li key={`${a.codigo}-${i}`} className="flex items-start gap-2 text-[14px]" data-testid={`integracao.retorno.${a.codigo}`}>
              <Badge tone={a.severidade === 'critico' ? 'danger' : 'warning'}>{ROTULO_ALERTA_PEDIDO[a.codigo] ?? 'Retido'}</Badge>
              <span>{a.mensagem}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
