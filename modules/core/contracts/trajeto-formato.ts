/**
 * Formato do trajeto na tela (T-0156; spec `docs/design/tracking/spec.md` §3): o texto e o desenho do mapa da equipe do Gestão. Funções puras; sem coordenada em texto.
 */
import type { PontoDoTrajeto } from './trajeto';

/** "850 m" abaixo de 1 km; a partir de 1 km, uma casa com vírgula ("18,6 km"). */
export function formatarDistancia(metros: number): string {
  return metros < 1000 ? `${metros} m` : `${(metros / 1000).toFixed(1).replace('.', ',')} km`;
}

/** "08:04" de um instante UTC, no fuso do tenant. */
export { formatHHMM } from '@macuxi/comum/fuso';

/** Projeta latitude e longitude na caixa do mapa (equiretangular com correção do cosseno da latitude), com margem. */
export function projetarPontos(pontos: readonly Pick<PontoDoTrajeto, 'latitude' | 'longitude'>[], largura: number, altura: number, margem: number): Array<{ x: number; y: number }> {
  if (pontos.length === 0) return [];
  const lat0 = pontos.reduce((s, p) => s + p.latitude, 0) / pontos.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = pontos.map((p) => p.longitude * k);
  const ys = pontos.map((p) => -p.latitude);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const w = Math.max(x1 - x0, 1e-9);
  const h = Math.max(y1 - y0, 1e-9);
  const escala = Math.min((largura - 2 * margem) / w, (altura - 2 * margem) / h);
  const ox = (largura - w * escala) / 2;
  const oy = (altura - h * escala) / 2;
  return pontos.map((_, i) => ({ x: ox + (xs[i]! - x0) * escala, y: oy + (ys[i]! - y0) * escala }));
}
