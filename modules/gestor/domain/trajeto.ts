/**
 * Trajeto do dia da equipe no mapa do Gestor (T-0156; docs/desenho/tracking.md §9). Função pura: o aparelho e o navegador
 * desenham a linha com estas coordenadas de tela; nenhum provedor de mapa recebe o trajeto (nem pelo servidor).
 * RN-CORE-13: sem pontos (tracking desligado de fábrica, sem termo ou fora do expediente) o resultado é `vazio`.
 * A coordenada nunca vai para log nem para mensagem de erro (§9): este módulo não registra nada.
 */
import type { PontoDoTrajeto } from '@macuxi/core/contracts';

export interface PontoDesenhado {
  x: number;
  y: number;
  /** HH:mm no fuso do tenant. */
  hora: string;
}
export interface TrajetoDesenhado {
  vazio: boolean;
  /** Pontos em ordem de `capturado_em`, já em coordenadas de tela. */
  linha: { x: number; y: number }[];
  primeiro: PontoDesenhado | null;
  ultimo: PontoDesenhado | null;
  total: number;
}
export interface OpcoesDesenho {
  largura: number;
  altura: number;
  margem: number;
  /** Fuso IANA do tenant, só para a hora exibida. */
  fuso: string;
}

const hora = (iso: string, fuso: string): string =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

/**
 * Ordena por `capturado_em`, projeta (equiretangular com a longitude corrigida pelo cosseno da latitude média, norte em cima) e
 * ajusta à área com margem, mantendo a proporção e centralizando.
 */
export function desenharTrajeto(pontos: readonly PontoDoTrajeto[], o: OpcoesDesenho): TrajetoDesenhado {
  if (pontos.length === 0) return { vazio: true, linha: [], primeiro: null, ultimo: null, total: 0 };
  const ordem = [...pontos].sort((a, b) => Date.parse(a.capturado_em) - Date.parse(b.capturado_em));
  const latMedia = ordem.reduce((s, q) => s + q.latitude, 0) / ordem.length;
  const k = Math.cos((latMedia * Math.PI) / 180);
  const xs = ordem.map((q) => q.longitude * k);
  const ys = ordem.map((q) => -q.latitude);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const livreX = Math.max(o.largura - 2 * o.margem, 0);
  const livreY = Math.max(o.altura - 2 * o.margem, 0);
  const dx = maxX - minX;
  const dy = maxY - minY;
  const escala = dx === 0 && dy === 0 ? 0 : Math.min(dx === 0 ? Infinity : livreX / dx, dy === 0 ? Infinity : livreY / dy);
  const sobraX = livreX - dx * escala;
  const sobraY = livreY - dy * escala;
  const linha = ordem.map((_, i) => ({ x: o.margem + sobraX / 2 + (xs[i]! - minX) * escala, y: o.margem + sobraY / 2 + (ys[i]! - minY) * escala }));
  const marca = (i: number): PontoDesenhado => ({ ...linha[i]!, hora: hora(ordem[i]!.capturado_em, o.fuso) });
  return { vazio: false, linha, primeiro: marca(0), ultimo: marca(ordem.length - 1), total: ordem.length };
}
