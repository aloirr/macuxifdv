'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useMemo, useRef } from 'react';
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import type { GeoPoint } from '../../../domain';
import { boundsPoints, type MapRoute, type MapStop, STATUS_FILL, STATUS_LABEL, idleLabel, dayLabel } from '../../lib/routes';

export interface RouteMapProps {
  start: GeoPoint;
  routes: MapRoute[];
  sellerNames: Record<string, string>;
  /** só marcadores pequenos para as rotas não destacadas (muitos dados) */
  dense: boolean;
  /** rota destacada (fitBounds nela) */
  focusKey: string | null;
  onSelectRoute?: (key: string) => void;
}

/** Bolinha numerada: feita = verde, em atendimento = laranja, pendente = branca com contorno na cor da rota. */
function stopIcon(seq: number, status: MapStop['status'], color: string, dimmed: boolean): L.DivIcon {
  const filled = status === 'done' ? STATUS_FILL.done : status === 'in_progress' ? STATUS_FILL.in_progress : null;
  const bg = filled ?? '#ffffff';
  const fg = filled ? '#ffffff' : '#16202a';
  const ring = filled ? '#ffffff' : color;
  const size = seq > 9 ? 26 : 24;
  return L.divIcon({
    className: 'fv-stop-icon',
    html: `<span class="fv-stop${dimmed ? ' fv-stop--dim' : ''}" style="width:${size}px;height:${size}px;background:${bg};color:${fg};border-color:${ring};box-shadow:0 0 0 2px ${filled ? color : '#ffffff'}">${seq}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

const startIcon = L.divIcon({
  className: 'fv-stop-icon',
  html: '<span class="fv-start" title="CD Manaus · ponto de saída">CD</span>',
  iconSize: [34, 34],
  iconAnchor: [17, 17],
  popupAnchor: [0, -17],
});

function StopPopup({ stop, route, sellerName }: { stop: MapStop; route: MapRoute; sellerName: string }) {
  const c = stop.customer;
  return (
    <div className="flex min-w-[200px] flex-col gap-0.5 text-[13px] text-ink">
      <strong className="text-[14px]">
        {stop.seq}. {c.trade_name}
      </strong>
      <span className="text-ink-2">
        {c.district} · {c.city}
      </span>
      <span>
        Curva <strong>{c.abc_curve}</strong> · janela {stop.window_start}–{stop.window_end}
      </span>
      <span>
        Status: <strong>{STATUS_LABEL[stop.status]}</strong>
      </span>
      <span className="text-ink-2">
        Última compra: {c.last_purchase_at ? `${c.last_purchase_at.slice(8, 10)}/${c.last_purchase_at.slice(5, 7)}/${c.last_purchase_at.slice(0, 4)}` : '—'} ({idleLabel(c)})
      </span>
      <span className="mt-1 text-[12px] text-ink-2">
        {sellerName} · {dayLabel(route.date)}
      </span>
    </div>
  );
}

/** Enquadra os pontos quando o conjunto muda (não a cada atualização dos dados). */
function FitBounds({ points, signature }: { points: Array<[number, number]>; signature: string }) {
  const map = useMap();
  const last = useRef<string>('');
  useEffect(() => {
    if (signature === last.current || points.length === 0) return;
    last.current = signature;
    // sem animação: o Leaflet ignora um setView pedido durante outra animação de zoom (filtros trocados em sequência)
    if (points.length === 1) map.setView(points[0]!, 13, { animate: false });
    else map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 15, animate: false });
  }, [map, points, signature]);
  return null;
}

/** O Leaflet mede o contêiner na montagem; refaz quando o quadro muda de tamanho. */
function ResizeWatcher() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

export default function RouteMap({ start, routes, sellerNames, dense, focusKey, onSelectRoute }: RouteMapProps) {
  const points = useMemo(() => {
    const onlyFocus = focusKey && routes.some((r) => r.key === focusKey && r.stops.length > 0) ? focusKey : null;
    return boundsPoints(routes, start, onlyFocus);
  }, [routes, start, focusKey]);
  // muda quando o conjunto de rotas ou o destaque muda (não quando o status de uma parada muda)
  // e quando entra ou sai parada da rota em foco (rota em edição)
  const signature = useMemo(() => {
    const focus = focusKey ? routes.find((r) => r.key === focusKey) : undefined;
    return `${focusKey ?? ''}:${focus?.stops.length ?? 0}#${routes.map((r) => r.key).join(',')}`;
  }, [routes, focusKey]);
  const center: [number, number] = start.lat !== null && start.lng !== null ? [start.lat, start.lng] : [-3.1, -60.0];

  return (
    <MapContainer center={center} zoom={11} scrollWheelZoom className="fv-map h-full w-full" preferCanvas={false} attributionControl>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" maxZoom={19} />
      <ResizeWatcher />
      <FitBounds points={points} signature={signature} />

      {routes.map((r) => {
        const dimmed = r.emphasis === 'dimmed';
        const highlight = r.emphasis === 'highlight';
        const sellerName = sellerNames[r.sellerId] ?? '';
        return (
          <FeatureRoute
            key={r.key}
            route={r}
            sellerName={sellerName}
            dimmed={dimmed}
            highlight={highlight}
            small={dense && !highlight}
            onSelect={onSelectRoute}
          />
        );
      })}

      {start.lat !== null && start.lng !== null && (
        <Marker position={[start.lat, start.lng]} icon={startIcon} zIndexOffset={1000}>
          <Popup>
            <div className="flex flex-col gap-0.5 text-[13px]">
              <strong>CD Manaus</strong>
              <span className="text-ink-2">Ponto de saída de todas as rotas</span>
            </div>
          </Popup>
        </Marker>
      )}
    </MapContainer>
  );
}

function FeatureRoute({
  route,
  sellerName,
  dimmed,
  highlight,
  small,
  onSelect,
}: {
  route: MapRoute;
  sellerName: string;
  dimmed: boolean;
  highlight: boolean;
  small: boolean;
  onSelect?: (key: string) => void;
}) {
  const icons = useMemo(
    () => (small ? [] : route.stops.map((s) => stopIcon(s.seq, s.status, route.color, dimmed))),
    [route.stops, route.color, dimmed, small],
  );
  const lineEvents = useMemo(() => ({ click: () => onSelect?.(route.key) }), [onSelect, route.key]);
  return (
    <>
      {route.showLine && route.positions.length > 1 && (
        <Polyline
          positions={route.positions}
          pathOptions={{
            color: route.color,
            weight: highlight ? 5 : 3,
            opacity: dimmed ? 0.18 : highlight ? 0.95 : 0.75,
            dashArray: undefined,
            lineJoin: 'round',
          }}
          eventHandlers={lineEvents}
        >
          <Popup>
            <span className="text-[13px]">
              <strong>{sellerName}</strong> · {dayLabel(route.date)} · {route.stops.length} visitas
            </span>
          </Popup>
        </Polyline>
      )}
      {route.stops.map((s, i) =>
        small ? (
          <CircleMarker
            key={s.id}
            center={[s.lat, s.lng]}
            radius={5}
            pathOptions={{
              color: '#ffffff',
              weight: 1.5,
              fillColor: s.status === 'done' ? STATUS_FILL.done : s.status === 'in_progress' ? STATUS_FILL.in_progress : route.color,
              fillOpacity: dimmed ? 0.3 : 0.9,
              opacity: dimmed ? 0.4 : 1,
            }}
          >
            <Popup>
              <StopPopup stop={s} route={route} sellerName={sellerName} />
            </Popup>
          </CircleMarker>
        ) : (
          <Marker key={s.id} position={[s.lat, s.lng]} icon={icons[i]!} zIndexOffset={highlight ? 500 : 0} title={`${s.seq}. ${s.customer.trade_name}`}>
            <Popup>
              <StopPopup stop={s} route={route} sellerName={sellerName} />
            </Popup>
          </Marker>
        ),
      )}
    </>
  );
}
