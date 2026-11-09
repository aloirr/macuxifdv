/**
 * Utilidades que dependem do aparelho: UUID, URL padrão da API, localização.
 * RD-0046: o `uuid` daqui é a fonte única do UUID do aparelho; chega aos módulos como `ambiente.novoId` (services/ambiente.ts).
 */
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import type { PosicaoDoAparelho } from '@macuxi/platform-sdk';
import * as Location from 'expo-location';
import { Platform } from 'react-native';

import { defaultApiUrl } from '@/lib/api-url';
import { lerPerfilBuild, type PerfilBuild } from '@/lib/endereco-do-build';
import { lerModoApi, PORTA_API } from '@/lib/modo-api';

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

/** Modo da API do build (`EXPO_PUBLIC_API_MODO`; o Expo embute EXPO_PUBLIC_* no bundle). */
export function modoApi() {
  return lerModoApi({ EXPO_PUBLIC_API_MODO: process.env.EXPO_PUBLIC_API_MODO });
}

/** Perfil do build (`EXPO_PUBLIC_PERFIL_BUILD` do eas.json; T-0038): decide se o endereço do servidor é fixo. */
export function perfilBuildAtual(): PerfilBuild {
  return lerPerfilBuild({ EXPO_PUBLIC_PERFIL_BUILD: process.env.EXPO_PUBLIC_PERFIL_BUILD }, __DEV__);
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
    porta: PORTA_API[modoApi()],
  });
}

/**
 * Posição do momento (foto do promotor, RN-PRO-02): lida UMA vez, nunca rastro. Sem permissão, sem sinal de GPS em 8 s (tenta a
 * última posição conhecida) ou no navegador devolve `null` e o registro segue "sem GPS". Sem reserva com a coordenada do
 * cliente (a da fase M saiu, RD-0046): ela esconderia o fora do raio. Chega aos módulos como `ambiente.posicaoAgora()`
 * (services/ambiente.ts); `lida_em` é o instante UTC da leitura (anterior à ação quando vem da última posição conhecida).
 */
export async function posicaoAgora(): Promise<PosicaoDoAparelho | null> {
  if (Platform.OS === 'web') return null;
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return null;
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    const p = pos ?? (await Location.getLastKnownPositionAsync());
    if (!p) return null;
    const lidaEm = Number.isFinite(p.timestamp) ? new Date(p.timestamp) : new Date();
    return { lat: p.coords.latitude, lng: p.coords.longitude, precisao_m: p.coords.accuracy ?? null, lida_em: lidaEm.toISOString() };
  } catch {
    return null;
  }
}
