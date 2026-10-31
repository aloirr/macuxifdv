'use client';

import { useState } from 'react';
import { usePode } from '@macuxi/platform-sdk/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TeamGoals } from '../../../contracts';
import { formatBRL0, formatBRLShort, formatPct } from '@macuxi/comum';
import { api, apiFetch, ApiRequestError, downloadBlob, errorMessage, filenameFromDisposition } from '@macuxi/platform-sdk/web';
import { DEFAULT_TZ, formatDateTime, monthLabel, monthName, projectionTone, TONE_TEXT, IconDownload, Dialog, Badge, Bar, Button, ErrorBlock, FilterBar, KpiCard, KpiGrid, LoadingBlock, Notice, PageHeader, Panel, SelectField, SkeletonCards, TableScroll, td, tdNum, th, thNum, type NoticeTone } from '@macuxi/ui/web';
import { triggerSummary, weightsSummary } from '../../lib/plan-form';
import { useGoalPeriods, useGoals, useMe, useTeams } from '../../lib/queries';
import { type GoalsSort, sortSellerGoals } from '../../lib/rules';

const SORTS: Array<{ value: GoalsSort; label: string }> = [
  { value: 'projection', label: 'Projeção' },
  { value: 'incentive', label: 'RV projetada' },
  { value: 'name', label: 'Nome' },
];

export function GoalsPage() {
  const me = useMe();
  const teams = useTeams();
  const periods = useGoalPeriods();
  const qc = useQueryClient();
  const current = me.data?.today.slice(0, 7) ?? '';
  const [periodSel, setPeriodSel] = useState<string | null>(null);
  const [teamId, setTeamId] = useState('');
  const [sort, setSort] = useState<GoalsSort>('projection');
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const period = periodSel ?? current;
  const q = useGoals(period, teamId);
  const d = q.data;
  const tz = me.data?.tenant.timezone ?? DEFAULT_TZ;
  const canManage = usePode('meta.fechar_periodo');
  const month = period ? monthName(period) : '';

  const afterChange = (res?: TeamGoals) => {
    if (res) qc.setQueryData(['goals', period, ''], res);
    void qc.invalidateQueries({ queryKey: ['goals'] });
    void qc.invalidateQueries({ queryKey: ['goal-periods'] });
    void qc.invalidateQueries({ queryKey: ['audit-log'] });
  };
  const fail = (e: unknown) => {
    if (e instanceof ApiRequestError && e.isFileLocked) {
      setNotice({ tone: 'warning', text: e.message });
      afterChange();
    } else setNotice({ tone: 'danger', text: errorMessage(e) });
  };

  const close = useMutation({
    mutationFn: () => api<TeamGoals>(`/goal-periods/${period}/close`, { method: 'POST', body: {} }),
    onSuccess: (res) => {
      setNotice({ tone: 'success', text: `Mês de ${month} fechado: valores congelados e prontos para o RH · registrado na auditoria.` });
      afterChange(res);
    },
    onError: fail,
    onSettled: () => setConfirmClose(false),
  });
  const reopen = useMutation({
    mutationFn: () => api<TeamGoals>(`/goal-periods/${period}/reopen`, { method: 'POST', body: {} }),
    onSuccess: (res) => {
      setNotice({ tone: 'success', text: `Mês de ${month} reaberto: a parcial volta a ser recalculada · registrado na auditoria.` });
      afterChange(res);
    },
    onError: fail,
  });
  const exportCsv = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/goal-periods/${period}/payout.csv`);
      const blob = await res.blob();
      const name = filenameFromDisposition(res.headers.get('Content-Disposition'), `rv_${period}.csv`);
      downloadBlob(blob, name);
      return name;
    },
    onSuccess: (name) => {
      setNotice({ tone: 'success', text: `Arquivo ${name} baixado para o RH · registrado na auditoria.` });
      void qc.invalidateQueries({ queryKey: ['audit-log'] });
    },
    onError: fail,
  });

  const closed = d?.period_status === 'closed';
  const rows = d ? sortSellerGoals(d.sellers, sort) : [];
  const triggerRule = d?.plan.rules.find((r) => r.is_trigger);
  const triggerKpi = triggerRule ? d?.sellers[0]?.kpis.find((x) => x.kpi_code === triggerRule.kpi_code) : undefined;
  const periodOptions = Array.from(new Set([current, ...(periods.data ?? []).map((p) => p.year_month)].filter(Boolean))).sort().reverse();

  return (
    <>
      <PageHeader
        title={`Metas e RV · ${month}`}
        badge={
          d && (
            <Badge tone={closed ? 'neutral' : 'success'} className="px-[9px] py-1 text-[12px]">
              {closed ? 'Fechado · valores congelados' : 'Mês aberto'}
            </Badge>
          )
        }
        subtitle={
          !d
            ? ' '
            : closed
              ? `Fechado por ${d.closed_by || '—'} em ${formatDateTime(d.closed_at, tz)} · valores congelados para o RH`
              : `${d.business_days.remaining} dias úteis restantes · parcial recalculada a cada carga de faturamento`
        }
        actions={
          canManage &&
          d && (
            <>
              <Button onClick={() => exportCsv.mutate()} disabled={exportCsv.isPending}>
                <IconDownload size={16} />
                {exportCsv.isPending ? 'Exportando…' : 'Exportar para o RH'}
              </Button>
              {closed ? (
                <Button variant="primary" onClick={() => reopen.mutate()} disabled={reopen.isPending}>
                  {reopen.isPending ? 'Reabrindo…' : `Reabrir ${month}`}
                </Button>
              ) : (
                <Button variant="primary" onClick={() => setConfirmClose(true)} disabled={close.isPending}>
                  {`Fechar ${month}`}
                </Button>
              )}
            </>
          )
        }
      />

      {notice && (
        <Notice tone={notice.tone} onClose={() => setNotice(null)}>
          {notice.text}
        </Notice>
      )}

      <FilterBar>
        <SelectField label="Mês" value={period} onChange={(e) => setPeriodSel(e.target.value)}>
          {periodOptions.map((p) => (
            <option key={p} value={p}>
              {monthLabel(p)}
            </option>
          ))}
        </SelectField>
        <SelectField label="Equipe" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">Todas</option>
          {(teams.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Ordenar por" value={sort} onChange={(e) => setSort(e.target.value as GoalsSort)}>
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </SelectField>
        {!canManage && <span className="pb-2.5 text-[12px] text-ink-2">Fechar o mês e exportar: só analista ou gestor.</span>}
      </FilterBar>

      {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}

      {!d ? (
        q.isPending ? <SkeletonCards n={4} /> : null
      ) : (
        <KpiGrid min={190}>
          <KpiCard
            dark
            label="Faturamento da empresa"
            value={formatBRLShort(d.company_revenue_cents)}
            sub={`de ${formatBRLShort(d.company_target_cents)} · ${formatPct(d.company_achievement_pct, 0)}`}
          />
          <KpiCard
            label={closed ? 'Fechamento' : 'Projeção de fechamento'}
            value={formatPct(d.company_projected_pct, 0)}
            valueClass={TONE_TEXT[projectionTone(d.company_projected_pct)]}
            sub={closed ? 'valor congelado' : 'linear por dias úteis'}
          />
          <KpiCard label={closed ? 'RV do mês' : 'RV projetada total'} value={formatBRL0(d.incentive_total_cents)} sub={`${d.sellers.length} vendedores`} />
          <KpiCard
            label={d.triggers_active === 1 ? 'Gatilho ativo' : 'Gatilhos ativos'}
            value={d.triggers_active}
            valueClass={d.triggers_active > 0 ? 'text-danger' : 'text-success'}
            sub={triggerSummary(triggerKpi)}
          />
        </KpiGrid>
      )}

      {d && (
        <Panel
          label="Metas por vendedor"
          title="Por vendedor"
          aside={<span className="text-[12px] text-ink-2">{weightsSummary(d.plan.rules)}</span>}
        >
          <TableScroll minWidth={900}>
            <thead>
              <tr>
                <th scope="col" className={th}>Vendedor</th>
                <th scope="col" className={thNum}>Faturamento</th>
                <th scope="col" className={th}>Atingimento</th>
                <th scope="col" className={thNum}>Projeção</th>
                <th scope="col" className={thNum}>Positivação</th>
                <th scope="col" className={thNum}>Mix</th>
                <th scope="col" className={thNum}>Inadimpl.</th>
                <th scope="col" className={thNum}>{closed ? 'RV' : 'RV projetada'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const cov = s.kpis.find((x) => x.kpi_code === 'coverage');
                const mix = s.kpis.find((x) => x.kpi_code === 'mix');
                const trig = s.kpis.find((x) => x.is_trigger);
                const blocked = s.trigger_blocked || trig?.trigger_ok === false;
                return (
                  <tr key={s.seller_id}>
                    <td className={`${td} font-semibold whitespace-nowrap`}>
                      {s.short_name} <span className="font-normal text-ink-2">· {s.team_name}</span>
                    </td>
                    <td className={`${tdNum} whitespace-nowrap`}>
                      {formatBRLShort(s.revenue_actual_cents)} <span className="text-ink-2">/ {formatBRLShort(s.revenue_target_cents)}</span>
                    </td>
                    <td className={td}>
                      <div className="flex items-center gap-2">
                        <Bar pct={s.revenue_achievement_pct} colorClass="bg-accent" min={90} />
                        <span className="w-10 text-right font-semibold tabular-nums">{formatPct(s.revenue_achievement_pct, 0)}</span>
                      </div>
                    </td>
                    <td className={`${tdNum} font-bold ${TONE_TEXT[projectionTone(s.revenue_projected_pct)]}`}>{formatPct(s.revenue_projected_pct, 0)}</td>
                    <td className={tdNum}>{cov ? formatPct(cov.achievement_pct, 0) : '—'}</td>
                    <td className={tdNum}>{mix ? formatPct(mix.achievement_pct, 0) : '—'}</td>
                    <td className={`${tdNum} whitespace-nowrap ${blocked ? 'font-bold text-danger' : ''}`}>
                      {formatPct(s.delinquency_pct)}
                      {blocked ? ' · gatilho' : ''}
                    </td>
                    <td className={`${tdNum} font-bold whitespace-nowrap ${blocked ? 'text-danger' : ''}`}>{formatBRL0(s.incentive_cents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </TableScroll>
          <span className="text-[12px] text-ink-2">
            Mostrando {rows.length} vendedores · plano {d.plan.name}. Toda alteração de meta ou fechamento fica registrada na auditoria.
          </span>
        </Panel>
      )}
      {!d && q.isPending && <LoadingBlock />}

      <Dialog
        open={confirmClose}
        title={`Fechar ${month}?`}
        onClose={() => !close.isPending && setConfirmClose(false)}
        footer={
          <>
            <Button size="sm" onClick={() => setConfirmClose(false)} disabled={close.isPending}>
              Cancelar
            </Button>
            <Button variant="primary" size="sm" onClick={() => close.mutate()} disabled={close.isPending}>
              {close.isPending ? 'Fechando…' : `Fechar ${month}`}
            </Button>
          </>
        }
      >
        <p className="m-0 text-[14px]">
          Os valores de meta, realizado e RV de {d?.sellers.length ?? 0} vendedores ficam <strong>congelados</strong> e prontos para exportar ao RH. O app do vendedor passa a mostrar o valor fechado.
        </p>
        <p className="mt-2 mb-0 text-[13px] text-ink-2">Dá para reabrir depois; o fechamento e a reabertura ficam na auditoria.</p>
      </Dialog>
    </>
  );
}
