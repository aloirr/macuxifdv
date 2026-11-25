/**
 * Limites de digitação do pedido (quantidade, desconto) e condição de envio. Puro, sem React.
 * RN-VEN-04: a quantidade não passa do estoque do produto. RN-VEN-10: o desconto é um percentual de 0 a 100.
 */

import { CODIGO_FRACAO_BLOQUEADA, CODIGO_FRACAO_INVALIDA, MENSAGEM_FRACAO_BLOQUEADA } from '@macuxi/platform-sdk';
import { ESCALA_QUANTIDADE, quantidadeDaEscala, quantidadeEmEscala, unidadeFracionaria } from '@macuxi/comum/quantidade';

/**
 * RN-VEN-15 (ADR 0076): o fator (unidades base por embalagem) é > 0 com até 4 casas. Fonte única: o preço do item e o do pedido
 * usam esta função.
 */
export function exigirFator(fator: number): void {
  if (!(fator > 0) || !emEscalaValida(fator)) throw new Error('RN-VEN-15: fator da unidade inválido.');
}

function emEscalaValida(n: number): boolean {
  try {
    quantidadeEmEscala(n);
    return true;
  } catch {
    return false;
  }
}

/**
 * RN-VEN-02 v3: a quantidade é > 0 com até 4 casas; a fração só vale em KG e M; quantidade e fator nunca são fracionários no
 * mesmo item. Lança `Error` com `codigo` = `quantidade_fracionaria_invalida` (a API devolve 422).
 */
export function exigirQuantidade(i: { quantidade: number; unidade: string | null; fator: number }): void {
  const recusa = (): never => {
    throw Object.assign(new Error(`${CODIGO_FRACAO_INVALIDA}: RN-VEN-02: quantidade inválida para a unidade.`), { codigo: CODIGO_FRACAO_INVALIDA });
  };
  if (!(i.quantidade > 0) || !emEscalaValida(i.quantidade) || !emEscalaValida(i.fator)) return recusa();
  const qFrac = quantidadeEmEscala(i.quantidade) % ESCALA_QUANTIDADE !== 0;
  const fFrac = quantidadeEmEscala(i.fator) % ESCALA_QUANTIDADE !== 0;
  if (qFrac && (!unidadeFracionaria(i.unidade) || fFrac)) return recusa();
}

/** Algum item tem quantidade ou fator com casas decimais? Valor fora das 4 casas não conta (a recusa `exigirQuantidade` o pega). */
export function haFracao(itens: ReadonlyArray<{ quantidade: number; fator: number }>): boolean {
  const frac = (n: number): boolean => emEscalaValida(n) && quantidadeEmEscala(n) % ESCALA_QUANTIDADE !== 0;
  return itens.some((i) => frac(i.quantidade) || frac(i.fator));
}

/**
 * RN-VEN-02 v3 + ADR 0076 D6: a recusa (422) do pedido ou orçamento com quantidade fracionária. Primeiro a regra (`exigirQuantidade`:
 * fração só em KG/M, até 4 casas, nunca com fator fracionário); depois a trava: com `liberada` falso (as duas variantes 1.0.35 ainda
 * não obrigatórias), qualquer item com quantidade ou fator fracionário é recusado. Sem fração, `null`.
 */
export function recusaDeFracao(itens: ReadonlyArray<{ quantidade: number; unidade: string | null; fator: number }>, liberada: boolean): { codigo: string; http: number; mensagem: string } | null {
  for (const i of itens) {
    try {
      exigirQuantidade(i);
    } catch {
      return { codigo: CODIGO_FRACAO_INVALIDA, http: 422, mensagem: 'Quantidade com casas decimais só em KG e M, com até 4 casas. Ajuste a quantidade e envie de novo.' };
    }
  }
  if (!liberada && haFracao(itens)) {
    return { codigo: CODIGO_FRACAO_BLOQUEADA, http: 422, mensagem: MENSAGEM_FRACAO_BLOQUEADA };
  }
  return null;
}

/** Soma de quantidades sem float (ADR 0076): faz a conta no inteiro de 1/10.000. */
export function somarQuantidades(a: number, b: number): number {
  return quantidadeDaEscala(quantidadeEmEscala(a) + quantidadeEmEscala(b));
}

/** Diferença `a − b` de quantidades sem float (ADR 0076). */
export function subtrairQuantidades(a: number, b: number): number {
  return quantidadeDaEscala(quantidadeEmEscala(a) - quantidadeEmEscala(b));
}

/**
 * RN-VEN-04: quantidade de 0 até o estoque. Em KG/M trunca em 4 casas; nas demais unidades (ou sem unidade) trunca no inteiro.
 */
export function quantidadePermitida(estoque: number, quantidade: number, unidade?: string | null): number {
  if (!unidadeFracionaria(unidade)) {
    const max = Math.max(0, Math.trunc(estoque));
    return Math.max(0, Math.min(max, Math.trunc(quantidade)));
  }
  const trunca = (n: number): number => Math.trunc(Number((n * ESCALA_QUANTIDADE).toFixed(6))) / ESCALA_QUANTIDADE;
  return Math.max(0, Math.min(trunca(Math.max(0, estoque)), trunca(quantidade)));
}

/** Percentual de desconto limitado a 0..100 com 2 casas. */
export function limitarDesconto(pct: number): number {
  return Math.max(0, Math.min(100, Math.round(pct * 100) / 100));
}

/** Passo dos botões de desconto (+/-), em pontos percentuais. */
export const PASSO_DESCONTO_PCT = 0.5;

/** O botão Enviar liga quando há itens, o pedido não foi recusado e, na edição de pedido já enviado, há sinal e permissão. */
export function podeEnviarPedido(o: { jaEnviado: boolean; itens: number; recusado: boolean; edicaoSemSinal: boolean; edicao: boolean; podeEditar: boolean }): boolean {
  return !o.jaEnviado && o.itens > 0 && !o.recusado && !o.edicaoSemSinal && (!o.edicao || o.podeEditar);
}
