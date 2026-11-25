/**
 * Quantidade do item na tela (RN-VEN-02 v3, ADR 0076): o que a pessoa digita vira número sem conta em float; a fração (até 4
 * casas, vírgula) só vale em KG e M e só com a trava liberada (D6). Nas demais unidades, o teclado e o valor são inteiros.
 */
import { formatarQuantidade, unidadeFracionaria } from '@macuxi/comum/quantidade';

import { somarQuantidades } from '../../domain/quantidade';

export const QUANTIDADE_MAX = 999_999;
const CASAS = 4;

/** Mensagem curta quando a pessoa tenta a vírgula com a trava fechada (KG e M ficam inteiros). */
export const MENSAGEM_SO_INTEIRO = 'Só quantidade inteira por enquanto.';

// Trava guardada do aparelho (ADR 0076 D6): o shell a atualiza com as respostas guardadas de GET /v1/app/versao.
let fracaoLiberada = false;

/** O shell informa se a fração está liberada (`fracaoLiberada` do `@macuxi/platform-sdk`, sobre as versões guardadas). */
export function definirFracaoLiberada(liberada: boolean): void {
  fracaoLiberada = liberada;
}

/** Fechada até o shell liberar (sem resposta guardada = fechada). */
export function fracaoLiberadaNoAparelho(): boolean {
  return fracaoLiberada;
}

/** KG e M abrem o teclado com vírgula; as demais unidades, o numérico inteiro. */
export function tecladoDaQuantidade(unidade: string | null | undefined): 'decimal-pad' | 'number-pad' {
  return unidadeFracionaria(unidade) ? 'decimal-pad' : 'number-pad';
}

/**
 * Lê o texto do campo. `valor` nulo = ainda não é número (vazio ou "," sozinha). Casas além da quarta são cortadas, sem arredondar.
 * Sem KG/M ou com a trava fechada só vale a parte inteira; `so_inteiro` avisa que a pessoa tentou a vírgula em KG/M com a trava fechada.
 */
export function lerQuantidadeDigitada(texto: string, unidade: string | null | undefined, liberada: boolean): { valor: number | null; so_inteiro: boolean } {
  const limpo = texto.replace(/[^\d.,]/g, '');
  const sep = limpo.search(/[.,]/);
  const inteiro = (sep < 0 ? limpo : limpo.slice(0, sep)).replace(/\D/g, '');
  const fracao = sep < 0 ? '' : limpo.slice(sep + 1).replace(/\D/g, '').slice(0, CASAS);
  const fracionaria = unidadeFracionaria(unidade);
  const tentou = fracionaria && !liberada && sep >= 0;
  if (inteiro === '' && fracao === '') return { valor: null, so_inteiro: tentou };
  const n = Math.min(Number(inteiro === '' ? '0' : inteiro), QUANTIDADE_MAX);
  if (!fracionaria || !liberada || n >= QUANTIDADE_MAX || fracao === '') return { valor: n, so_inteiro: tentou };
  return { valor: Number(`${n}.${fracao}`), so_inteiro: false };
}

/** Quantidade que fica no pedido: com fração só em KG/M com a trava aberta; senão, o inteiro. */
export function quantidadeDoItem(q: number, unidade: string | null | undefined, liberada: boolean): number {
  if (unidadeFracionaria(unidade) && liberada) return Math.trunc(Number((q * 10 ** CASAS).toFixed(6))) / 10 ** CASAS;
  return Math.trunc(q);
}

/** Toque no + (delta 1) ou no − (delta −1), sem float; o − nunca leva a zero ou menos (a quantidade fica como está). */
export function passoDaQuantidade(q: number, delta: 1 | -1): number {
  const novo = somarQuantidades(q, delta);
  return novo > 0 && novo <= QUANTIDADE_MAX ? novo : q;
}

/** Texto do campo ao editar: vírgula e sem zeros à direita (`1,25`, `3`). */
export function textoDaQuantidade(q: number): string {
  return String(q).replace('.', ',');
}

/** Quantidade na tela e no PDF: `1,250 kg` em KG/M; nas demais, o inteiro com a sigla (`12 CX`). */
export function textoDaQuantidadeNaTela(q: number, unidade: string | null): string {
  return formatarQuantidade(q, unidade);
}
