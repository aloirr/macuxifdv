/**
 * Trajeto do dia da equipe no mapa do Gestor (T-0156; docs/desenho/tracking.md §9). Função pura: o aparelho e o navegador
 * desenham a linha com estas coordenadas de tela; nenhum provedor de mapa recebe o trajeto (nem pelo servidor).
 * RN-CORE-13: sem pontos (tracking desligado de fábrica, sem termo ou fora do expediente) o resultado é `vazio`.
 * A coordenada nunca vai para log nem para mensagem de erro (§9): este módulo não registra nada.
 */
import { formatarHoraDoTrajeto, projetarPontos, trechosDoTrajeto, type PausaDoDia, type PontoDoTrajeto } from '@macuxi/core/contracts';

/** RN-CORE-13: texto do app e do BKO quando o dia não tem pontos (tracking desligado, sem termo ou fora do expediente). */
export const TEXTO_SEM_TRAJETO = 'Sem trajeto';

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
  /** Trechos contínuos em coordenadas de tela; os tracejados cruzam uma pausa. */
  solidos: { x: number; y: number }[][];
  tracejados: { x: number; y: number }[][];
}
export interface OpcoesDesenho {
  largura: number;
  altura: number;
  margem: number;
  /** Fuso IANA do tenant, só para a hora exibida. */
  fuso: string;
  /** Pausas do dia (`core.trajeto_do_dia@1`); sem elas, nenhum trecho tracejado. */
  pausas?: readonly PausaDoDia[];
}

type Xy = { x: number; y: number };

/**
 * Ordena por `capturado_em`, projeta e marca as horas com as funções do Core (`projetarPontos`, `formatarHoraDoTrajeto`,
 * `trechosDoTrajeto`): o mesmo desenho e a mesma hora do "Meu trajeto" do Campo. O trecho que cruza uma pausa vai tracejado.
 */
export function desenharTrajeto(pontos: readonly PontoDoTrajeto[], o: OpcoesDesenho): TrajetoDesenhado {
  if (pontos.length === 0) return { vazio: true, linha: [], primeiro: null, ultimo: null, total: 0, solidos: [], tracejados: [] };
  const ordem = [...pontos].sort((a, b) => Date.parse(a.capturado_em) - Date.parse(b.capturado_em));
  const linha = projetarPontos(ordem, o.largura, o.altura, o.margem);
  const xy = new Map<PontoDoTrajeto, Xy>(ordem.map((q, i) => [q, linha[i]!]));
  const trechos = trechosDoTrajeto(ordem, o.pausas ?? []);
  const naTela = (t: PontoDoTrajeto[][]): Xy[][] => t.map((l) => l.map((q) => xy.get(q)!));
  const marca = (i: number): PontoDesenhado => ({ ...linha[i]!, hora: formatarHoraDoTrajeto(ordem[i]!.capturado_em, o.fuso) });
  return { vazio: false, linha, primeiro: marca(0), ultimo: marca(ordem.length - 1), total: ordem.length, solidos: naTela(trechos.solidos), tracejados: naTela(trechos.tracejados) };
}
