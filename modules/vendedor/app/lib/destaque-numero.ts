/**
 * Y11 (T-0101, revisão de UX R-20261104-200745): trechos do número do pedido a destacar na lista de Pedidos.
 * O `casaComBusca` do domain acha "0042" em "42" ou "10042" (número sem zeros à esquerda); aqui o destaque acompanha
 * o mesmo critério. Busca não numérica (nome, razão) nunca destaca o número. Puro, sem React.
 */
import { destacarTrecho, numeroSemZeros, type TrechoDoTexto } from '../../domain/busca-periodo';

export function trechosDoNumero(numero: string, busca: string): TrechoDoTexto[] {
  const q = busca.trim();
  if (q === '' || !/^\d+$/.test(q)) return [{ texto: numero, destaque: false }];
  const direto = destacarTrecho(numero, q);
  if (direto.some((p) => p.destaque)) return direto;
  const semZeros = numeroSemZeros(q);
  if (semZeros === q) return direto;
  return destacarTrecho(numero, semZeros);
}
