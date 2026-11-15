'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RouteDay } from '../../../contracts';
import { api, ApiRequestError, errorMessage } from '@macuxi/platform-sdk/web';
import { useRoutes } from '../../lib/queries';
import { addDays, dayLabel, dayShortLabel, type DraftStop, isIsoDate, sameWeekdayNext } from '../../lib/routes';
import { corpoDaRota } from '../../lib/rotas-api';
import { IconAlert, IconCheck, Dialog, useToast, Button, cx, Notice } from '@macuxi/ui/web';

const CANDIDATE_WEEKS = 6;
const MAX_AHEAD_DAYS = 56;

type Result = { date: string; ok: boolean; warn?: boolean; message?: string };

export function CopyDayDialog({ sellerId, date, stops, today, onClose }: { sellerId: string; sellerName: string; date: string; stops: DraftStop[]; today: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const candidates = useMemo(() => sameWeekdayNext(date, CANDIDATE_WEEKS).filter((d) => d >= today), [date, today]);
  const [selected, setSelected] = useState<string[]>(() => candidates.slice(0, 1));
  const [custom, setCustom] = useState('');
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);

  const all = useMemo(() => [...new Set([...candidates, ...selected])].sort(), [candidates, selected]);
  const existing = useRoutes({ from: all[0] ?? date, to: all[all.length - 1] ?? date, seller_id: sellerId, team_id: '' }, all.length > 0);
  const byDate = useMemo(() => {
    const m = new Map<string, RouteDay>();
    for (const r of existing.data?.items ?? []) if (r.stops.length) m.set(r.date, r);
    return m;
  }, [existing.data]);
  const replacing = selected.filter((d) => byDate.has(d));

  const toggle = (d: string) => setSelected((s) => (s.includes(d) ? s.filter((x) => x !== d) : [...s, d].sort()));
  const pickWeeks = (n: number) => setSelected(candidates.slice(0, n));
  const addCustom = () => {
    if (!isIsoDate(custom) || custom === date || custom < today) return;
    setSelected((s) => (s.includes(custom) ? s : [...s, custom].sort()));
    setCustom('');
  };

  const run = async () => {
    const body = corpoDaRota(stops);
    const out: Result[] = [];
    setRunning({ done: 0, total: selected.length });
    for (const [i, d] of selected.entries()) {
      try {
        await api(`/core/rotas/${sellerId}/${d}`, { method: 'PUT', body });
        out.push({ date: d, ok: true });
      } catch (e) {
        if (e instanceof ApiRequestError && e.isFileLocked) out.push({ date: d, ok: true, warn: true, message: e.message });
        else out.push({ date: d, ok: false, message: errorMessage(e) });
      }
      setRunning({ done: i + 1, total: selected.length });
    }
    setRunning(null);
    setResults(out);
    void qc.invalidateQueries({ queryKey: ['routes'] });
    const ok = out.filter((r) => r.ok).length;
    if (ok === out.length) toast('success', `Rota copiada para ${ok} ${ok === 1 ? 'dia' : 'dias'}.`);
  };

  const busy = running !== null;
  const footer = results ? (
    <Button variant="primary" onClick={onClose}>
      Fechar
    </Button>
  ) : (
    <>
      <Button onClick={onClose} disabled={busy}>
        Cancelar
      </Button>
      <Button variant={replacing.length ? 'danger' : 'primary'} disabled={busy || selected.length === 0} onClick={() => void run()}>
        {busy
          ? `Copiando ${running.done + 1} de ${running.total}…`
          : replacing.length
            ? `Substituir e copiar (${selected.length})`
            : `Copiar para ${selected.length} ${selected.length === 1 ? 'dia' : 'dias'}`}
      </Button>
    </>
  );

  return (
    <Dialog open title="Copiar este dia para…" onClose={busy ? () => {} : onClose} footer={footer}>
      {results ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="Resultado da cópia">
          {results.map((r) => (
            <li key={r.date} className={cx('flex items-start gap-2 text-[13px]', r.ok ? (r.warn ? 'text-warning' : 'text-success') : 'text-danger')}>
              {r.ok && !r.warn ? <IconCheck size={15} className="mt-0.5 shrink-0" /> : <IconAlert size={15} className="mt-0.5 shrink-0" />}
              <span>
                <strong>{dayLabel(r.date)}</strong> — {r.ok ? (r.warn ? `guardada; ${r.message}` : 'copiada') : r.message}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] font-semibold text-ink-2">Mesmo dia da semana nas próximas</span>
            {[1, 2, 4].map((n) => (
              <Button key={n} size="sm" onClick={() => pickWeeks(n)} disabled={busy || candidates.length < n}>
                {n} {n === 1 ? 'semana' : 'semanas'}
              </Button>
            ))}
          </div>
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" disabled={busy}>
            <legend className="mb-1 text-[12px] font-semibold text-ink-2">Datas</legend>
            {all.map((d) => {
              const ex = byDate.get(d);
              return (
                <label key={d} className="flex min-h-[40px] items-center gap-2.5 rounded-lg px-1 text-[14px] hover:bg-ground">
                  <input type="checkbox" className="h-4 w-4 accent-accent" checked={selected.includes(d)} onChange={() => toggle(d)} />
                  <span className="w-[86px] font-semibold tabular-nums">{dayShortLabel(d)}</span>
                  <span className={cx('text-[12px]', ex ? 'font-semibold text-accent-ink' : 'text-ink-2')}>
                    {existing.isPending ? 'verificando…' : ex ? `já tem rota (${ex.stops.length} visitas)` : 'sem rota'}
                  </span>
                </label>
              );
            })}
          </fieldset>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-[3px] text-[12px] font-semibold text-ink-2">
              Outra data
              <input
                type="date"
                value={custom}
                min={today}
                max={addDays(date, MAX_AHEAD_DAYS)}
                onChange={(e) => setCustom(e.target.value)}
                className="h-[38px] rounded-[10px] border border-field bg-surface px-2.5 text-[14px] text-ink"
              />
            </label>
            <Button size="sm" onClick={addCustom} disabled={!isIsoDate(custom) || custom === date || busy}>
              Incluir data
            </Button>
          </div>
          {replacing.length > 0 && (
            <Notice tone="warning">
              {replacing.length === 1 ? 'Um dia escolhido já tem rota' : `${replacing.length} dias escolhidos já têm rota`}: as paradas existentes serão
              substituídas por estas.
            </Notice>
          )}
        </div>
      )}
    </Dialog>
  );
}
