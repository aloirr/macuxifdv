/**
 * Quantidade do item na tela (RN-VEN-02 v3, ADR 0076): a fração (até 4 casas, vírgula) só vale em KG e M e só com a trava
 * liberada (D6). A digitação é do `Passo` decimal do kit; aqui fica o que entra no pedido.
 */
import { truncarCasas, unidadeFracionaria } from '@macuxi/comum/quantidade';

/** Aviso do campo quando a pessoa digita a vírgula com a trava fechada (KG e M ficam inteiros). */
export const MENSAGEM_SO_INTEIRO = 'Só quantidade inteira.';

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

/** Quantidade ao trocar a embalagem na folha do item: trunca nas casas da nova medida e respeita o mínimo dela (1,25 kg vira 1 em CX; 0,5 kg vira 1). */
export function quantidadeAoTrocarMedida(qtd: number, unidade: string | null | undefined, liberada: boolean): number {
  const { min, decimal } = propsDoPassoDaQuantidade(unidade, liberada);
  return Math.max(truncarCasas(qtd, decimal.casas), min);
}

/** O botão da folha confirma quando a quantidade chega ao mínimo da medida (0,5 kg vale com a trava aberta). */
export function quantidadeConfirmavel(qtd: number, unidade: string | null | undefined, liberada: boolean): boolean {
  return qtd >= propsDoPassoDaQuantidade(unidade, liberada).min;
}
