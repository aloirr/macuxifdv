'use client';

import { useState } from 'react';
import { usePode } from '@macuxi/platform-sdk/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CustomersDashboard } from '../../../contracts';
import { formatBRL0, formatPct } from '@macuxi/comum';
import { api, ApiRequestError, errorMessage } from '@macuxi/platform-sdk/web';
import { addMonths, formatInt, monthLabel, monthName, coverageTone, TONE_BG, IconCheck, useToast, Badge, Bar, ErrorBlock, FilterBar, KpiCard, KpiGrid, LoadingBlock, PageHeader, Panel, SelectField, SkeletonCards, TableScroll, td, tdNum, th, thNum } from '@macuxi/ui/web';
import { type CustomersFilter, useCustomersDashboard, useMe, useTeams } from '../../lib/queries';

export const SEGMENTS = ['Linha leve', 'Linha pesada', 'Motos'];

type Risk = CustomersDashboard['curve_a_at_risk'][number];

function RiskList({ items, canAdd }: { items: Risk[]; canAdd: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [added, setAdded] = useState<Record<string, true>>({});
  const add = useMutation({
    mutationFn: (c: Risk) => api('/routes/week/stops', { method: 'POST', body: { customer_id: c.customer_id } }),
    onSuccess: (_r, c) => {
      setAdded((a) => ({ ...a, [c.customer_id]: true }));
      toast('success', `${c.name} entrou na rota da semana de ${c.seller_name} · registrado na auditoria`);
    },
    onError: (e, c) => {
      if (e instanceof ApiRequestError && e.isFileLocked) {
        setAdded((a) => ({ ...a, [c.customer_id]: true }));
        toast('warning', e.message);
      } else toast('danger', `${c.name}: ${errorMessage(e)}`);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['dashboards', 'customers'] }),
  });

  if (items.length === 0) return <span className="text-[13px] text-ink-2">Nenhum cliente curva A parado com esses filtros.</span>;
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {items.map((c) => {
        const inRoute = c.in_route_this_week || added[c.customer_id];
        const busy = add.isPending && add.variables?.customer_id === c.customer_id;
        return (
          <li key={c.customer_id} className="flex items-center justify-between gap-2.5 border-b border-line-2 py-2.5">
            <div className="flex min-w-0 flex-col gap-px">
              <span className="text-[14px] font-semibold">{c.name}</span>
              <span className="text-[12px] text-ink-2">
                {c.seller_name} · média {formatBRL0(c.avg_monthly_cents)}/mês
              </span>
              {inRoute ? (
                <span className="mt-1 flex items-center gap-1 text-[12px] font-semibold text-success">
                  <IconCheck size={13} />
                  Na rota
                </span>
              ) : canAdd ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => add.mutate(c)}
                  className="mt-0.5 self-start py-1 text-left text-[13px] font-semibold text-accent hover:text-accent-ink disabled:text-disabled"
                >
                  {busy ? 'Incluindo…' : 'Incluir na rota da semana'}
                </button>
              ) : null}
            </div>
            <Badge tone="pending">{c.days_since_purchase} dias</Badge>
          </li>
        );
      })}
    </ul>
  );
}

export function CustomersPage() {
  const me = useMe();
  const teams = useTeams();
  const current = me.data?.today.slice(0, 7) ?? '';
  const [filters, setFilters] = useState<Omit<CustomersFilter, 'period'> & { period: string | null }>({ period: null, team_id: '', abc: '', segment: '' });
  const period = filters.period ?? current;
  const q = useCustomersDashboard({ ...filters, period });
  const d = q.data;
  const k = d?.kpis;
  const canEditRoutes = usePode('rota.editar');
  const set = (key: keyof CustomersFilter, v: string) => setFilters((f) => ({ ...f, [key]: v }));
  const months = current ? [current, addMonths(current, -1)] : [];

  return (
    <>
      <PageHeader title="Farol de clientes" subtitle={`${period ? monthName(period).replace(/^./, (c) => c.toUpperCase()) : ''} · positivação conta pelo vendedor da nota`} />

      <FilterBar>
        <SelectField label="Mês" value={period} onChange={(e) => set('period', e.target.value)}>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
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
        <SelectField label="Curva" value={filters.abc} onChange={(e) => set('abc', e.target.value)}>
          <option value="">A, B e C</option>
          <option value="A">Só A</option>
        </SelectField>
        <SelectField label="Segmento" value={filters.segment} onChange={(e) => set('segment', e.target.value)}>
          <option value="">Todos</option>
          {SEGMENTS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </SelectField>
        {q.isFetching && d && <span className="pb-2.5 text-[12px] text-ink-2">atualizando…</span>}
      </FilterBar>

      {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}

      {!k ? (
        q.isPending ? <SkeletonCards n={4} /> : null
      ) : (
        <KpiGrid min={190}>
          <KpiCard label="Carteira ativa" value={formatInt(k.active_wallet)} sub="clientes com compra em 12 meses" />
          <KpiCard
            label="Positivados no mês"
            value={formatInt(k.positivated)}
            extra={<span className="ml-1.5 text-[16px] text-ink-2">{formatPct(k.positivated_pct)}</span>}
            sub={`meta da equipe: ${formatPct(k.team_target_pct, 0)}`}
          />
          <KpiCard
            label="Sem compra há 60+ dias"
            value={formatInt(k.idle_60)}
            valueClass="text-accent-ink"
            sub={`${formatInt(k.idle_60_curve_a)} ${k.idle_60_curve_a === 1 ? 'deles é' : 'deles são'} curva A`}
          />
          <KpiCard
            label="Inadimplência"
            value={formatPct(k.delinquency_pct)}
            valueClass={k.delinquency_pct > k.policy_limit_pct ? 'text-danger' : 'text-success'}
            sub={`limite da política: ${formatPct(k.policy_limit_pct)}`}
          />
        </KpiGrid>
      )}

      {d && k && (
        <div className="flex flex-wrap items-start gap-4">
          <Panel label="Positivação por vendedor" title="Por vendedor" className="flex-[2_1_560px]">
            <TableScroll minWidth={720}>
              <thead>
                <tr>
                  <th scope="col" className={th}>Vendedor</th>
                  <th scope="col" className={thNum}>Carteira</th>
                  <th scope="col" className={th}>Positivação</th>
                  <th scope="col" className={thNum}>Sem compra 45+</th>
                  <th scope="col" className={thNum}>Curva A parada</th>
                  <th scope="col" className={thNum}>Inadimpl.</th>
                </tr>
              </thead>
              <tbody>
                {d.by_seller.map((s) => {
                  const over = s.delinquency_pct > k.policy_limit_pct;
                  return (
                    <tr key={s.seller_id}>
                      <td className={`${td} font-semibold whitespace-nowrap`}>
                        {s.name} <span className="font-normal text-ink-2">· {s.team_name}</span>
                      </td>
                      <td className={tdNum}>{formatInt(s.wallet)}</td>
                      <td className={td}>
                        <div className="flex items-center gap-2">
                          <Bar pct={s.positivated_pct} colorClass={TONE_BG[coverageTone(s.positivated_pct)]} />
                          <span className="w-11 text-right font-semibold tabular-nums">{formatPct(s.positivated_pct, 0)}</span>
                        </div>
                      </td>
                      <td className={tdNum}>{formatInt(s.idle_45)}</td>
                      <td className={`${tdNum} font-semibold ${s.curve_a_idle >= 5 ? 'text-danger' : ''}`}>{formatInt(s.curve_a_idle)}</td>
                      <td className={`${tdNum} ${over ? 'font-semibold text-danger' : ''}`}>{formatPct(s.delinquency_pct)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </TableScroll>
            {d.by_seller.length === 0 && <span className="text-[13px] text-ink-2">Nenhum vendedor nesta equipe.</span>}
          </Panel>

          <Panel
            label="Curva A em risco"
            title="Curva A em risco"
            aside={<span className="text-[12px] text-ink-2">sem compra 45+ dias</span>}
            className="flex-[1_1_320px] gap-1.5 xl:flex-[0_0_340px]"
          >
            {!canEditRoutes && <span className="text-[12px] text-ink-2">Só analista ou gestor incluem na rota.</span>}
            <RiskList items={d.curve_a_at_risk} canAdd={canEditRoutes} />
          </Panel>
        </div>
      )}
      {!d && q.isPending && <LoadingBlock />}
    </>
  );
}
