'use client';

import type { ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatBRL, formatPct } from '@macuxi/comum';
import type { Role } from '@macuxi/core/contracts';
import { api, ApiRequestError, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, Drawer, ErrorBlock, formatDateTime, LoadingBlock, Notice, td, tdNum, th, thNum, useToast } from '@macuxi/ui/web';
import { ORDER_STATUS_LABEL, type Order, type OrderStatus } from '../../../contracts';
import { enviadoAoErp, MSG_CANCELAR_APOS_ENVIO } from '../../../domain/order';
import { useOrderDetail } from '../../lib/queries';
import { OrderStatusBadge } from './status';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[12px] text-ink-2">{label}</span>
      <span className="text-[14px] font-medium">{children}</span>
    </div>
  );
}

export function OrderDrawer({ order, tz, role, onClose }: { order: Order | null; tz: string; role: Role | undefined; onClose: () => void }) {
  const detail = useOrderDetail(order?.id ?? null);
  const qc = useQueryClient();
  const toast = useToast();
  const o = detail.data ?? order;

  const resend = useMutation({
    mutationFn: (id: string) => api<Order>(`/orders/${id}/resend`, { method: 'POST', body: {} }),
    onSuccess: (res) => toast('success', `Pedido ${res.number} reenviado ao ERP · registrado na auditoria`),
    onError: (e) => toast(e instanceof ApiRequestError && e.isFileLocked ? 'warning' : 'danger', errorMessage(e)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['dashboards'] });
      void qc.invalidateQueries({ queryKey: ['order'] });
    },
  });

  const canResend = role === 'bko_assistant' || role === 'analyst' || role === 'manager' || role === 'admin';

  return (
    <Drawer
      open={!!order}
      onClose={onClose}
      title={o ? <span className="font-mono">Pedido {o.number}</span> : 'Pedido'}
      subtitle={o ? `${o.customer_name} · ${o.seller_name}` : undefined}
    >
      {o && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusBadge status={o.status} />
            {o.erp_order_code && <span className="text-[12px] text-ink-2">ERP {o.erp_order_code}</span>}
            {o.status === 'rejected' && canResend && (
              <Button size="sm" className="ml-auto" disabled={resend.isPending} onClick={() => resend.mutate(o.id)}>
                {resend.isPending ? 'Reenviando…' : 'Reenviar ao ERP'}
              </Button>
            )}
          </div>
          {enviadoAoErp(o.status) && <Notice tone="info">{MSG_CANCELAR_APOS_ENVIO}</Notice>}
          {o.status === 'pending_approval' && o.pending_reason && <Notice tone="warning">{o.pending_reason}</Notice>}
          {o.status === 'rejected' && o.rejection_reason && <Notice tone="danger">Motivo: {o.rejection_reason}</Notice>}

          <div className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface p-4">
            <Field label="Filial">{o.branch_name}</Field>
            <Field label="Condição">{o.payment_terms}</Field>
            <Field label="Recebido">{formatDateTime(o.received_at, tz)}</Field>
            <Field label="Feito sem sinal">{o.created_offline_at ? formatDateTime(o.created_offline_at, tz) : 'Não'}</Field>
            <Field label="Itens">
              {o.items_count} itens · {o.units} un.
            </Field>
            <Field label="Desconto">{formatPct(o.discount_pct)}</Field>
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-4 text-[14px] tabular-nums">
            <div className="flex justify-between">
              <span className="text-ink-2">Subtotal</span>
              <span>{formatBRL(o.subtotal_cents)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-2">Desconto ({formatPct(o.discount_pct)})</span>
              <span>− {formatBRL(o.discount_cents)}</span>
            </div>
            <div className="flex justify-between border-t border-line-2 pt-1.5 font-display text-[18px] font-extrabold">
              <span>Total</span>
              <span>{formatBRL(o.total_cents)}</span>
            </div>
          </div>

          {detail.isPending && <LoadingBlock label="Carregando itens e histórico…" />}
          {detail.isError && <ErrorBlock message={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />}
          {detail.data && (
            <>
              <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
                <h3 className="m-0 font-display text-[16px] font-bold">Itens</h3>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[460px] border-collapse text-[13px]">
                    <thead>
                      <tr>
                        <th scope="col" className={th}>Código</th>
                        <th scope="col" className={th}>Descrição</th>
                        <th scope="col" className={thNum}>Qtd</th>
                        <th scope="col" className={thNum}>Unitário</th>
                        <th scope="col" className={thNum}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.data.items.map((it) => (
                        <tr key={it.id}>
                          <td className={`${td} font-mono whitespace-nowrap`}>{it.erp_code}</td>
                          <td className={td}>{it.description}</td>
                          <td className={tdNum}>{it.quantity}</td>
                          <td className={`${tdNum} whitespace-nowrap`}>{formatBRL(it.unit_price_cents)}</td>
                          <td className={`${tdNum} whitespace-nowrap`}>{formatBRL(it.total_cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
                <h3 className="m-0 font-display text-[16px] font-bold">Histórico</h3>
                <ol className="m-0 flex list-none flex-col gap-3 p-0">
                  {detail.data.history.map((h, i) => (
                    <li key={`${h.at}-${i}`} className="flex gap-3">
                      <span className="w-[92px] shrink-0 text-[12px] text-ink-2 tabular-nums">{formatDateTime(h.at, tz)}</span>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-[13px] font-semibold">
                          {ORDER_STATUS_LABEL[h.status as OrderStatus] ?? h.status} <span className="font-normal text-ink-2">· {h.by}</span>
                        </span>
                        {h.note && <span className="text-[12px] text-ink-2">{h.note}</span>}
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}
