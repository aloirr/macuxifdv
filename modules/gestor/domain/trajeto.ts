/**
 * Trajeto do dia da equipe no mapa do Gestor (T-0156; docs/desenho/tracking.md §9). Função pura: o aparelho e o navegador
 * desenham a linha com estas coordenadas de tela; nenhum provedor de mapa recebe o trajeto (nem pelo servidor).
 * RN-CORE-13: sem pontos (tracking desligado de fábrica, sem termo ou fora do expediente) o resultado é `vazio`.
 * A coordenada nunca vai para log nem para mensagem de erro (§9): este módulo não registra nada.
 */
import { formatHHMM } from '@macuxi/comum/fuso';
import { projetarPontos, type PontoDoTrajeto } from '@macuxi/core/contracts';

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
}
export interface OpcoesDesenho {
  largura: number;
  altura: number;
  margem: number;
  /** Fuso IANA do tenant, só para a hora exibida. */
  fuso: string;
}

/**
 * Ordena por `capturado_em`, projeta e marca as horas com as funções do Core (`projetarPontos`): a mesma projeção
 * do Core. Sem pausa (RN-CORE-13) não há trecho tracejado: a linha é uma só, sólida.
 */
export function desenharTrajeto(pontos: readonly PontoDoTrajeto[], o: OpcoesDesenho): TrajetoDesenhado {
  if (pontos.length === 0) return { vazio: true, linha: [], primeiro: null, ultimo: null, total: 0 };
  const ordem = [...pontos].sort((a, b) => Date.parse(a.capturado_em) - Date.parse(b.capturado_em));
  const linha = projetarPontos(ordem, o.largura, o.altura, o.margem);
  const marca = (i: number): PontoDesenhado => ({ ...linha[i]!, hora: formatHHMM(ordem[i]!.capturado_em, o.fuso) });
  return { vazio: false, linha, primeiro: marca(0), ultimo: marca(ordem.length - 1), total: ordem.length };
}
