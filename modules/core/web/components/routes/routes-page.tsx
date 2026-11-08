'use client';

import dynamic from 'next/dynamic';
import { usePode } from '@macuxi/platform-sdk/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RouteDay, Seller } from '../../../contracts';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { formatInt, IconChevronRight, IconPlus, Badge, Button, cx, ErrorBlock, FilterBar, KpiCard, KpiGrid, LoadingBlock, PageHeader, SelectField, SkeletonCards } from '@macuxi/ui/web';
import { useMe, useRoutes, useSellersDeCampo, useTeamsDeCampo } from '../../lib/queries';
import {
  buildMapRoutes,
  businessDaysIn,
  colorByFor,
  dayShortLabel,
  formatKm,
  isDense,
  isIsoDate,
  type MapStop,
  OTHER_COLOR,
  PERIOD_LABEL,
  PERIOD_MODES,
  type PeriodMode,
  periodContains,
  periodLabel,
  periodRange,
  routeKey,
  routeKpis,
  sellerColorMap,
  shiftAnchor,
  STATUS_FILL,
  weekday,
  weekdayColor,
  WEEKDAY_COLORS,
  WEEKDAY_SHORT,
} from '../../lib/routes';
import { RouteEditor } from './route-editor';

const RouteMap = dynamic(() => import('./route-map'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center bg-[#e9ece6] text-[13px] text-ink-2">Carregando mapa…</div>,
});

interface ListRow {
  key: string;
  sellerId: string;
  date: string;
  route: RouteDay | null;
}

const parseMode = (v: string | null): PeriodMode => (v === 'week' || v === 'month' ? v : 'day');

function Segmented({ value, onChange }: { value: PeriodMode; onChange: (m: PeriodMode) => void }) {
  return (
    <div className="flex flex-col gap-[3px] text-[12px] font-semibold text-ink-2">
      <span id="period-label">Período</span>
      <div role="group" aria-labelledby="period-label" className="flex h-[38px] rounded-[10px] border border-field bg-surface p-[3px]">
        {PERIOD_MODES.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={value === m}
            onClick={() => onChange(m)}
            className={cx(
              'rounded-[7px] px-3.5 text-[14px] font-semibold transition-colors',
              value === m ? 'bg-ink text-white' : 'text-ink hover:bg-ground',
            )}
          >
            {PERIOD_LABEL[m]}
          </button>
        ))}
      </div>
    </div>
  );
}

function PeriodNav({ label, onPrev, onNext, onToday, isToday }: { label: string; onPrev: () => void; onNext: () => void; onToday: () => void; isToday: boolean }) {
  const btn = 'flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-field bg-surface text-ink hover:bg-ground';
  return (
    <div className="flex items-end gap-1.5">
      <button type="button" className={btn} onClick={onPrev} aria-label="Período anterior">
        <IconChevronRight size={16} className="rotate-180" />
      </button>
      <span className="flex h-[38px] min-w-[150px] items-center justify-center px-1 font-display text-[16px] font-bold whitespace-nowrap" aria-live="polite" data-testid="period-label">
        {label}
      </span>
      <button type="button" className={btn} onClick={onNext} aria-label="Próximo período">
        <IconChevronRight size={16} />
      </button>
      <Button size="sm" onClick={onToday} disabled={isToday}>
        Hoje
      </Button>
    </div>
  );
}

function StatusLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-2">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-full" style={{ background: STATUS_FILL.done }} /> Visitada
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-full" style={{ background: STATUS_FILL.in_progress }} /> Em atendimento
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-full border-2 border-ink-2 bg-white" /> Pendente
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-flex h-3.5 w-5 items-center justify-center rounded-[3px] bg-ink text-[8px] font-extrabold text-white">CD</span> Saída
      </span>
    </div>
  );
}

export function RoutesPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe();
  const teams = useTeamsDeCampo();
  const sellers = useSellersDeCampo();
  const today = me.data?.today ?? '';
  const canEdit = usePode('rota.editar');

  const mode = parseMode(params.get('period'));
  const dateParam = params.get('date');
  const anchor = isIsoDate(dateParam) ? dateParam : today;
  const teamId = params.get('team') ?? '';
  const sellerId = params.get('seller') ?? '';

  const dirtyRef = useRef(false);
  const confirmLeave = useCallback(() => !dirtyRef.current || window.confirm('Há alterações não salvas nesta rota. Descartar?'), []);

  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftStops, setDraftStops] = useState<MapStop[] | null>(null);
  const [linesOverride, setLinesOverride] = useState<boolean | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  /** última query pedida: dois filtros seguidos não podem se sobrescrever antes de a URL atualizar */
  const latestQs = useRef(params.toString());
  useEffect(() => {
    latestQs.current = params.toString();
  }, [params]);

  const set = (patch: Record<string, string | null>) => {
    if (!confirmLeave()) return;
    const next = new URLSearchParams(latestQs.current);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    dirtyRef.current = false;
    setEditingKey(null);
    setHighlightKey(null);
    setLinesOverride(null);
    const qs = next.toString();
    latestQs.current = qs;
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const range = useMemo(() => (anchor ? periodRange(mode, anchor) : { from: '', to: '' }), [mode, anchor]);
  const q = useRoutes({ from: range.from, to: range.to, seller_id: sellerId, team_id: teamId }, !!anchor);
  const start = useMemo(() => q.data?.start ?? { lat: -3.125, lng: -59.97 }, [q.data?.start]);
  const routes = useMemo(() => (q.data?.items ?? []).filter((r) => r.date >= range.from && r.date <= range.to), [q.data, range]);

  const sellerList: Seller[] = useMemo(() => sellers.data ?? [], [sellers.data]);
  const sellerColors = useMemo(() => sellerColorMap(sellerList.map((s) => s.id)), [sellerList]);
  const sellerNames = useMemo(() => Object.fromEntries(sellerList.map((s) => [s.id, s.short_name])), [sellerList]);
  const sellerFull = useMemo(() => Object.fromEntries(sellerList.map((s) => [s.id, s.name])), [sellerList]);
  const teamSellers = useMemo(() => sellerList.filter((s) => !teamId || s.team_id === teamId), [sellerList, teamId]);

  const single = !!sellerId;
  const colorBy = colorByFor(mode, single);
  const dense = isDense(mode, single, routes.length);
  const showAllLines = linesOverride ?? !dense;
  const kpis = useMemo(() => routeKpis(routes), [routes]);

  /* linhas da lista: com um vendedor, todos os dias úteis (inclusive sem rota); no dia, os vendedores sem rota */
  const rows: ListRow[] = useMemo(() => {
    if (!range.from) return [];
    const byKey = new Map(routes.map((r) => [routeKey(r.seller_id, r.date), r]));
    const out: ListRow[] = [];
    if (single) {
      const days = new Set([...businessDaysIn(range), ...routes.map((r) => r.date)]);
      for (const d of [...days].sort()) out.push({ key: routeKey(sellerId, d), sellerId, date: d, route: byKey.get(routeKey(sellerId, d)) ?? null });
    } else {
      for (const r of routes) out.push({ key: routeKey(r.seller_id, r.date), sellerId: r.seller_id, date: r.date, route: r });
      if (mode === 'day') {
        for (const s of teamSellers) if (!byKey.has(routeKey(s.id, range.from))) out.push({ key: routeKey(s.id, range.from), sellerId: s.id, date: range.from, route: null });
      }
      const order = new Map(sellerList.map((s, i) => [s.id, i]));
      out.sort((a, b) => a.date.localeCompare(b.date) || (order.get(a.sellerId) ?? 99) - (order.get(b.sellerId) ?? 99));
    }
    return out;
  }, [routes, range, single, sellerId, mode, teamSellers, sellerList]);

  const editingRow = editingKey ? (rows.find((r) => r.key === editingKey) ?? null) : null;
  const effectiveHighlight = editingKey ?? highlightKey;

  const mapRoutes = useMemo(
    () =>
      buildMapRoutes(routes, start, {
        colorBy,
        sellerColors,
        highlightKey: effectiveHighlight,
        showAllLines,
        draft: editingKey && draftStops ? { key: editingKey, stops: draftStops } : null,
      }),
    [routes, start, colorBy, sellerColors, effectiveHighlight, showAllLines, editingKey, draftStops],
  );

  const onDraftChange = useCallback((s: MapStop[] | null) => setDraftStops(s), []);
  const onDirtyChange = useCallback((d: boolean) => {
    dirtyRef.current = d;
  }, []);

  // lista e editor dividem o mesmo quadro com rolagem: volta ao topo ao trocar
  useEffect(() => {
    if (editorRef.current) editorRef.current.scrollTop = 0;
  }, [editingKey]);

  // fecha o editor se a rota saiu do período (outro filtro)
  useEffect(() => {
    if (editingKey && !editingRow && q.data) setEditingKey(null);
  }, [editingKey, editingRow, q.data]);

  const openEditor = (key: string) => {
    if (key !== editingKey && !confirmLeave()) return;
    dirtyRef.current = key === editingKey ? dirtyRef.current : false;
    setEditingKey(key);
    setHighlightKey(key);
    if (typeof window !== 'undefined' && window.innerWidth < 1280) setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  const closeEditor = () => {
    if (!confirmLeave()) return;
    dirtyRef.current = false;
    setEditingKey(null);
  };
  const highlightDay = (key: string | null) => {
    if (editingKey && editingKey !== key) {
      if (!confirmLeave()) return;
      dirtyRef.current = false;
      setEditingKey(null);
    }
    setHighlightKey(key);
  };
  const onMapSelect = useCallback((key: string) => setHighlightKey((k) => (k === key ? null : key)), []);

  const legendSellers = useMemo(() => {
    const ids = new Set(routes.map((r) => r.seller_id));
    return sellerList.filter((s) => ids.has(s.id));
  }, [routes, sellerList]);
  const singleDays = single && mode !== 'day' ? rows.filter((r) => r.route && r.route.stops.length) : [];

  if (me.isPending || !anchor) return <LoadingBlock />;

  const subtitle = `${periodLabel(mode, anchor)} · ${single ? (sellerFull[sellerId] ?? '…') : teamId ? `equipe ${teams.data?.find((t) => t.id === teamId)?.name ?? ''}` : 'todos os vendedores'}`;

  return (
    <>
      <PageHeader
        title="Rotas"
        subtitle={subtitle}
        actions={
          <Button onClick={() => void q.refetch()} disabled={q.isFetching} aria-label="Atualizar as rotas" data-testid="rotas.atualizar">
            {q.isFetching ? 'Atualizando…' : 'Atualizar'}
          </Button>
        }
      />

      <FilterBar>
        <Segmented value={mode} onChange={(m) => set({ period: m === 'day' ? null : m })} />
        <PeriodNav
          label={periodLabel(mode, anchor)}
          onPrev={() => set({ date: shiftAnchor(mode, anchor, -1) })}
          onNext={() => set({ date: shiftAnchor(mode, anchor, 1) })}
          onToday={() => set({ date: null })}
          isToday={periodContains(mode, anchor, today) && (mode !== 'day' || anchor === today)}
        />
        <SelectField
          label="Equipe"
          value={teamId}
          onChange={(e) => {
            const t = e.target.value;
            const keepSeller = sellerId && sellerList.find((s) => s.id === sellerId)?.team_id === t;
            set({ team: t, seller: keepSeller || !t ? sellerId : null });
          }}
        >
          <option value="">Todas</option>
          {(teams.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Vendedor" value={sellerId} onChange={(e) => set({ seller: e.target.value })} className="min-w-[170px]">
          <option value="">Todos</option>
          {teamSellers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        {q.isFetching && q.data && <span className="pb-2.5 text-[12px] text-ink-2">atualizando…</span>}
      </FilterBar>

      {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}

      {!q.data ? (
        q.isPending ? <SkeletonCards n={6} /> : null
      ) : (
        <KpiGrid min={150}>
          <KpiCard label="Rotas no período" value={formatInt(kpis.routes)} sub={`média de ${kpis.avgPerRoute.toLocaleString('pt-BR')} visitas por rota`} />
          <KpiCard label="Visitas planejadas" value={formatInt(kpis.planned)} />
          <KpiCard label="Km total" value={formatInt(kpis.km)} sub="saída do CD, sem volta" />
          <KpiCard label="Visitadas" value={formatInt(kpis.done)} valueClass="text-success" sub={kpis.planned ? `${Math.round((kpis.done / kpis.planned) * 100)}% do planejado` : '—'} />
          <KpiCard label="Em atendimento" value={formatInt(kpis.inProgress)} valueClass={kpis.inProgress ? 'text-accent-ink' : undefined} />
          <KpiCard label="Pendentes" value={formatInt(kpis.pending)} />
        </KpiGrid>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* mapa */}
        <section aria-label="Mapa das rotas" className="flex min-w-0 flex-col gap-2.5 rounded-2xl border border-line bg-surface p-3 xl:h-[720px]">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1">
            {colorBy === 'seller' ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-semibold text-ink-3" aria-label="Cor por vendedor">
                {legendSellers.map((s) => (
                  <span key={s.id} className="flex items-center gap-1.5">
                    <span className="inline-block h-[4px] w-4 rounded" style={{ background: sellerColors[s.id] ?? OTHER_COLOR }} />
                    {s.short_name}
                  </span>
                ))}
                {legendSellers.length === 0 && <span className="font-normal text-ink-2">Sem rotas no período.</span>}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-semibold text-ink-3" aria-label="Cor por dia da semana">
                {[1, 2, 3, 4, 5].map((d) => (
                  <span key={d} className="flex items-center gap-1.5">
                    <span className="inline-block h-[4px] w-4 rounded" style={{ background: WEEKDAY_COLORS[d] }} />
                    {WEEKDAY_SHORT[d]}
                  </span>
                ))}
              </div>
            )}
            <StatusLegend />
          </div>

          {singleDays.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-1" role="group" aria-label="Destacar um dia">
              <button
                type="button"
                aria-pressed={!effectiveHighlight}
                onClick={() => highlightDay(null)}
                className={cx('h-8 rounded-full border px-3 text-[12px] font-semibold', !effectiveHighlight ? 'border-ink bg-ink text-white' : 'border-field bg-surface text-ink hover:bg-ground')}
              >
                Todos os dias
              </button>
              {singleDays.map((r) => {
                const on = effectiveHighlight === r.key;
                return (
                  <button
                    key={r.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => highlightDay(on ? null : r.key)}
                    className={cx('flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-semibold tabular-nums', on ? 'border-ink bg-ink text-white' : 'border-field bg-surface text-ink hover:bg-ground')}
                  >
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: weekdayColor(r.date) }} />
                    {mode === 'month' ? `${WEEKDAY_SHORT[weekday(r.date)]} ${r.date.slice(8, 10)}` : dayShortLabel(r.date)}
                  </button>
                );
              })}
            </div>
          )}

          {dense && (
            <label className="flex items-center gap-2 px-1 text-[12px] text-ink-2">
              <input type="checkbox" className="h-4 w-4 accent-accent" checked={showAllLines} onChange={(e) => setLinesOverride(e.target.checked)} />
              Mostrar as linhas de todas as rotas (muitos dados: por padrão só os pontos; escolha uma rota na lista para ver o trajeto)
            </label>
          )}

          <div className="relative isolate z-0 h-[360px] min-h-0 overflow-hidden rounded-xl border border-line-2 sm:h-[520px] xl:h-auto xl:flex-1" data-testid="route-map">
            <RouteMap start={start} routes={mapRoutes} sellerNames={sellerNames} dense={dense} focusKey={effectiveHighlight} onSelectRoute={onMapSelect} />
          </div>
        </section>

        {/* lista ou editor */}
        <section
          ref={editorRef}
          aria-label={editingRow ? 'Editor da rota' : 'Rotas do período'}
          className="flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-2xl border border-line bg-surface p-4 xl:h-[720px] xl:overflow-y-auto"
        >
          {editingRow ? (
            <RouteEditor
              key={editingRow.key}
              sellerId={editingRow.sellerId}
              sellerName={sellerFull[editingRow.sellerId] ?? ''}
              date={editingRow.date}
              route={editingRow.route}
              start={start}
              canEdit={canEdit}
              color={colorBy === 'weekday' ? weekdayColor(editingRow.date) : (sellerColors[editingRow.sellerId] ?? OTHER_COLOR)}
              today={today}
              onClose={closeEditor}
              onDraftChange={onDraftChange}
              onDirtyChange={onDirtyChange}
            />
          ) : (
            <RouteList
              rows={rows}
              mode={mode}
              single={single}
              loading={q.isPending}
              canEdit={canEdit}
              highlightKey={highlightKey}
              sellerNames={sellerFull}
              colorOf={(r) => (colorBy === 'weekday' ? weekdayColor(r.date) : (sellerColors[r.sellerId] ?? OTHER_COLOR))}
              onOpen={openEditor}
            />
          )}
        </section>
      </div>
    </>
  );
}

function RouteList({
  rows,
  mode,
  single,
  loading,
  canEdit,
  highlightKey,
  sellerNames,
  colorOf,
  onOpen,
}: {
  rows: ListRow[];
  mode: PeriodMode;
  single: boolean;
  loading: boolean;
  canEdit: boolean;
  highlightKey: string | null;
  sellerNames: Record<string, string>;
  colorOf: (r: ListRow) => string;
  onOpen: (key: string) => void;
}) {
  const withRoute = rows.filter((r) => r.route && r.route.stops.length).length;
  const groupByDate = !single && mode !== 'day';
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 font-display text-[18px] font-bold">Rotas do período</h2>
        <span className="text-[12px] text-ink-2">{withRoute} com visitas · clique para ver e configurar</span>
      </div>
      {loading && <LoadingBlock />}
      {!loading && rows.length === 0 && <span className="text-[13px] text-ink-2">Nenhuma rota no período com esses filtros.</span>}
      <ul className="m-0 flex list-none flex-col p-0" aria-label="Lista de rotas">
        {rows.map((r, i) => {
          const showHeader = groupByDate && (i === 0 || rows[i - 1]!.date !== r.date);
          const stops = r.route?.stops ?? [];
          const done = stops.filter((s) => s.status === 'done').length;
          const inProg = stops.filter((s) => s.status === 'in_progress').length;
          const pending = stops.length - done - inProg;
          const empty = stops.length === 0;
          const title = single ? dayShortLabel(r.date) : (sellerNames[r.sellerId] ?? '—');
          const on = highlightKey === r.key;
          return (
            <li key={r.key}>
              {showHeader && <div className="sticky top-[-16px] z-[1] -mx-1 bg-surface px-1 pt-3 pb-1 text-[12px] font-bold tracking-wide text-ink-2 uppercase">{dayShortLabel(r.date)}</div>}
              {empty ? (
                <div className="flex min-h-[48px] items-center justify-between gap-2 border-b border-line-2 py-1.5 pl-1">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="inline-block h-6 w-1.5 shrink-0 rounded bg-line" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[14px] font-semibold text-ink-2">{title}</span>
                      <span className="text-[12px] text-ink-2">Sem rota</span>
                    </span>
                  </span>
                  {canEdit ? (
                    <Button size="sm" onClick={() => onOpen(r.key)} aria-label={`Criar rota: ${title}`}>
                      <IconPlus size={14} />
                      Criar rota
                    </Button>
                  ) : null}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onOpen(r.key)}
                  aria-current={on ? 'true' : undefined}
                  className={cx(
                    'flex min-h-[52px] w-full items-center gap-2.5 border-b border-line-2 py-1.5 pr-1 pl-1 text-left hover:bg-ground',
                    on && 'bg-accent-soft/60 hover:bg-accent-soft/60',
                  )}
                  data-testid="route-row"
                >
                  <span className="inline-block h-8 w-1.5 shrink-0 rounded" style={{ background: colorOf(r) }} aria-hidden="true" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[14px] font-semibold">
                      {title}
                      {!single && mode === 'day' && <span className="font-normal text-ink-2"> · {r.route?.region}</span>}
                    </span>
                    <span className="text-[12px] text-ink-2 tabular-nums">
                      {stops.length} visitas · {formatKm(r.route?.total_km ?? 0, 0)}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-wrap justify-end gap-1">
                    {done > 0 && <Badge tone="success">{done} feitas</Badge>}
                    {inProg > 0 && <Badge tone="pending">{inProg} em atend.</Badge>}
                    {pending > 0 && <Badge tone="neutral">{pending} pend.</Badge>}
                  </span>
                  <IconChevronRight size={15} className="shrink-0 text-ink-2" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
