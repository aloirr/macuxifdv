/** Pontos extras e material de PDV: negociados × encontrados (RF-PRO-08). */
import { percentual } from './numeros';

export const TIPOS_PONTO_EXTRA = ['ponta_gondola', 'ilha', 'display', 'cartaz', 'checkout', 'outro'] as const;
export type TipoPontoExtra = (typeof TIPOS_PONTO_EXTRA)[number];

export type SituacaoPontoExtra = 'cumprido' | 'parcial' | 'nao_cumprido';

export interface ConferenciaPontoExtra {
  /** Existe na loja? */
  existe: boolean;
  /** Está no lugar combinado? */
  no_lugar: boolean;
  /** Está abastecido? */
  abastecido: boolean;
}

/** RF-PRO-08: cumprido = existe, no lugar e abastecido; parcial = existe mas falta algo; não cumprido = não existe. */
export function conferirPontoExtra(c: ConferenciaPontoExtra): { situacao: SituacaoPontoExtra; erros: string[] } {
  const erros: string[] = [];
  if (!c.existe) {
    if (c.no_lugar || c.abastecido) erros.push('O ponto extra não existe na loja: desmarque "no lugar combinado" e "abastecido".');
    return { situacao: 'nao_cumprido', erros };
  }
  return { situacao: c.no_lugar && c.abastecido ? 'cumprido' : 'parcial', erros };
}

export interface ItemPontoExtra extends ConferenciaPontoExtra {
  /** `true` = estava negociado com a loja (conferência); `false` = encontrado sem negociação. */
  negociado: boolean;
}

export interface ResumoPontosExtras {
  negociados: number;
  cumpridos: number;
  parciais: number;
  nao_cumpridos: number;
  /** cumpridos ÷ negociados × 100 */
  cumprimento_pct: number | null;
  /** Pontos que existem na loja sem terem sido negociados (contados à parte). */
  encontrados_nao_negociados: number;
}

export function resumirPontosExtras(itens: readonly ItemPontoExtra[]): ResumoPontosExtras {
  const negociados = itens.filter((i) => i.negociado);
  const situacoes = negociados.map((i) => conferirPontoExtra(i).situacao);
  const cumpridos = situacoes.filter((s) => s === 'cumprido').length;
  return {
    negociados: negociados.length,
    cumpridos,
    parciais: situacoes.filter((s) => s === 'parcial').length,
    nao_cumpridos: situacoes.filter((s) => s === 'nao_cumprido').length,
    cumprimento_pct: percentual(cumpridos, negociados.length),
    encontrados_nao_negociados: itens.filter((i) => !i.negociado && i.existe).length,
  };
}
