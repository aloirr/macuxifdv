/**
 * Coisas que dependem do aparelho: localização (o UUID vem de `motor.ambiente.novoId()`, RD-0046) do check-in/checkout.
 * Não é importado pelos testes (depende de expo/react-native).
 */
import * as Location from 'expo-location';
import { Platform } from 'react-native';

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
