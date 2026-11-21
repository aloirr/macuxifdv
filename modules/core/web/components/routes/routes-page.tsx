'use client';

import dynamic from 'next/dynamic';
import { usePode } from '@macuxi/platform-sdk/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RouteDay, Seller } from '../../../contracts';
import { resumoDaBase, ROTULO_TIPO_BASE } from '../../../domain';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { formatInt, IconCasa, IconChevronRight, IconPlus, Badge, Button, cx, ErrorBlock, FilterBar, KpiCard, KpiGrid, LoadingBlock, PageHeader, SelectField, SkeletonCards, useToast } from '@macuxi/ui/web';
import { useMe, useRoutes, useSellersDeRota, useTeamsDeRota } from '../../lib/queries';
import { diaDaPreviaParaRouteDay, pontoDaBase } from '../../lib/rotas-api';
import { corpoDoLote, diaComRascunho, totaisDaPreviaAberta } from '../../lib/rotas-criar';
import { usePrevia, useSalvarLote } from '../../lib/rotas-criar-api';
import {
  buildMapRoutes,
  type CalendarioDaTela,
  colorByFor,
  dayShortLabel,
  diaTracejado,
  diasDoCalendario,
  diasDaLegendaDoMapa,
  formatKm,
  isDense,
  isIsoDate,
  type MapStop,
  OTHER_COLOR,
  type PeriodMode,
  periodContains,
  periodLabel,
  periodRange,
  routeKey,
  routeKpis,
  sellerColorMap,
  shiftAnchor,
  STATUS_FILL,
  subtituloDoKm,
  traceDaCor,
  traceDoDia,
  weekday,
  weekdayColor,
  WEEKDAY_COLORS,
  WEEKDAY_SHORT,
} from '../../lib/routes';
import { BaseDialog } from './base-dialog';
import { ClientesForaLimite, ClientesForaSemCoordenada } from './clientes-fora-dialog';
import { CriarRotaDialog, type PreviaCriada } from './criar-rota-dialog';
import { PeriodNav, Segmented } from './periodo-controles';
import { PreviaPanel } from './previa-panel';
import { RouteEditor } from './route-editor';
import type { BaseNoMapa } from './route-map';

const RouteMap = dynamic(() => import('./route-map'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center bg-neutral-soft text-[13px] text-ink-2">Carregando mapa…</div>,
});

interface ListRow {
  key: string;
  sellerId: string;
  date: string;
  route: RouteDay | null;
  /** dia da semana útil que é feriado e não tem rota (RN-CORE-76, D3) */
  holiday?: boolean;
}

/** A prévia aberta (T-0191): a resposta do servidor, os dias já com as edições do editor e um id por dia para o lote ser idempotente. */
interface PreviaAberta extends PreviaCriada {
  dias: RouteDay[];
  ids: Record<string, string>;
  editado: boolean;
}

const parseMode = (v: string | null): PeriodMode => (v === 'week' || v === 'month' ? v : 'day');

function MarcaBase() {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-[4px] bg-ink text-white" aria-hidden="true">
        <IconCasa size={11} />
      </span>{' '}
      Base
    </span>
  );
}

function StatusLegend({ comBase }: { comBase: boolean }) {
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
      {comBase && <MarcaBase />}
    </div>
  );
}

export function RoutesPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const me = useMe();
  const teams = useTeamsDeRota();
  const sellers = useSellersDeRota();
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

  // criar rota por proximidade (T-0191)
  const [criarOpen, setCriarOpen] = useState(false);
  const [previa, setPrevia] = useState<PreviaAberta | null>(null);
  const [baseOpen, setBaseOpen] = useState(false);
  const [foraAberto, setForaAberto] = useState<'sem_coordenada' | 'limite' | null>(null);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const coordenadaGerada = useRef(false);
  const refazer = usePrevia();
  const salvarLote = useSalvarLote();

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

  /* o calendário do tenant vem na resposta da lista; o período da lista, do diálogo e o rótulo usam o mesmo (o do tenant, ou o padrão até a 1ª resposta) */
  const [calendario, setCalendario] = useState<CalendarioDaTela | null>(null);
  const range = useMemo(() => (anchor ? periodRange(mode, anchor, calendario) : { from: '', to: '' }), [mode, anchor, calendario]);
  const q = useRoutes({ from: range.from, to: range.to, seller_id: sellerId, team_id: teamId }, !!anchor);
  const calendarioDaResposta = q.data?.calendario;
  useEffect(() => {
    if (calendarioDaResposta) setCalendario((atual) => (JSON.stringify(atual) === JSON.stringify(calendarioDaResposta) ? atual : calendarioDaResposta));
  }, [calendarioDaResposta]);
  const bases = q.data?.bases;
  /** RN-CORE-75: a saída de cada vendedor é a base dele; sem base não há ponto e o km conta do 1º cliente. Na prévia, a base da prévia. */
  const startOf = useCallback((id: string) => (previa ? pontoDaBase(previa.resposta.base) : pontoDaBase(bases?.[id])), [previa, bases]);
  const routes = useMemo(() => (previa ? previa.dias : (q.data?.items ?? []).filter((r) => r.date >= range.from && r.date <= range.to)), [previa, q.data, range]);

  const sellerList: Seller[] = useMemo(() => sellers.data ?? [], [sellers.data]);
  const sellerColors = useMemo(() => sellerColorMap(sellerList.map((s) => s.id)), [sellerList]);
  const sellerNames = useMemo(() => Object.fromEntries(sellerList.map((s) => [s.id, s.short_name])), [sellerList]);
  const sellerFull = useMemo(() => Object.fromEntries(sellerList.map((s) => [s.id, s.name])), [sellerList]);
  const teamSellers = useMemo(() => sellerList.filter((s) => !teamId || s.team_id === teamId), [sellerList, teamId]);

  const single = !!sellerId;
  const colorBy = colorByFor(mode, single);
  const dense = !previa && isDense(mode, single, routes.length);
  const showAllLines = linesOverride ?? !dense;
  const kpis = useMemo(() => routeKpis(routes), [routes]);

  /* linhas da lista: com um vendedor, todos os dias da semana útil do tenant (feriado marcado); no dia, os vendedores sem rota */
  const rows: ListRow[] = useMemo(() => {
    if (!range.from) return [];
    const byKey = new Map(routes.map((r) => [routeKey(r.seller_id, r.date), r]));
    const out: ListRow[] = [];
    if (previa) {
      for (const r of routes) out.push({ key: routeKey(r.seller_id, r.date), sellerId: r.seller_id, date: r.date, route: r });
    } else if (single) {
      const feriadoDoDia = new Map(diasDoCalendario(range, calendario).map((d) => [d.date, d.feriado]));
      const days = new Set([...feriadoDoDia.keys(), ...routes.map((r) => r.date)]);
      for (const d of [...days].sort()) {
        const route = byKey.get(routeKey(sellerId, d)) ?? null;
        out.push({ key: routeKey(sellerId, d), sellerId, date: d, route, holiday: !route && feriadoDoDia.get(d) === true });
      }
    } else {
      for (const r of routes) out.push({ key: routeKey(r.seller_id, r.date), sellerId: r.seller_id, date: r.date, route: r });
      if (mode === 'day') {
        for (const s of teamSellers) if (!byKey.has(routeKey(s.id, range.from))) out.push({ key: routeKey(s.id, range.from), sellerId: s.id, date: range.from, route: null });
      }
      const order = new Map(sellerList.map((s, i) => [s.id, i]));
      out.sort((a, b) => a.date.localeCompare(b.date) || (order.get(a.sellerId) ?? 99) - (order.get(b.sellerId) ?? 99));
    }
    return out;
  }, [routes, range, single, sellerId, mode, teamSellers, sellerList, previa, calendario]);

  const editingRow = editingKey ? (rows.find((r) => r.key === editingKey) ?? null) : null;
  const effectiveHighlight = editingKey ?? highlightKey;

  const mapRoutes = useMemo(
    () =>
      buildMapRoutes(routes, startOf, {
        colorBy: previa ? 'weekday' : colorBy,
        sellerColors,
        highlightKey: effectiveHighlight,
        showAllLines: previa ? true : showAllLines,
        draft: editingKey && draftStops ? { key: editingKey, stops: draftStops } : null,
      }),
    [routes, startOf, colorBy, sellerColors, effectiveHighlight, showAllLines, editingKey, draftStops, previa],
  );

  /** Marcadores da base no mapa: um por vendedor com rota na tela (na prévia, a da prévia). Sem base, sem marcador. */
  const baseMarkers: BaseNoMapa[] = useMemo(() => {
    const ids = [...new Set(routes.map((r) => r.seller_id))];
    return ids.flatMap((id) => {
      const b = previa ? previa.resposta.base : (bases?.[id] ?? null);
      if (!b) return [];
      const comNome = ids.length > 1 && !!sellerFull[id];
      return [
        {
          sellerId: id,
          point: pontoDaBase(b),
          color: !previa && colorBy === 'seller' && ids.length > 1 ? (sellerColors[id] ?? OTHER_COLOR) : null,
          titulo: comNome ? `Base de ${sellerFull[id]}` : 'Base',
          detalhe: previa ? `${ROTULO_TIPO_BASE[b.tipo]} · ${resumoDaBase(previa.resposta.base!)}` : ROTULO_TIPO_BASE[b.tipo],
        },
      ];
    });
  }, [routes, previa, bases, sellerFull, colorBy, sellerColors]);

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
    if (editingKey && !editingRow && (q.data || previa)) setEditingKey(null);
  }, [editingKey, editingRow, q.data, previa]);

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

  /* ---- prévia (T-0191) ---- */
  const abrirPrevia = (p: PreviaCriada) => {
    const novoModo = p.mode;
    set({ period: novoModo === 'day' ? null : novoModo, date: p.anchor === today ? null : p.anchor, seller: p.pedido.usuario_id });
    const dias = p.resposta.dias.map((d) => diaDaPreviaParaRouteDay(d, p.pedido.usuario_id, today));
    setPrevia({ ...p, dias, ids: Object.fromEntries(p.resposta.dias.map((d) => [d.data, crypto.randomUUID()])), editado: false });
    setErroSalvar(null);
    setCriarOpen(false);
  };
  const descartarPrevia = () => {
    if (previa?.editado && !window.confirm('Descartar a prévia? As alterações nos dias serão perdidas.')) return;
    dirtyRef.current = false;
    setPrevia(null);
    setEditingKey(null);
    setHighlightKey(null);
    setErroSalvar(null);
  };
  const salvarPrevia = () => {
    if (!previa) return;
    setErroSalvar(null);
    salvarLote.mutate(corpoDoLote(previa.pedido.usuario_id, previa.pedido.modo, previa.dias, previa.ids), {
      onSuccess: (r) => {
        toast('success', `${r.salvas} ${r.salvas === 1 ? 'rota salva' : 'rotas salvas'}.`);
        dirtyRef.current = false;
        setPrevia(null);
        setEditingKey(null);
        setHighlightKey(null);
      },
      onError: (e) => setErroSalvar(errorMessage(e)),
    });
  };
  /** Refaz a prévia com o mesmo pedido (a base trocou ou saiu coordenada nova): mantém o período, refaz os dias, a ordem e o km. */
  const refazerPrevia = () => {
    if (!previa) return;
    refazer.mutate(previa.pedido, {
      onSuccess: (resposta) => {
        setEditingKey(null);
        setPrevia((p) => (p ? { ...p, resposta, dias: resposta.dias.map((d) => diaDaPreviaParaRouteDay(d, p.pedido.usuario_id, today)), ids: Object.fromEntries(resposta.dias.map((d) => [d.data, p.ids[d.data] ?? crypto.randomUUID()])), editado: false } : p));
      },
      onError: (e) => setErroSalvar(errorMessage(e)),
    });
  };
  const aposTrocarBase = () => {
    if (previa?.editado && !window.confirm('Há dias editados na prévia. Refazer com a nova base descarta as edições. Continuar?')) return;
    refazerPrevia();
  };
  const fecharForaSemCoordenada = () => {
    setForaAberto(null);
    if (coordenadaGerada.current && previa && !previa.editado) refazerPrevia();
    coordenadaGerada.current = false;
  };
  const aplicarDia = (data: string, stops: Parameters<typeof diaComRascunho>[1]) => {
    setPrevia((p) => (p ? { ...p, editado: true, dias: p.dias.map((d) => (d.date === data ? diaComRascunho(d, stops, startOf(d.seller_id)) : d)) } : p));
    dirtyRef.current = false;
    setEditingKey(null);
  };

  const legendSellers = useMemo(() => {
    const ids = new Set(routes.map((r) => r.seller_id));
    return sellerList.filter((s) => ids.has(s.id));
  }, [routes, sellerList]);
  const singleDays = !previa && single && mode !== 'day' ? rows.filter((r) => r.route && r.route.stops.length) : [];
  const diasDaLegenda = useMemo(() => [...new Set(routes.filter((r) => r.stops.length > 0).map((r) => weekday(r.date)))].sort((a, b) => a - b), [routes]);
  const diasDaLegendaMapa = useMemo(() => diasDaLegendaDoMapa(routes, range, calendario), [routes, range, calendario]);
  const diaDeCadaLegenda = useMemo(() => Object.fromEntries(routes.map((r) => [weekday(r.date), r.date])), [routes]);

  if (me.isPending || !anchor) return <LoadingBlock />;

  const temRota = routes.some((r) => r.stops.length > 0);
  return (
    <>
      <PageHeader
        title="Rotas"
        actions={
          <>
            <Button onClick={() => void q.refetch()} disabled={q.isFetching} aria-label="Atualizar as rotas" data-testid="rotas.atualizar">
              Atualizar
            </Button>
            {canEdit && !previa && (
              <Button variant="primary" onClick={() => setCriarOpen(true)} data-testid="rotas.criar">
                <IconPlus size={16} />
                Criar rota
              </Button>
            )}
          </>
        }
      />

      <fieldset disabled={!!previa} className="m-0 min-w-0 border-0 p-0">
        <FilterBar>
          <Segmented value={mode} onChange={(m) => set({ period: m === 'day' ? null : m })} />
          <PeriodNav
            label={periodLabel(mode, anchor, calendario)}
            onPrev={() => set({ date: shiftAnchor(mode, anchor, -1, calendario) })}
            onNext={() => set({ date: shiftAnchor(mode, anchor, 1, calendario) })}
            onToday={() => set({ date: null })}
            isToday={periodContains(mode, anchor, today, calendario) && (mode !== 'day' || anchor === today)}
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
        </FilterBar>
      </fieldset>

      {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}

      {previa ? null : !q.data ? (
        q.isPending ? <SkeletonCards n={6} /> : null
      ) : (
        temRota && (
          <KpiGrid min={150}>
            <KpiCard label="Rotas no período" value={formatInt(kpis.routes)} sub={`média de ${kpis.avgPerRoute.toLocaleString('pt-BR')} visitas por rota`} />
            <KpiCard label="Visitas planejadas" value={formatInt(kpis.planned)} />
            <KpiCard label="Km total" value={formatInt(kpis.km)} sub={subtituloDoKm(routes, bases)} />
            <KpiCard label="Visitadas" value={formatInt(kpis.done)} valueClass="text-success" sub={kpis.planned ? `${Math.round((kpis.done / kpis.planned) * 100)}% do planejado` : '—'} />
            <KpiCard label="Em atendimento" value={formatInt(kpis.inProgress)} valueClass={kpis.inProgress ? 'text-accent-ink' : undefined} />
            <KpiCard label="Pendentes" value={formatInt(kpis.pending)} />
          </KpiGrid>
        )
      )}

      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* mapa */}
        <section aria-label="Mapa das rotas" className="flex min-w-0 flex-col gap-2.5 rounded-2xl border border-line bg-surface p-3 xl:h-[calc(100dvh-190px)] xl:min-h-[520px]">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1">
            {previa ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-semibold text-ink-3" aria-label="Cor por dia da semana" data-testid="previa.legenda">
                {diasDaLegenda.map((d) => (
                  <span key={d} className="flex items-center gap-1.5">
                    <span className="inline-block h-[4px] w-4 rounded" style={traceDoDia(diaDeCadaLegenda[d]!, 'horizontal')} />
                    {WEEKDAY_SHORT[d]}
                  </span>
                ))}
              </div>
            ) : colorBy === 'seller' ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-semibold text-ink-3" aria-label="Cor por vendedor">
                {legendSellers.map((s) => (
                  <span key={s.id} className="flex items-center gap-1.5">
                    <span className="inline-block h-[4px] w-4 rounded" style={{ background: sellerColors[s.id] ?? OTHER_COLOR }} />
                    {s.short_name}
                  </span>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-semibold text-ink-3" aria-label="Cor por dia da semana">
                {diasDaLegendaMapa.map((d) => (
                  <span key={d} className="flex items-center gap-1.5">
                    <span className="inline-block h-[4px] w-4 rounded" style={traceDaCor(WEEKDAY_COLORS[d]!, diaTracejado(d), 'horizontal')} />
                    {WEEKDAY_SHORT[d]}
                  </span>
                ))}
              </div>
            )}
            {previa ? <div className="text-[12px] text-ink-2">{baseMarkers.length > 0 && <MarcaBase />}</div> : <StatusLegend comBase={baseMarkers.length > 0} />}
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
            <RouteMap bases={baseMarkers} routes={mapRoutes} sellerNames={sellerNames} dense={dense} focusKey={effectiveHighlight} onSelectRoute={onMapSelect} />
          </div>
        </section>

        {/* lista, prévia ou editor */}
        <section
          ref={editorRef}
          aria-label={editingRow ? 'Editor da rota' : previa ? 'Prévia das rotas' : 'Rotas do período'}
          className="flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-2xl border border-line bg-surface p-4 xl:h-[calc(100dvh-190px)] xl:min-h-[520px] xl:overflow-y-auto"
        >
          {editingRow ? (
            <RouteEditor
              key={editingRow.key}
              sellerId={editingRow.sellerId}
              sellerName={sellerFull[editingRow.sellerId] ?? ''}
              date={editingRow.date}
              route={editingRow.route}
              start={startOf(editingRow.sellerId)}
              canEdit={canEdit}
              color={previa || colorBy === 'weekday' ? weekdayColor(editingRow.date) : (sellerColors[editingRow.sellerId] ?? OTHER_COLOR)}
              today={today}
              onClose={closeEditor}
              onDraftChange={onDraftChange}
              onDirtyChange={onDirtyChange}
              previa={previa ? { onApply: (stops) => aplicarDia(editingRow.date, stops) } : undefined}
            />
          ) : previa ? (
            <PreviaPanel
              base={previa.resposta.base}
              previa={previa.resposta}
              totais={totaisDaPreviaAberta(previa.resposta.totais, previa.dias, previa.editado)}
              dias={previa.dias}
              salvando={salvarLote.isPending || refazer.isPending}
              erro={erroSalvar}
              onAbrirDia={(data) => openEditor(routeKey(previa.pedido.usuario_id, data))}
              onSalvar={salvarPrevia}
              onDescartar={descartarPrevia}
              onTrocarBase={() => setBaseOpen(true)}
              onVerSemCoordenada={() => setForaAberto('sem_coordenada')}
              onVerForaLimite={() => setForaAberto('limite')}
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
              colorOf={(r) => (colorBy === 'weekday' ? traceDoDia(r.date, 'vertical') : { background: sellerColors[r.sellerId] ?? OTHER_COLOR })}
              onOpen={openEditor}
            />
          )}
        </section>
      </div>

      {criarOpen && <CriarRotaDialog sellers={sellerList} calendario={calendario} inicial={{ sellerId, mode, anchor }} hoje={today} onClose={() => setCriarOpen(false)} onCriada={abrirPrevia} />}
      {baseOpen && previa && <BaseDialog usuarioId={previa.pedido.usuario_id} onClose={() => setBaseOpen(false)} onSalva={aposTrocarBase} />}
      {foraAberto === 'sem_coordenada' && previa && (
        <ClientesForaSemCoordenada
          itens={previa.resposta.fora_sem_coordenada}
          onClose={fecharForaSemCoordenada}
          onGerada={() => {
            coordenadaGerada.current = true;
          }}
        />
      )}
      {foraAberto === 'limite' && previa && <ClientesForaLimite itens={previa.resposta.fora_limite} onClose={() => setForaAberto(null)} />}
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
  colorOf: (r: ListRow) => CSSProperties;
  onOpen: (key: string) => void;
}) {
  const groupByDate = !single && mode !== 'day';
  return (
    <>
      <h2 className="m-0 text-[17px] font-bold">Rotas do período</h2>
      {loading && <LoadingBlock />}
      {!loading && rows.length === 0 && <span className="text-[13px] text-ink-2">Nenhuma rota no período.</span>}
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
              {r.holiday ? (
                <div className="flex min-h-[48px] items-center gap-2.5 border-b border-line-2 py-1.5 pl-1 text-ink-2" data-testid="route-feriado">
                  <span className="inline-block h-6 w-1.5 shrink-0 rounded bg-line" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[15px] font-semibold">{title}</span>
                    <span className="text-[12px]">Feriado</span>
                  </span>
                </div>
              ) : empty ? (
                <div className="flex min-h-[48px] items-center justify-between gap-2 border-b border-line-2 py-1.5 pl-1">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="inline-block h-6 w-1.5 shrink-0 rounded bg-line" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[15px] font-semibold text-ink-2">{title}</span>
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
                  <span className="inline-block h-8 w-1.5 shrink-0 rounded" style={colorOf(r)} aria-hidden="true" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] font-semibold">
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
