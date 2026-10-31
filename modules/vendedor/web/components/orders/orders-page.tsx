'use client';

import { useState } from 'react';
import { formatBRL, formatBRLShort, formatPct } from '@macuxi/comum';
import { downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import {
  Button, DEFAULT_TZ, ErrorBlock, FilterBar, formatAge, formatDayMonthLong, formatInt, formatReceived, formatTime, IconAlert, IconCheck, IconDownload,
  integratedTone, KpiCard, KpiGrid, LoadingBlock, monthName, PageHeader, Panel, SelectField, SkeletonCards, TableScroll, td, tdNum, th, thNum, TONE_TEXT, useToast,
} from '@macuxi/ui/web';
import type { Order, OrdersDashboard } from '../../../contracts';
import { ordersToCsv } from '../../lib/csv';
import { type OrdersFilter, useBranches, useMe, useOrdersDashboard, useTeams } from '../../lib/queries';
import { canApprove } from '../../lib/rules';
import { ApprovalsPanel } from './approvals-panel';
import { OrderDrawer } from './order-drawer';
import { OrderStatusBadge } from './status';

const PERIODS: Array<{ value: OrdersFilter['period']; label: string }> = [
  { value: 'today', label: 'Hoje' },
  { value: 'week', label: 'Esta semana' },
  { value: 'month', label: 'Este mês' },
];

const STATUSES = [
  { value: '', label: 'Todos' },
  { value: 'pending_approval', label: 'Aguardando aprovação' },
  { value: 'rejected', label: 'Rejeitados' },
  { value: 'sent_to_erp', label: 'Enviados ao ERP' },
  { value: 'integrated', label: 'Integrados' },
];

const PERIOD_WORD: Record<OrdersFilter['period'], { card: string; table: string }> = {
  today: { card: 'Pedidos hoje', table: 'Pedidos do dia' },
  week: { card: 'Pedidos na semana', table: 'Pedidos da semana' },
  month: { card: 'Pedidos no mês', table: 'Pedidos do mês' },
};

function ErpPill({ erp, tz }: { erp: OrdersDashboard['erp']; tz: string }) {
  const ok = erp.status === 'connected';
  const text = ok ? `${erp.name} conectado` : erp.status === 'degraded' ? `${erp.name} instável` : `${erp.name} fora do ar`;
  const cls = ok ? 'text-success bg-success-soft' : erp.status === 'degraded' ? 'text-warning bg-warning-soft' : 'text-danger bg-danger-soft';
  return (
    <span className={`flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-semibold ${cls}`} role="status">
      {ok ? <IconCheck size={14} /> : <IconAlert size={14} />}
      {text} · última carga {formatTime(erp.last_load_at, tz)}
    </span>
  );
}

export function OrdersPage() {
  const me = useMe();
  const branches = useBranches();
  const teams = useTeams();
  const toast = useToast();
  const [filters, setFilters] = useState<OrdersFilter>({ period: 'today', branch_id: '', team_id: '', status: '' });
  const [open, setOpen] = useState<Order | null>(null);
  const q = useOrdersDashboard(filters);
  const d = q.data;
  const tz = me.data?.tenant.timezone ?? DEFAULT_TZ;
  const today = me.data?.today ?? '';
  const role = me.data?.user.role;
  const set = <K extends keyof OrdersFilter>(k: K, v: OrdersFilter[K]) => setFilters((f) => ({ ...f, [k]: v }));

  const dateText = !today
    ? ''
    : filters.period === 'today'
      ? `Hoje, ${formatDayMonthLong(today)}`
      : filters.period === 'week'
        ? `Semana até ${formatDayMonthLong(today)}`
        : `${monthName(today.slice(0, 7)).replace(/^./, (c) => c.toUpperCase())} até o dia ${Number(today.slice(8, 10))}`;

  const exportCsv = () => {
    if (!d) return;
    const csv = ordersToCsv(d.orders, tz);
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `pedidos_${filters.period}_${today || 'hoje'}.csv`);
    toast('success', `CSV com ${d.orders.length} pedidos exportado.`);
  };

  const k = d?.kpis;
  const nowMs = d ? Date.parse(d.generated_at) : 0;

  return (
    <>
      <PageHeader
        title="Farol de pedidos"
        subtitle={d ? `${dateText} · atualizado ${formatTime(d.generated_at, tz)}` : dateText || ' '}
        actions={d && <ErpPill erp={d.erp} tz={tz} />}
      />

      <FilterBar>
        <SelectField label="Período" value={filters.period} onChange={(e) => set('period', e.target.value as OrdersFilter['period'])}>
          {PERIODS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Filial" value={filters.branch_id} onChange={(e) => set('branch_id', e.target.value)}>
          <option value="">Todas</option>
          {(branches.data ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Equipe" value={filters.team_id} onChange={(e) => set('team_id', e.target.value)}>
          <option value="">Todas</option>
          {(teams.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Status" value={filters.status} onChange={(e) => set('status', e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </SelectField>
        {q.isFetching && d && <span className="pb-2.5 text-[12px] text-ink-2">atualizando…</span>}
      </FilterBar>

      {q.isError && !d && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
      {q.isError && d && <ErrorBlock message={`Não deu para atualizar agora: ${errorMessage(q.error)}`} />}

      {!k ? (
        q.isPending ? <SkeletonCards n={5} /> : null
      ) : (
        <KpiGrid min={180}>
          <KpiCard label={PERIOD_WORD[filters.period].card} value={formatInt(k.orders_count)} sub={`${formatBRLShort(k.orders_total_cents)} · ${k.sellers_count} vendedores`} />
          <KpiCard
            label="Aguardando aprovação"
            value={formatInt(k.pending_approval)}
            valueClass="text-accent-ink"
            sub={k.oldest_pending_minutes === null ? 'nada pendente' : `mais antigo há ${formatAge(k.oldest_pending_minutes)}`}
          />
          <KpiCard label="Rejeitados" value={formatInt(k.rejected)} valueClass="text-danger" sub={k.rejected ? k.rejected_by_reason : 'nenhum no período'} />
          <KpiCard
            label="Na fila dos aparelhos"
            value={formatInt(k.queued_on_devices)}
            sub={k.devices_offline ? `${k.devices_offline} ${k.devices_offline === 1 ? 'vendedor' : 'vendedores'} sem sinal` : 'todos com sinal'}
          />
          <KpiCard
            label="Integrados sem intervenção"
            value={formatPct(k.integrated_without_touch_pct, k.integrated_without_touch_pct % 1 === 0 ? 0 : 1)}
            valueClass={TONE_TEXT[integratedTone(k.integrated_without_touch_pct, k.integrated_target_pct)]}
            sub={`meta: ${formatPct(k.integrated_target_pct, 0)}`}
          />
        </KpiGrid>
      )}

      {d && (
        <div className="flex flex-wrap items-start gap-4">
          <ApprovalsPanel approvals={d.approvals} canDecide={canApprove(role)} nowMs={nowMs} onOpen={setOpen} />

          <Panel
            label={PERIOD_WORD[filters.period].table}
            title={
              <>
                {PERIOD_WORD[filters.period].table} <span className="font-sans text-[13px] font-normal text-ink-2">· {d.orders.length}</span>
              </>
            }
            aside={
              <Button variant="link" onClick={exportCsv} disabled={d.orders.length === 0} className="font-semibold">
                <IconDownload size={15} />
                Exportar CSV
              </Button>
            }
            className="flex-[2_1_560px]"
          >
            <TableScroll minWidth={760}>
              <thead>
                <tr>
                  <th scope="col" className={th}>Nº</th>
                  <th scope="col" className={th}>Cliente</th>
                  <th scope="col" className={th}>Vendedor</th>
                  <th scope="col" className={th}>Filial</th>
                  <th scope="col" className={thNum}>Valor</th>
                  <th scope="col" className={thNum}>Desc.</th>
                  <th scope="col" className={th}>Status</th>
                  <th scope="col" className={th}>Recebido</th>
                </tr>
              </thead>
              <tbody>
                {d.orders.map((o) => (
                  <tr
                    key={o.id}
                    tabIndex={0}
                    aria-label={`Abrir pedido ${o.number}`}
                    onClick={() => setOpen(o)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setOpen(o);
                      }
                    }}
                    className="cursor-pointer outline-none hover:bg-ground focus-visible:bg-ground"
                  >
                    <td className={`${td} font-mono`}>{o.number}</td>
                    <td className={`${td} min-w-[150px] font-semibold`}>{o.customer_name}</td>
                    <td className={`${td} whitespace-nowrap`}>{o.seller_name}</td>
                    <td className={`${td} whitespace-nowrap text-ink-2`}>{o.branch_name}</td>
                    <td className={`${tdNum} whitespace-nowrap`}>{formatBRL(o.total_cents)}</td>
                    <td className={tdNum}>{formatPct(o.discount_pct)}</td>
                    <td className={td}>
                      <OrderStatusBadge status={o.status} />
                    </td>
                    <td className={`${td} whitespace-nowrap text-ink-2`}>{formatReceived(o.received_at, today, tz)}</td>
                  </tr>
                ))}
              </tbody>
            </TableScroll>
            {d.orders.length === 0 && <span className="text-[13px] text-ink-2">Nenhum pedido com esses filtros.</span>}
          </Panel>
        </div>
      )}
      {!d && q.isPending && <LoadingBlock />}

      <OrderDrawer order={open} tz={tz} role={role} onClose={() => setOpen(null)} />
    </>
  );
}
