/**
 * Streak: dias consecutivos com atividade (lição concluída ou tentativa de quiz), no fuso do tenant
 * (RF-TRE-03, RN-TRE-01). Instantes em UTC; o "dia" é a data civil no fuso.
 */
import { diffDays, localDate } from '@macuxi/comum';
import { PARAMETROS_PADRAO } from './parametros';

/** Datas civis distintas e ordenadas em que houve atividade. */
export function diasComAtividade(instantes: readonly string[], fuso: string = PARAMETROS_PADRAO.fuso): string[] {
  return [...new Set(instantes.map((i) => localDate(new Date(i), fuso)))].sort();
}

/** Dias consecutivos terminando em `data` (0 se `data` não teve atividade). */
export function sequenciaNaData(dias: readonly string[], data: string): number {
  const conjunto = new Set(dias);
  if (!conjunto.has(data)) return 0;
  const ordenados = [...conjunto].sort();
  let n = 1;
  for (let i = ordenados.indexOf(data) - 1; i >= 0 && diffDays(ordenados[i]!, ordenados[i + 1]!) === 1; i--) n++;
  return n;
}

export interface SequenciaAtual {
  dias: number;
  ativa_hoje: boolean;
  /** Tem sequência mas ainda não treinou hoje: se não treinar, ela zera amanhã. */
  em_risco: boolean;
}

/** Sequência vigente em `hoje`: termina hoje, ou ontem (ainda dá tempo de manter). */
export function sequenciaAtual(dias: readonly string[], hoje: string): SequenciaAtual {
  const conjunto = new Set(dias);
  if (conjunto.has(hoje)) return { dias: sequenciaNaData(dias, hoje), ativa_hoje: true, em_risco: false };
  const ontem = [...conjunto].sort().filter((d) => diffDays(d, hoje) === 1)[0];
  if (ontem) return { dias: sequenciaNaData(dias, ontem), ativa_hoje: false, em_risco: true };
  return { dias: 0, ativa_hoje: false, em_risco: false };
}

/** Maior sequência já alcançada (base da medalha de sequência). */
export function maiorSequencia(dias: readonly string[]): number {
  const ordenados = [...new Set(dias)].sort();
  let maior = 0;
  let atual = 0;
  ordenados.forEach((d, i) => {
    atual = i > 0 && diffDays(ordenados[i - 1]!, d) === 1 ? atual + 1 : 1;
    maior = Math.max(maior, atual);
  });
  return maior;
}
