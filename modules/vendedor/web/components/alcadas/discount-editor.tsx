'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Seller } from '@macuxi/core/contracts';
import { api, ApiRequestError, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, cx, DEFAULT_TZ, formatDateTime, IconClock, IconPlus, IconTrash, Notice, type NoticeTone } from '@macuxi/ui/web';
import type { DiscountPolicy } from '../../../contracts';
import { type PolicyForm, policyToForm, validatePolicyForm } from '../../lib/policy-form';
import { qk, useAuditLog } from '../../lib/queries';

const input = 'h-10 box-border rounded-[10px] border border-field bg-surface px-3 text-[14px] font-semibold text-ink disabled:bg-ground disabled:text-ink-2';
const labelCls = 'flex flex-col gap-1 text-[12px] font-semibold text-ink-2';

function PctInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className={labelCls}>
      {label}
      <div className="relative">
        <input type="text" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className={cx(input, 'w-full pr-8')} />
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[14px] text-ink-2">%</span>
      </div>
    </label>
  );
}

export function DiscountEditor({ policy, sellers, canEdit, tz = DEFAULT_TZ }: { policy: DiscountPolicy; sellers: Seller[]; canEdit: boolean; tz?: string }) {
  const qc = useQueryClient();
  const original = useMemo(() => policyToForm(policy), [policy]);
  const [form, setForm] = useState<PolicyForm>(original);
  const [loaded, setLoaded] = useState(original);
  const [showEx, setShowEx] = useState(false);
  const [msg, setMsg] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const audit = useAuditLog('discount_policy');
  const last = audit.data?.[0];

  if (loaded !== original) {
    setLoaded(original);
    setForm(original);
  }

  const v = validatePolicyForm(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  const set = (patch: Partial<PolicyForm>) => {
    setMsg(null);
    setForm((f) => ({ ...f, ...patch }));
  };

  const save = useMutation({
    mutationFn: () => {
      if (!v.ok) throw new Error(v.error);
      return api<DiscountPolicy>('/discount-policy', { method: 'PUT', body: v.body });
    },
    onSuccess: (saved) => {
      qc.setQueryData(qk.discountPolicy, saved);
      setMsg({ tone: 'success', text: 'Alçadas salvas. O app passa a usar os novos limites na próxima sincronização · registrado na auditoria.' });
      void qc.invalidateQueries({ queryKey: ['audit-log'] });
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.isFileLocked) {
        setMsg({ tone: 'warning', text: e.message });
        void qc.invalidateQueries({ queryKey: qk.discountPolicy });
      } else setMsg({ tone: 'danger', text: errorMessage(e) });
    },
  });

  const used = new Set(form.exceptions.map((e) => e.seller_id));
  const nameOf = (id: string) => sellers.find((s) => s.id === id)?.short_name ?? '—';

  return (
    <section aria-label="Alçadas de desconto" className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-[18px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 font-display text-[18px] font-bold">Alçadas de desconto</h2>
        <button type="button" onClick={() => setShowEx((s) => !s)} aria-expanded={showEx} className="text-[13px] font-semibold text-accent hover:text-accent-ink">
          {form.exceptions.length === 0 ? 'Nenhuma exceção por vendedor' : `${form.exceptions.length} ${form.exceptions.length === 1 ? 'exceção' : 'exceções'} por vendedor`}
        </button>
      </div>
      {msg && (
        <Notice tone={msg.tone} onClose={() => setMsg(null)}>
          {msg.text}
        </Notice>
      )}
      <fieldset disabled={!canEdit} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <PctInput label="Vendedor" value={form.seller} onChange={(x) => set({ seller: x })} />
          <PctInput label="Supervisor" value={form.supervisor} onChange={(x) => set({ supervisor: x })} />
          <PctInput label="Gestor comercial" value={form.manager} onChange={(x) => set({ manager: x })} />
          <label className={labelCls}>
            Acima do gestor
            <select value={form.above_manager} onChange={(e) => set({ above_manager: e.target.value as PolicyForm['above_manager'] })} className={cx(input, 'font-medium')}>
              <option value="block">Bloqueia o pedido</option>
              <option value="director">Vai para a diretoria</option>
            </select>
          </label>
        </div>

        {showEx && (
          <div className="flex flex-col gap-2 rounded-xl bg-ground p-3">
            <span className="text-[12px] font-semibold text-ink-2">Exceções por vendedor (substituem a alçada do perfil vendedor)</span>
            {form.exceptions.map((e, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <label className={labelCls}>
                  Vendedor
                  <select
                    value={e.seller_id}
                    onChange={(ev) => set({ exceptions: form.exceptions.map((x, j) => (j === i ? { ...x, seller_id: ev.target.value } : x)) })}
                    className={cx(input, 'w-[200px] font-medium')}
                    aria-label={`Vendedor da exceção ${i + 1}`}
                  >
                    <option value="">Escolha…</option>
                    {sellers
                      .filter((s) => s.id === e.seller_id || !used.has(s.id))
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.short_name} · {s.team_name}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="w-[120px]">
                  <PctInput label="Alçada" value={e.pct} onChange={(x) => set({ exceptions: form.exceptions.map((y, j) => (j === i ? { ...y, pct: x } : y)) })} />
                </div>
                <button
                  type="button"
                  aria-label={`Remover exceção de ${nameOf(e.seller_id)}`}
                  onClick={() => set({ exceptions: form.exceptions.filter((_, j) => j !== i) })}
                  className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-field bg-surface text-ink-2 hover:text-danger"
                >
                  <IconTrash size={16} />
                </button>
              </div>
            ))}
            <Button variant="link" className="self-start" onClick={() => set({ exceptions: [...form.exceptions, { seller_id: '', pct: form.seller }] })}>
              <IconPlus size={14} />
              Adicionar exceção
            </Button>
          </div>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={cx('text-[12px]', v.ok ? 'text-ink-2' : 'font-semibold text-danger')}>
          {v.ok ? 'Pedido acima da alçada do vendedor vai para aprovação de quem tiver alçada.' : v.error}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={!canEdit || !dirty || save.isPending}
            onClick={() => {
              setForm(original);
              setMsg(null);
            }}
          >
            Descartar
          </Button>
          <Button variant="primary" size="sm" disabled={!canEdit || !dirty || !v.ok || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Salvando…' : 'Salvar alçadas'}
          </Button>
        </div>
      </div>
      {last && (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
          <IconClock size={14} />
          Última alteração das alçadas: {last.user_name}, {formatDateTime(last.at, tz)}.
          <a href="/auditoria?entity=discount_policy" className="font-semibold text-accent no-underline hover:text-accent-ink">
            Ver auditoria
          </a>
        </div>
      )}
    </section>
  );
}
