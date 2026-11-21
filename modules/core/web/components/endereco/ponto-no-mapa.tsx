'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import { AttributionControl, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';

export interface PontoNoMapaProps {
  /** ponto marcado; `null` = ainda sem ponto (o primeiro clique marca) */
  valor: { lat: number; lng: number } | null;
  onChange: (ponto: { lat: number; lng: number }) => void;
  /** onde o mapa abre quando não há ponto: o centro dos clientes da carteira (sem geocodificação) */
  centro: [number, number];
  disabled?: boolean;
}

/** Pino grafite (`--color-ink`), borda branca de 2,5 px e furo branco; nunca o ícone padrão do Leaflet (spec §5). */
const PINO = L.divIcon({
  className: 'fv-stop-icon',
  html: '<svg width="30" height="38" viewBox="0 0 30 38" aria-hidden="true"><path d="M15 36C15 36 3 23.5 3 14.5a12 12 0 1 1 24 0C27 23.5 15 36 15 36Z" fill="var(--color-ink)" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round"/><circle cx="15" cy="14.5" r="4.5" fill="#ffffff"/></svg>',
  iconSize: [30, 38],
  iconAnchor: [15, 36],
});

function Cliques({ onChange, disabled }: Pick<PontoNoMapaProps, 'onChange' | 'disabled'>) {
  useMapEvents({
    click: (e) => {
      if (!disabled) onChange({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

/** O Leaflet mede o contêiner na montagem; refaz quando o quadro muda de tamanho (diálogo e gaveta abrem animados). */
function Medida() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

/** Segue o ponto quando ele muda de fora (ex.: trocou de Casa para Outro endereço). */
function Seguir({ valor }: { valor: PontoNoMapaProps['valor'] }) {
  const map = useMap();
  useEffect(() => {
    if (valor && !map.getBounds().contains([valor.lat, valor.lng])) map.setView([valor.lat, valor.lng], map.getZoom(), { animate: false });
  }, [map, valor]);
  return null;
}

/**
 * Mapa pequeno para marcar o ponto do endereço (T-0191, RN-CORE-75): marcador arrastável e clique no mapa. O mapa fica contido (`isolate` no quadro e `z-0` aqui: os painéis do Leaflet têm z-index até 1000 e não podem cobrir o rodapé da gaveta), com a atribuição © OpenStreetMap visível. Um componente só, usado
 * na gaveta "Editar usuário" (casa) e no diálogo "Endereço base" (Outro endereço).
 */
export default function PontoNoMapa({ valor, onChange, centro, disabled }: PontoNoMapaProps) {
  const handlers = useMemo(
    () => ({
      dragend: (e: L.LeafletEvent) => {
        const p = (e.target as L.Marker).getLatLng();
        onChange({ lat: p.lat, lng: p.lng });
      },
    }),
    [onChange],
  );
  const inicio: [number, number] = valor ? [valor.lat, valor.lng] : centro;
  return (
    <MapContainer center={inicio} zoom={valor ? 16 : 12} scrollWheelZoom={!disabled} className="fv-map relative z-0 h-full w-full" attributionControl={false}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" maxZoom={19} />
      <AttributionControl prefix={false} position="bottomright" />
      <Medida />
      <Seguir valor={valor} />
      <Cliques onChange={onChange} disabled={disabled} />
      {valor && <Marker position={[valor.lat, valor.lng]} icon={PINO} draggable={!disabled} eventHandlers={handlers} title="Ponto no mapa" />}
    </MapContainer>
  );
}
