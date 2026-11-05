/**
 * Uma linha por produto na aba Itens (T-0071, V4): o chip da medida no alto à direita mostra a medida em uso e, tocado, troca
 * a medida da linha mantendo a quantidade digitada (RN-CORE-19). A segunda medida só aparece quando as duas têm quantidade.
 */
import type { Ajuste } from './novo-pedido';

/** Posições (na lista de medidas) que aparecem como linha: as com quantidade; sem nenhuma, só a escolhida (padrão: a principal). */
export function medidasVisiveis(quantidades: readonly number[], escolhida: number | null): number[] {
  const com = quantidades.flatMap((q, i) => (q > 0 ? [i] : []));
  if (com.length > 0) return com;
  return [Math.min(escolhida ?? 0, Math.max(0, quantidades.length - 1))];
}

/** A próxima medida do produto (a lista é circular). */
export function proximaMedida(atual: number, total: number): number {
  return total <= 1 ? 0 : (atual + 1) % total;
}

/**
 * Passa a quantidade da linha `de` para a linha `para`. O ajuste em % vai junto; o de R$ é por unidade da medida e não vale
 * na outra, então sai (a pessoa digita de novo).
 */
export function trocarMedidaDaLinha(lines: Record<string, number>, ajustes: Record<string, Ajuste>, de: string, para: string): { lines: Record<string, number>; ajustes: Record<string, Ajuste> } {
  const novasLinhas = { ...lines };
  const novosAjustes = { ...ajustes };
  const q = novasLinhas[de] ?? 0;
  delete novasLinhas[de];
  const aj = novosAjustes[de];
  delete novosAjustes[de];
  if (q > 0) {
    novasLinhas[para] = q;
    if (aj && aj.em !== 'valor') novosAjustes[para] = aj;
  }
  return { lines: novasLinhas, ajustes: novosAjustes };
}
