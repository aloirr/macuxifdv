'use client';

import Link from 'next/link';
import { type ReactNode, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { IncentiveBand, IncentivePlan } from '../../../contracts';
import { api, ApiRequestError, errorMessage } from '@macuxi/platform-sdk/web';
import { DEFAULT_TZ, formatDateTime, monthLabel, monthName, IconClock, IconPlus, IconTrash, Button, cx, Notice, type NoticeTone } from '@macuxi/ui/web';
import { bandsTextFor, formToRequest, isFormDirty, nextBand, type PlanForm, planToForm, type RuleForm, validatePlanForm, validFromOptions, weightsLabel } from '../../lib/plan-form';
import { qk } from '../../lib/queries';

const MODE_LABEL: Record<IncentiveBand['mode'], string> = { zero: 'Zero', proportional: 'Proporcional', fixed: 'Fixo' };

const input = 'h-10 box-border rounded-[10px] border border-field bg-surface px-3 text-[14px] font-medium text-ink disabled:bg-ground disabled:text-ink-2';
const labelCls = 'flex flex-col gap-1 text-[12px] font-semibold text-ink-2';

function BandsEditor({ rule, error, onChange }: { rule: RuleForm; error: string | null; onChange: (bands: IncentiveBand[]) => void }) {
  const update = (i: number, patch: Partial<IncentiveBand>) => onChange(rule.bands.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-ground p-3">
      <span className="text-[12px] font-semibold text-ink-2">Faixas de {rule.kpi_name.toLowerCase()} (a partir de quanto % de atingimento, quanto paga)</span>
      {rule.bands.map((b, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <label className={labelCls}>
            <span className={i === 0 ? '' : 'sr-only'}>Início (%)</span>
            <input
              type="number"
              min={0}
              step={1}
              aria-label={`Início da faixa ${i + 1} de ${rule.kpi_name}`}
              value={b.from_pct}
              onChange={(e) => update(i, { from_pct: Math.max(0, Number(e.target.value) || 0) })}
              className={cx(input, 'w-[92px] text-right')}
            />
          </label>
          <label className={labelCls}>
            <span className={i === 0 ? '' : 'sr-only'}>Modo</span>
            <select
              aria-label={`Modo da faixa ${i + 1} de ${rule.kpi_name}`}
              value={b.mode}
              onChange={(e) => {
                const mode = e.target.value as IncentiveBand['mode'];
                update(i, { mode, payout_pct: mode === 'fixed' ? b.payout_pct || 100 : 0 });
              }}
              className={cx(input, 'w-[150px]')}
            >
              {(Object.keys(MODE_LABEL) as IncentiveBand['mode'][]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            <span className={i === 0 ? '' : 'sr-only'}>% pago</span>
            <input
              type="number"
              min={0}
              step={1}
              aria-label={`Percentual pago na faixa ${i + 1} de ${rule.kpi_name}`}
              value={b.mode === 'fixed' ? b.payout_pct : ''}
              placeholder={b.mode === 'proportional' ? '= ating.' : '0'}
              disabled={b.mode !== 'fixed'}
              onChange={(e) => update(i, { payout_pct: Math.max(0, Number(e.target.value) || 0) })}
              className={cx(input, 'w-[92px] text-right')}
            />
          </label>
          <button
            type="button"
            onClick={() => onChange(rule.bands.filter((_, j) => j !== i))}
            aria-label={`Remover faixa ${i + 1} de ${rule.kpi_name}`}
            className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-field bg-surface text-ink-2 hover:text-danger disabled:opacity-50"
          >
            <IconTrash size={16} />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="link" onClick={() => onChange([...rule.bands, nextBand(rule.bands)])}>
          <IconPlus size={14} />
          Adicionar faixa
        </Button>
        {error && <span className="text-[12px] font-semibold text-danger">{error}</span>}
      </div>
    </div>
  );
}

export function PlanEditor({
  plan,
  plans,
  currentYm,
  sellersCount,
  canEdit,
  tz = DEFAULT_TZ,
  onSaved,
  children,
}: {
  plan: IncentivePlan;
  plans: IncentivePlan[];
  currentYm: string;
  sellersCount: number;
  canEdit: boolean;
  tz?: string;
  onSaved: (saved: IncentivePlan) => void;
  /** seções exibidas antes da linha "Última alteração" (alçadas de desconto) */
  children?: ReactNode;
}) {
  const qc = useQueryClient();
  const defaultValidFrom = plan.valid_from > currentYm ? plan.valid_from : currentYm;
  const original = useMemo(() => planToForm(plan, defaultValidFrom), [plan, defaultValidFrom]);
  const [form, setForm] = useState<PlanForm>(original);
  const [loadedKey, setLoadedKey] = useState(`${plan.id}|${plan.updated_at}`);
  const [openBands, setOpenBands] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<{ tone: NoticeTone; text: string } | null>(null);

  // o plano mudou no servidor (salvo aqui ou por outra pessoa): recarrega o formulário
  const key = `${plan.id}|${plan.updated_at}`;
  if (key !== loadedKey) {
    setLoadedKey(key);
    setForm(original);
  }

  const v = validatePlanForm(form);
  const dirty = isFormDirty(form, original);
  const setRule = (code: string, patch: Partial<RuleForm>) => {
    setMsg(null);
    setForm((f) => ({ ...f, rules: f.rules.map((r) => (r.kpi_code === code ? { ...r, ...patch } : r)) }));
  };
  const setField = (patch: Partial<PlanForm>) => {
    setMsg(null);
    setForm((f) => ({ ...f, ...patch }));
  };

  const save = useMutation({
    mutationFn: () => api<IncentivePlan>(`/incentive-plans/${plan.id}`, { method: 'PUT', body: formToRequest(form) }),
    onSuccess: (saved) => {
      qc.setQueryData(qk.currentPlan(saved.valid_from), saved);
      setMsg({ tone: 'success', text: `Plano salvo. Vale a partir de ${monthName(saved.valid_from)} de ${saved.valid_from.slice(0, 4)} e a alteração foi registrada na auditoria.` });
      void qc.invalidateQueries({ queryKey: ['incentive-plans'] });
      void qc.invalidateQueries({ queryKey: ['goals'] });
      void qc.invalidateQueries({ queryKey: ['audit-log'] });
      onSaved(saved);
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.isFileLocked) {
        setMsg({ tone: 'warning', text: e.message });
        void qc.invalidateQueries({ queryKey: ['incentive-plans'] });
      } else setMsg({ tone: 'danger', text: errorMessage(e) });
    },
  });

  const futureVersions = plans.filter((p) => p.applies_to === plan.applies_to && p.valid_from > plan.valid_from);
  const appliesOptions = Array.from(new Set([form.applies_to, ...plans.map((p) => p.applies_to)]));
  const willCreateVersion = form.valid_from !== plan.valid_from;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[13px] text-ink-2">Parâmetros · só o perfil analista edita</span>
          <h1 className="m-0 font-display text-[24px] leading-tight font-extrabold sm:text-[28px]">Plano de RV · {plan.name}</h1>
        </div>
        <div className="flex gap-2">
          <Button disabled={!canEdit || save.isPending} onClick={() => {
              setForm(original);
              setMsg(null);
            }}>
            Descartar
          </Button>
          <Button
            variant="primary"
            disabled={!canEdit || !v.ok || save.isPending}
            onClick={() => (dirty ? save.mutate() : setMsg({ tone: 'info', text: 'Nenhuma alteração para salvar.' }))}
            className="px-[18px]"
          >
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </div>

      {msg && (
        <Notice tone={msg.tone} onClose={() => setMsg(null)}>
          {msg.text}
        </Notice>
      )}

      <fieldset disabled={!canEdit} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
        <section aria-label="Dados do plano" className="grid gap-3.5 rounded-2xl border border-line bg-surface p-[18px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <label className={labelCls}>
            Nome do plano
            <input type="text" value={form.name} onChange={(e) => setField({ name: e.target.value })} className={input} />
            {v.nameError && <span className="font-normal text-danger">{v.nameError}</span>}
          </label>
          <label className={labelCls}>
            Teto mensal por vendedor (R$)
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[14px] font-medium text-ink-2">R$</span>
              <input
                type="text"
                inputMode="decimal"
                value={form.max_amount_input}
                onChange={(e) => setField({ max_amount_input: e.target.value })}
                className={cx(input, 'w-full pl-10 text-right tabular-nums')}
              />
            </div>
            {v.maxError && <span className="font-normal text-danger">{v.maxError}</span>}
          </label>
          <label className={labelCls}>
            Vale a partir de
            <select value={form.valid_from} onChange={(e) => setField({ valid_from: e.target.value })} className={input}>
              {Array.from(new Set([...validFromOptions(currentYm), form.valid_from])).map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
            {willCreateVersion && <span className="font-normal">Cria uma versão nova a partir de {monthName(form.valid_from)}; os meses anteriores não mudam.</span>}
          </label>
          <label className={labelCls}>
            Aplica-se a
            <select value={form.applies_to} onChange={(e) => setField({ applies_to: e.target.value })} className={input}>
              {appliesOptions.map((a) => (
                <option key={a} value={a}>
                  {a} ({sellersCount})
                </option>
              ))}
            </select>
          </label>
        </section>

        <section aria-label="Indicadores e pesos" className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-[18px]">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="m-0 font-display text-[18px] font-bold">Indicadores</h2>
            <span className={cx('text-[14px] font-bold', v.weights.ok ? 'text-success' : 'text-danger')} role="status" aria-live="polite">
              {weightsLabel(v.weights)}
            </span>
          </div>
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[760px] border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-ink-2">
                  <th scope="col" className="border-b border-line px-2.5 py-2 font-semibold">Indicador</th>
                  <th scope="col" className="border-b border-line px-2.5 py-2 font-semibold">Peso</th>
                  <th scope="col" className="border-b border-line px-2.5 py-2 font-semibold">Faixas de pagamento</th>
                  <th scope="col" className="border-b border-line px-2.5 py-2 font-semibold">Gatilho</th>
                </tr>
              </thead>
              <tbody>
                {form.rules.map((r) => {
                  const orig = original.rules.find((x) => x.kpi_code === r.kpi_code);
                  const err = v.bandErrors[r.kpi_code] ?? null;
                  const open = canEdit && (!!openBands[r.kpi_code] || !!err);
                  return [
                    <tr key={r.kpi_code}>
                      <td className="border-b border-line-2 p-2.5 align-middle">
                        <div className="flex flex-col gap-px">
                          <span className="font-semibold">{r.kpi_name}</span>
                          <span className="text-[12px] text-ink-2">{r.rule_text}</span>
                        </div>
                      </td>
                      <td className="border-b border-line-2 p-2.5 align-middle">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            aria-label={`Peso de ${r.kpi_name}`}
                            value={r.is_trigger ? 0 : r.weight_pct}
                            disabled={r.is_trigger || !canEdit}
                            onChange={(e) => setRule(r.kpi_code, { weight_pct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                            className="box-border h-9 w-[72px] rounded-[10px] border border-field bg-surface px-2 text-right text-[14px] font-semibold text-ink disabled:bg-ground disabled:text-ink-2"
                          />
                          <span className="text-ink-2">%</span>
                        </div>
                      </td>
                      <td className="border-b border-line-2 p-2.5 align-middle text-ink-3">
                        <div className="flex flex-col items-start gap-1">
                          <span>{bandsTextFor(r, orig)}</span>
                          {!r.is_trigger && canEdit && (
                            <button
                              type="button"
                              onClick={() => setOpenBands((o) => ({ ...o, [r.kpi_code]: !open }))}
                              className="text-[12px] font-semibold text-accent hover:text-accent-ink disabled:text-ink-2"
                              aria-expanded={open}
                            >
                              {open ? 'Fechar faixas' : 'Editar faixas'}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="border-b border-line-2 p-2.5 align-middle">
                        <label className="flex items-center gap-1.5 text-[13px]">
                          <input
                            type="checkbox"
                            checked={r.is_trigger}
                            aria-label={`${r.kpi_name} é gatilho`}
                            onChange={(e) => setRule(r.kpi_code, { is_trigger: e.target.checked })}
                            className="h-[18px] w-[18px] accent-ink"
                          />
                          {r.is_trigger ? 'Sim' : 'Não'}
                        </label>
                      </td>
                    </tr>,
                    open && !r.is_trigger ? (
                      <tr key={`${r.kpi_code}-bands`}>
                        <td colSpan={4} className="border-b border-line-2 p-2.5">
                          <BandsEditor rule={r} error={err} onChange={(bands) => setRule(r.kpi_code, { bands })} />
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
              </tbody>
            </table>
          </div>
          <span className="text-[12px] text-ink-2">Indicador marcado como gatilho não tem peso: se não cumprir, a RV do mês zera.</span>
        </section>
      </fieldset>

      {children}

      <div className="flex flex-wrap items-center gap-2.5 text-[13px] text-ink-2">
        <IconClock size={16} />
        <span>
          Última alteração: {plan.updated_by || '—'}, {formatDateTime(plan.updated_at, tz)}
          {plan.last_change ? ` · ${plan.last_change}.` : '.'}
        </span>
        <Link href="/auditoria?entity=incentive_plan" className="font-semibold text-accent no-underline hover:text-accent-ink">
          Ver auditoria
        </Link>
      </div>
      {futureVersions.length > 0 && (
        <Notice tone="info">
          Já existe versão programada a partir de {futureVersions.map((p) => monthLabel(p.valid_from).toLowerCase()).join(', ')}. Salvar com esse mês altera aquela versão.
        </Notice>
      )}
    </>
  );
}
