'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatBRL } from '@macuxi/comum';
import { api, ApiRequestError, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, Dialog, formatAge, Notice, Panel, type NoticeTone } from '@macuxi/ui/web';
import type { Order } from '../../../contracts';

const REASON_MIN = 3;

export function ApprovalsPanel({ approvals, canDecide, nowMs, onOpen }: { approvals: Order[]; canDecide: boolean; nowMs: number; onOpen: (o: Order) => void }) {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const [rejecting, setRejecting] = useState<Order | null>(null);
  const [reason, setReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = (id: string) => {
    void qc.invalidateQueries({ queryKey: ['dashboards'] });
    void qc.invalidateQueries({ queryKey: ['order', id] });
    void qc.invalidateQueries({ queryKey: ['audit-log'] });
  };

  const onError = (o: Order, e: unknown) => {
    if (e instanceof ApiRequestError && e.isFileLocked) {
      // a decisão ficou guardada no servidor; só a gravação na planilha está pendente
      setNotice({ tone: 'warning', text: e.message });
      refresh(o.id);
      return;
    }
    setNotice({ tone: 'danger', text: `Pedido ${o.number}: ${errorMessage(e)}` });
    refresh(o.id);
  };

  const approve = useMutation({
    mutationFn: (o: Order) => api<Order>(`/orders/${o.id}/approve`, { method: 'POST', body: {} }),
    onMutate: (o) => setBusyId(o.id),
    onSuccess: (res, o) => {
      setNotice({ tone: 'success', text: `Pedido ${o.number} aprovado e enviado ao ERP · registrado na auditoria` });
      refresh(res.id);
    },
    onError: (e, o) => onError(o, e),
    onSettled: () => setBusyId(null),
  });

  const reject = useMutation({
    mutationFn: ({ o, why }: { o: Order; why: string }) => api<Order>(`/orders/${o.id}/reject`, { method: 'POST', body: { reason: why } }),
    onMutate: ({ o }) => setBusyId(o.id),
    onSuccess: (res, { o }) => {
      setNotice({ tone: 'success', text: `Pedido ${o.number} recusado · o vendedor vê o motivo no app · registrado na auditoria` });
      setRejecting(null);
      setReason('');
      refresh(res.id);
    },
    onError: (e, { o }) => {
      setRejecting(null);
      onError(o, e);
    },
    onSettled: () => setBusyId(null),
  });

  const reasonOk = reason.trim().length >= REASON_MIN;

  return (
    <Panel
      label="Aprovações pendentes"
      title="Aprovações"
      aside={<span className="text-[12px] text-ink-2">fora da alçada ou crédito</span>}
      className="flex-[1_1_340px] self-start xl:flex-[0_0_340px]"
    >
      {!canDecide && (
        <Notice tone="info">Só o gestor aprova. Você acompanha a fila e vê o motivo de cada pedido.</Notice>
      )}
      {notice && (
        <Notice tone={notice.tone} onClose={() => setNotice(null)}>
          {notice.text}
        </Notice>
      )}
      {approvals.length === 0 && <span className="text-[13px] text-ink-2">Nada pendente.</span>}
      <div className="flex max-h-[640px] flex-col gap-3 overflow-y-auto">
        {approvals.map((a) => {
          const busy = busyId === a.id;
          const age = Math.round((nowMs - Date.parse(a.received_at)) / 60000);
          return (
            <div key={a.id} className="flex flex-col gap-2 rounded-xl border border-line p-3">
              <div className="flex justify-between gap-2">
                <button type="button" onClick={() => onOpen(a)} className="flex min-w-0 flex-col gap-px text-left hover:underline" aria-label={`Abrir pedido ${a.number}`}>
                  <span className="text-[14px] font-semibold">{a.customer_name}</span>
                  <span className="text-[12px] text-ink-2">
                    <span className="font-mono">{a.number}</span> · {a.seller_name} · há {formatAge(age)}
                  </span>
                </button>
                <span className="text-[14px] font-semibold whitespace-nowrap tabular-nums">{formatBRL(a.total_cents)}</span>
              </div>
              <span className="text-[12px] font-semibold text-accent-ink">{a.pending_reason || 'Fora da alçada'}</span>
              {canDecide && (
                <div className="flex gap-2">
                  <Button variant="primary" size="sm" className="flex-1" disabled={busy} onClick={() => approve.mutate(a)}>
                    {busy && approve.isPending ? 'Aprovando…' : 'Aprovar'}
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={busy}
                    onClick={() => {
                      setReason('');
                      setRejecting(a);
                    }}
                  >
                    Recusar
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Dialog
        open={!!rejecting}
        title={rejecting ? `Recusar pedido ${rejecting.number}` : ''}
        onClose={() => !reject.isPending && setRejecting(null)}
        footer={
          <>
            <Button size="sm" onClick={() => setRejecting(null)} disabled={reject.isPending}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!reasonOk || reject.isPending}
              onClick={() => rejecting && reject.mutate({ o: rejecting, why: reason.trim() })}
            >
              {reject.isPending ? 'Recusando…' : 'Recusar pedido'}
            </Button>
          </>
        }
      >
        {rejecting && (
          <div className="flex flex-col gap-3">
            <span className="text-[13px] text-ink-2">
              {rejecting.customer_name} · {rejecting.seller_name} · {formatBRL(rejecting.total_cents)}
            </span>
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
              Motivo da recusa (obrigatório; o vendedor vê no app)
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="Ex.: desconto acima da política para este cliente"
                className="rounded-[10px] border border-field bg-surface px-3 py-2 text-[14px] font-normal text-ink"
              />
            </label>
            {!reasonOk && reason.length > 0 && <span className="text-[12px] text-danger">Escreva ao menos {REASON_MIN} caracteres.</span>}
          </div>
        )}
      </Dialog>
    </Panel>
  );
}
