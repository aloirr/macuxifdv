/**
 * Formato do trajeto na tela (T-0156; spec `docs/design/tracking/spec.md` §3): o mesmo texto e o mesmo desenho no "Meu trajeto" do
 * Campo e no mapa da equipe do Gestão. Funções puras; sem coordenada em texto.
 */
import { formatHHMM } from '@macuxi/comum/fuso';
import type { PontoDoTrajeto } from './trajeto';

/** Pausa do dia para o desenho e a lista; `fim` nulo = em curso. */
export interface PausaDoDia {
  inicio: string;
  fim: string | null;
}

/** "850 m" abaixo de 1 km; a partir de 1 km, uma casa com vírgula ("18,6 km"). */
export function formatarDistancia(metros: number): string {
  return metros < 1000 ? `${metros} m` : `${(metros / 1000).toFixed(1).replace('.', ',')} km`;
}

/** "08:04" de um instante UTC, no fuso do tenant. */
export function formatarHoraDoTrajeto(instante: string, fuso: string): string {
  return formatHHMM(instante, fuso);
}

/** Trajeto em trechos de pontos: sólidos, e tracejado o trecho que cruza uma pausa (o gestor não lê o buraco como falha). */
export function trechosDoTrajeto(pontos: readonly PontoDoTrajeto[], pausas: readonly PausaDoDia[]): { solidos: PontoDoTrajeto[][]; tracejados: PontoDoTrajeto[][] } {
  const ordenados = [...pontos].sort((a, b) => Date.parse(a.capturado_em) - Date.parse(b.capturado_em));
  const solidos: PontoDoTrajeto[][] = [];
  const tracejados: PontoDoTrajeto[][] = [];
  let atual: PontoDoTrajeto[] = [];
  for (let i = 0; i < ordenados.length; i++) {
    const p = ordenados[i]!;
    const ant = ordenados[i - 1];
    const cruza = ant ? pausas.some((x) => Date.parse(x.inicio) < Date.parse(p.capturado_em) && (x.fim === null || Date.parse(x.fim) > Date.parse(ant.capturado_em))) : false;
    if (cruza && ant) {
      if (atual.length > 1) solidos.push(atual);
      tracejados.push([ant, p]);
      atual = [p];
    } else atual.push(p);
  }
  if (atual.length > 1) solidos.push(atual);
  return { solidos, tracejados };
}

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
