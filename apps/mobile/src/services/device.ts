/**
 * Utilidades que dependem do aparelho: UUID, URL padrão da API, localização.
 */
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import { Platform } from 'react-native';

import { defaultApiUrl } from '@/lib/api-url';

/** UUID v4 gerado no aparelho (expo-crypto; reserva para navegador em http sem contexto seguro). */
export function uuid(): string {
  try {
    const id = Crypto.randomUUID();
    if (id) return id;
  } catch {
    // segue para a reserva
  }
  const bytes = new Uint8Array(16);
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
  if (g.crypto?.getRandomValues) g.crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function platformDefaultApiUrl(): string {
  const w = globalThis as { location?: { hostname?: string } };
  const c = Constants as unknown as { expoConfig?: { hostUri?: string } | null; expoGoConfig?: { debuggerHost?: string } | null; linkingUri?: string };
  const hostUri = c.expoConfig?.hostUri ?? c.expoGoConfig?.debuggerHost ?? null;
  return defaultApiUrl({
    envUrl: process.env.EXPO_PUBLIC_API_URL ?? null,
    platform: Platform.OS,
    browserHost: Platform.OS === 'web' ? (w.location?.hostname ?? null) : null,
    hostUri,
  });
}

export interface Position {
  lat: number | null;
  lng: number | null;
  source: 'gps' | 'customer';
}

/**
 * Localização do check-in. No navegador, ou se a permissão for negada/demorar, usa a do cliente
 * (fase M: o mockup roda no PC, longe do cliente).
 */
export async function currentPosition(fallback: { lat: number | null; lng: number | null }): Promise<Position> {
  const fb: Position = { lat: fallback.lat, lng: fallback.lng, source: 'customer' };
  if (Platform.OS === 'web') return fb;
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return fb;
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    if (!pos) {
      const last = await Location.getLastKnownPositionAsync();
      return last ? { lat: last.coords.latitude, lng: last.coords.longitude, source: 'gps' } : fb;
    }
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'gps' };
  } catch {
    return fb;
  }
}
