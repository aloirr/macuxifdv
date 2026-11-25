/**
 * Quantidade do item na tela (RN-VEN-02 v3, ADR 0076): a fração (até 4 casas, vírgula) só vale em KG e M e só com a trava
 * liberada (D6). A digitação é do `Passo` decimal do kit; aqui fica o que entra no pedido.
 */
import { truncarCasas, unidadeFracionaria } from '@macuxi/comum/quantidade';

/** Aviso do campo quando a pessoa digita a vírgula com a trava fechada (KG e M ficam inteiros). */
export const MENSAGEM_SO_INTEIRO = 'Só quantidade inteira por enquanto.';

/** Quantidade que fica no pedido: com fração só em KG/M com a trava aberta; senão, o inteiro. */
export function quantidadeDoItem(q: number, unidade: string | null | undefined, liberada: boolean): number {
  if (unidadeFracionaria(unidade) && liberada) return truncarCasas(q);
  return Math.trunc(q);
}

/** Props do `Passo` da quantidade: mínimo 0,0001 e 4 casas só em KG/M com a trava aberta; senão mínimo 1 e inteiro (o "−" não passa de 1). */
export function propsDoPassoDaQuantidade(
  unidade: string | null | undefined,
  liberada: boolean,
): { min: number; decimal: { casas: number; avisoSemCasas: string } } {
  const fracao = unidadeFracionaria(unidade) && liberada;
  return { min: fracao ? 0.0001 : 1, decimal: { casas: fracao ? 4 : 0, avisoSemCasas: MENSAGEM_SO_INTEIRO } };
}
