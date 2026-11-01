'use client';

import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RotaDiaSchema, type CustomerSummary, type RouteDay } from '../../../contracts';
import type { GeoPoint } from '../../../domain';
import { api, ApiRequestError, errorMessage } from '@macuxi/platform-sdk/web';
import { useSellerCustomers } from '../../lib/queries';
import { corpoDaRota, paraRouteDay } from '../../lib/rotas-api';
import {
  dayLabel,
  draftFromRoute,
  draftKm,
  draftToMapStops,
  formatKm,
  idleLabel,
  isSuggested,
  type MapStop,
  moveStop,
  moveStopTo,
  nextWindow,
  normalizeTime,
  removeStop,
  resequenceWindows,
  sameDraft,
  searchWallet,
  sortByProximity,
  STATUS_FILL,
  STATUS_LABEL,
  windowIssues,
  type DraftStop,
} from '../../lib/routes';
import { IconLock, IconPlus, IconRoute, IconTrash, IconX, useToast, Badge, Button, cx, LoadingBlock, Notice } from '@macuxi/ui/web';
import { CopyDayDialog } from './copy-day-dialog';

export interface RouteEditorProps {
  sellerId: string;
  sellerName: string;
  date: string;
  /** rota atual do dia (null = dia sem rota: criar) */
  route: RouteDay | null;
  start: GeoPoint;
  canEdit: boolean;
  color: string;
  today: string;
  onClose: () => void;
  /** rascunho para o mapa (null = sem edição pendente) */
  onDraftChange: (stops: MapStop[] | null) => void;
  onDirtyChange: (dirty: boolean) => void;
}

function StopBubble({ n, status, color }: { n: number; status: DraftStop['status']; color: string }) {
  const filled = status === 'done' ? STATUS_FILL.done : status === 'in_progress' ? STATUS_FILL.in_progress : null;
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-[2.5px] text-[12px] font-bold tabular-nums"
      style={{ background: filled ?? '#fff', color: filled ? '#fff' : '#16202a', borderColor: filled ?? color }}
      aria-hidden="true"
    >
      {n}
    </span>
  );
}

/** Hora em texto (HH:MM, 24 h), igual em qualquer navegador; normaliza ao sair do campo ('830' → '08:30'). */
function TimeField({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      maxLength={5}
      placeholder="08:00"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => {
        const n = normalizeTime(e.target.value);
        if (n && n !== e.target.value) onChange(n);
      }}
      className="h-9 w-[64px] rounded-lg border border-field bg-surface px-1.5 text-center text-[13px] text-ink tabular-nums disabled:border-line-2 disabled:bg-transparent disabled:text-ink-2"
    />
  );
}

const iconBtn =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-field bg-surface text-[15px] font-bold text-ink hover:bg-ground disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent';

export function RouteEditor({ sellerId, sellerName, date, route, start, canEdit, color, today, onClose, onDraftChange, onDirtyChange }: RouteEditorProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const baseline = useMemo(() => draftFromRoute(route), [route]);
  /** null = sem edição: segue a rota do servidor (status atualiza sozinho) */
  const [edited, setEdited] = useState<DraftStop[] | null>(null);
  const draft = edited ?? baseline;
  const dirty = edited !== null && !sameDraft(edited, baseline);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  const km = useMemo(() => draftKm(start, draft), [start, draft]);
  const baseKm = useMemo(() => draftKm(start, baseline), [start, baseline]);
  const issues = useMemo(() => windowIssues(draft), [draft]);
  const done = draft.filter((s) => s.status === 'done').length;
  const inProgress = draft.filter((s) => s.status === 'in_progress').length;

  useEffect(() => {
    onDraftChange(dirty || !route ? draftToMapStops(draft) : null);
  }, [draft, dirty, route, onDraftChange]);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDraftChange(null), [onDraftChange]);

  const update = (fn: (s: DraftStop[]) => DraftStop[]) => {
    setError(null);
    setEdited((cur) => fn(cur ?? baseline));
  };

  const save = useMutation({
    mutationFn: async (stops: DraftStop[]) => {
      const salva = RotaDiaSchema.parse(await api<unknown>(`/core/rotas/${sellerId}/${date}`, { method: 'PUT', body: corpoDaRota(stops) }));
      return paraRouteDay({ ...salva, usuario_id: sellerId, usuario_nome: sellerName, data: date }, new Date().toISOString().slice(0, 10), start);
    },
    onMutate: () => setError(null),
    onSuccess: (saved) => {
      qc.setQueriesData<{ start: GeoPoint; items: RouteDay[] }>({ queryKey: ['routes'] }, (old) => {
        if (!old) return old;
        const has = old.items.some((r) => r.seller_id === saved.seller_id && r.date === saved.date);
        return { ...old, items: has ? old.items.map((r) => (r.seller_id === saved.seller_id && r.date === saved.date ? saved : r)) : old.items };
      });
      setEdited(null);
      toast('success', 'Rota salva e registrada na auditoria.');
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.isFileLocked) {
        setEdited(null);
        toast('warning', `Planilha aberta no Excel: ${e.message}`);
      } else setError(errorMessage(e));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['routes'] }),
  });

  const onDrop = (e: DragEvent, to: number) => {
    e.preventDefault();
    if (dragFrom !== null) update((s) => moveStopTo(s, dragFrom, to));
    setDragFrom(null);
  };

  const readOnly = !canEdit;
  const past = date < today;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2 text-[12px] font-semibold text-ink-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden="true" />
            {sellerName}
          </span>
          <h2 className="m-0 font-display text-[19px] font-bold">{dayLabel(date)}</h2>
          <span className="text-[13px] text-ink-2 tabular-nums">
            {draft.length} {draft.length === 1 ? 'visita' : 'visitas'} · {formatKm(km)}
            {dirty && baseline.length > 0 && km !== baseKm && <span className={cx('ml-1 font-semibold', km < baseKm ? 'text-success' : 'text-accent-ink')}>(antes {formatKm(baseKm)})</span>}
            {done + inProgress > 0 && ` · ${done} feitas${inProgress ? `, ${inProgress} em atendimento` : ''}`}
          </span>
        </div>
        <button type="button" onClick={onClose} className={iconBtn} aria-label="Fechar o editor e voltar à lista">
          <IconX size={17} />
        </button>
      </div>

      {readOnly && (
        <Notice tone="info">
          <IconLock size={13} className="mr-1 inline align-[-2px]" />
          Modo leitura: só o analista ou o gestor configuram rotas.
        </Notice>
      )}
      {!readOnly && past && <Notice tone="warning">Este dia já passou. Alterar a rota agora só muda o histórico do planejamento.</Notice>}
      {error && (
        <Notice tone="danger" onClose={() => setError(null)}>
          {error}
        </Notice>
      )}

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => update((s) => resequenceWindows(sortByProximity(start, s)))} disabled={draft.filter((s) => !s.locked).length < 2}>
            <IconRoute size={15} />
            Ordenar por proximidade
          </Button>
          <Button size="sm" variant={adding ? 'primary' : 'secondary'} onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
            <IconPlus size={15} />
            Adicionar cliente
          </Button>
          <Button size="sm" onClick={() => update(resequenceWindows)} disabled={draft.length === 0} title="Refaz as janelas em sequência: 40 min de visita a cada 45 min">
            Refazer horários
          </Button>
        </div>
      )}

      {canEdit && adding && (
        <AddCustomer
          sellerId={sellerId}
          exclude={new Set(draft.map((s) => s.customer.id))}
          onAdd={(c) =>
            update((s) => [...s, { key: `new-${c.id}`, customer: c, status: 'new', locked: false, ...nextWindow(s) }])
          }
        />
      )}

      {draft.length === 0 ? (
        <div className="rounded-xl border border-dashed border-field px-3 py-5 text-center text-[13px] text-ink-2">
          {route?.stops.length === 0 && route.id ? 'Rota sem paradas.' : 'Sem rota neste dia.'} {canEdit ? 'Use “Adicionar cliente” para montar a rota.' : ''}
        </div>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="Paradas da rota">
          {draft.map((s, i) => {
            const c = s.customer;
            const canMoveUp = canEdit && !s.locked && i > 0 && !draft[i - 1]!.locked;
            const canMoveDown = canEdit && !s.locked && i < draft.length - 1;
            return (
              <li
                key={s.key}
                draggable={canEdit && !s.locked}
                onDragStart={() => setDragFrom(i)}
                onDragEnd={() => setDragFrom(null)}
                onDragOver={(e) => canEdit && e.preventDefault()}
                onDrop={(e) => onDrop(e, i)}
                className={cx(
                  'flex flex-col gap-1.5 rounded-xl border bg-surface px-2.5 py-2',
                  s.locked ? 'border-line-2 bg-ground/60' : 'border-line',
                  dragFrom === i && 'opacity-50',
                  canEdit && !s.locked && 'cursor-grab',
                )}
                data-testid="route-stop"
                data-customer={c.id}
              >
                <div className="flex items-center gap-2">
                  <StopBubble n={i + 1} status={s.status} color={color} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[14px] font-semibold" title={c.trade_name}>
                      {c.trade_name}
                    </span>
                    <span className="truncate text-[12px] text-ink-2">
                      {c.district} · cód. {c.erp_code} · curva {c.abc_curve}
                    </span>
                  </div>
                  {s.locked ? (
                    <Badge tone={s.status === 'done' ? 'success' : 'pending'} className="flex items-center gap-1">
                      <IconLock size={11} className="inline align-[-1px]" /> {STATUS_LABEL[s.status]}
                    </Badge>
                  ) : s.status === 'new' ? (
                    <Badge tone="warning">Nova</Badge>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 pl-9">
                  <label className="flex items-center gap-1 text-[12px] text-ink-2">
                    <span className="sr-only">Início da janela da parada {i + 1}</span>
                    <TimeField
                      value={s.window_start}
                      disabled={!canEdit || s.locked}
                      onChange={(v) => update((l) => l.map((x, j) => (j === i ? { ...x, window_start: v } : x)))}
                    />
                    <span aria-hidden="true">–</span>
                    <span className="sr-only">Fim da janela da parada {i + 1}</span>
                    <TimeField
                      value={s.window_end}
                      disabled={!canEdit || s.locked}
                      onChange={(v) => update((l) => l.map((x, j) => (j === i ? { ...x, window_end: v } : x)))}
                    />
                  </label>
                  {canEdit && !s.locked && (
                    <div className="ml-auto flex gap-1">
                      <button type="button" className={iconBtn} disabled={!canMoveUp} onClick={() => update((l) => moveStop(l, i, -1))} aria-label={`Subir ${c.trade_name}`}>
                        ↑
                      </button>
                      <button type="button" className={iconBtn} disabled={!canMoveDown} onClick={() => update((l) => moveStop(l, i, 1))} aria-label={`Descer ${c.trade_name}`}>
                        ↓
                      </button>
                      <button
                        type="button"
                        className={cx(iconBtn, 'text-danger')}
                        onClick={() => update((l) => removeStop(l, i))}
                        aria-label={`Remover ${c.trade_name} da rota`}
                      >
                        <IconTrash size={15} />
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {canEdit && issues.length > 0 && (
        <Notice tone="warning">
          {issues.slice(0, 3).join(' ')}
          {issues.length > 3 && ` (+${issues.length - 3})`} Use “Refazer horários” para acertar.
        </Notice>
      )}

      {canEdit && (
        <div className="sticky bottom-0 -mx-4 flex flex-wrap gap-2 border-t border-line bg-surface px-4 pt-3 pb-1">
          <Button variant="primary" disabled={!dirty || save.isPending || issues.some((x) => x.includes('inválido'))} onClick={() => save.mutate(draft)}>
            {save.isPending ? 'Salvando…' : route?.stops.length ? 'Salvar' : 'Criar rota'}
          </Button>
          <Button disabled={!dirty || save.isPending} onClick={() => {
              setEdited(null);
              setError(null);
            }}>
            Descartar
          </Button>
          <Button
            variant="link"
            className="ml-auto"
            disabled={dirty || draft.length === 0}
            title={dirty ? 'Salve ou descarte antes de copiar' : undefined}
            onClick={() => setCopyOpen(true)}
          >
            Copiar este dia para…
          </Button>
        </div>
      )}

      {copyOpen && <CopyDayDialog sellerId={sellerId} sellerName={sellerName} date={date} stops={draft} today={today} onClose={() => setCopyOpen(false)} />}
    </div>
  );
}

function AddCustomer({ sellerId, exclude, onAdd }: { sellerId: string; exclude: Set<string>; onAdd: (c: CustomerSummary) => void }) {
  const wallet = useSellerCustomers(sellerId);
  const [q, setQ] = useState('');
  const results = useMemo(() => searchWallet(wallet.data ?? [], q, exclude, 25), [wallet.data, q, exclude]);
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-ground/60 p-2.5">
      <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
        Buscar na carteira do vendedor
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nome, bairro ou código"
          autoFocus
          className="h-10 rounded-[10px] border border-field bg-surface px-2.5 text-[14px] font-medium text-ink"
        />
      </label>
      {!q && <span className="text-[12px] text-ink-2">Sugestões primeiro: curva A e sem compra há 45+ dias.</span>}
      {wallet.isPending && <LoadingBlock label="Carregando carteira…" />}
      {wallet.isError && <Notice tone="danger">{errorMessage(wallet.error)}</Notice>}
      {wallet.data && results.length === 0 && <span className="py-2 text-[13px] text-ink-2">Nenhum cliente encontrado (ou todos já estão na rota).</span>}
      <ul className="m-0 flex max-h-[280px] list-none flex-col overflow-y-auto p-0" aria-label="Clientes da carteira">
        {results.map((c) => {
          const idle = c.days_since_purchase ?? null;
          return (
            <li key={c.id} className="flex items-center gap-2 border-b border-line-2 py-2 last:border-0">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-semibold">{c.trade_name}</span>
                <span className="truncate text-[12px] text-ink-2">
                  {c.district} · cód. {c.erp_code}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1">
                  <Badge tone={c.abc_curve === 'A' ? 'pending' : 'neutral'}>Curva {c.abc_curve}</Badge>
                  <Badge tone={idle === null || idle >= 45 ? 'danger' : 'neutral'}>{idleLabel(c)}</Badge>
                  {isSuggested(c) && <Badge tone="warning">Sugestão</Badge>}
                </span>
              </div>
              <Button size="sm" onClick={() => onAdd(c)} aria-label={`Incluir ${c.trade_name} na rota`}>
                <IconPlus size={14} />
                Incluir
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
