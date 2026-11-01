/**
 * Coisas que dependem do aparelho: UUID (idempotência, gerado no aparelho) e localização do check-in/checkout.
 * Não é importado pelos testes (depende de expo/react-native).
 */
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import { Platform } from 'react-native';

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

export interface PosicaoDoAparelho {
  lat: number;
  lng: number;
  precisao_m: number | null;
}

/**
 * Posição do check-in/checkout (RN-CORE-13): lida UMA vez, no momento da ação; nunca rastro. Sem permissão, sem sinal de
 * GPS (8 s) ou no navegador devolve `null` e o atendimento segue marcado "sem GPS" — não se usa mais a coordenada do
 * cliente como reserva (isso escondia o fora do raio, RN-CORE-10).
 */
export async function gpsAgora(): Promise<PosicaoDoAparelho | null> {
  if (Platform.OS === 'web') return null;
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return null;
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    const p = pos ?? (await Location.getLastKnownPositionAsync());
    return p ? { lat: p.coords.latitude, lng: p.coords.longitude, precisao_m: p.coords.accuracy ?? null } : null;
  } catch {
    return null;
  }
}
