/**
 * RN-CORE-46: km do dia pelos pontos do rastreamento (T-0170 §5; T-0156). Função pura, a mesma no servidor (resumo diário
 * `core.deslocamento_dia`) e no aparelho (km parcial de hoje pelos pontos locais, offline).
 *
 * Km = Σ haversine entre pontos consecutivos aceitos, em ordem de instante:
 * - ponto com precisão pior que o máximo (padrão 50 m), sem precisão ou com coordenada inválida fica fora;
 * - ponto que exigiria velocidade acima do máximo (padrão 150 km/h) desde o último ponto aceito é um salto e fica fora.
 * Não há estimativa por linha reta entre check-ins: sem pontos, não há km.
 */
import { emMs } from './tempo';

/** Ponto do expediente (T-0145 §4). Instante em UTC. */
export interface PontoTrajeto {
  latitude: number;
  longitude: number;
  /** Precisão informada pelo aparelho, em metros; nula = desconhecida (fica fora). */
  precisao_m: number | null;
  capturado_em: string;
}

/** Parâmetros `rastreamento.km_precisao_max_m` e `rastreamento.km_velocidade_max_kmh`. */
export interface ParametrosTrajeto {
  precisao_max_m: number;
  velocidade_max_kmh: number;
}
export const TRAJETO_PADRAO: ParametrosTrajeto = { precisao_max_m: 50, velocidade_max_kmh: 150 };

export interface Trajeto {
  /** Metros, meio para cima. */
  metros: number;
  /** Pontos usados na soma. */
  pontos: number;
}

/** Raio médio da Terra (IUGG), em metros. */
const RAIO_TERRA_M = 6_371_008.8;
const rad = (g: number) => (g * Math.PI) / 180;

/** Distância em metros entre dois pontos pela fórmula de haversine. */
export function haversineM(
  a: Pick<PontoTrajeto, 'latitude' | 'longitude'>,
  b: Pick<PontoTrajeto, 'latitude' | 'longitude'>,
): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * RAIO_TERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const valido = (p: PontoTrajeto, precisaoMax: number): boolean =>
  Number.isFinite(p.latitude) &&
  Number.isFinite(p.longitude) &&
  Math.abs(p.latitude) <= 90 &&
  Math.abs(p.longitude) <= 180 &&
  p.precisao_m !== null &&
  Number.isFinite(p.precisao_m) &&
  p.precisao_m >= 0 &&
  p.precisao_m <= precisaoMax &&
  Number.isFinite(Date.parse(p.capturado_em));

/** RN-CORE-46: metros percorridos e pontos usados. */
export function metrosDoTrajeto(
  pontos: readonly PontoTrajeto[],
  p: ParametrosTrajeto = TRAJETO_PADRAO,
): Trajeto {
  const l = pontos
    .filter((x) => valido(x, p.precisao_max_m))
    .map((x) => ({ ...x, ms: emMs(x.capturado_em) }))
    .sort((a, b) => a.ms - b.ms);
  if (l.length === 0) return { metros: 0, pontos: 0 };
  const maxMs = p.velocidade_max_kmh / 3.6 / 1000; // metros por milissegundo
  let ref = l[0]!;
  let metros = 0;
  let usados = 1;
  for (const x of l.slice(1)) {
    const d = haversineM(ref, x);
    const dt = x.ms - ref.ms;
    if (d > maxMs * dt) continue; // salto (inclui deslocamento com dt = 0)
    metros += d;
    ref = x;
    usados++;
  }
  return { metros: Math.round(metros), pontos: usados };
}
