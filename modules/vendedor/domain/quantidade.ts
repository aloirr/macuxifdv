/**
 * Limites de digitação do pedido (quantidade, desconto) e condição de envio. Puro, sem React.
 * RN-VEN-04: a quantidade não passa do estoque do produto. RN-VEN-10: o desconto é um percentual de 0 a 100.
 */

import { CODIGO_FRACAO_BLOQUEADA, CODIGO_FRACAO_INVALIDA, MENSAGEM_FRACAO_BLOQUEADA } from '@macuxi/platform-sdk';
import { ESCALA_QUANTIDADE, quantidadeValida, temFracao, unidadeFracionaria } from '@macuxi/comum/quantidade';

/**
 * RN-VEN-15 (ADR 0076): o fator (unidades base por embalagem) é > 0 com até 4 casas. Fonte única: o preço do item e o do pedido
 * usam esta função.
 */
export function exigirFator(fator: number): void {
  if (!(fator > 0) || !quantidadeValida(fator)) throw new Error('RN-VEN-15: fator da unidade inválido.');
}

/**
 * RN-VEN-02 v3: a quantidade é > 0 com até 4 casas; a fração só vale em KG e M; quantidade e fator nunca são fracionários no
 * mesmo item. Lança `Error` com `codigo` = `quantidade_fracionaria_invalida` (a API devolve 422).
 */
export function exigirQuantidade(i: { quantidade: number; unidade: string | null; fator: number }): void {
  const recusa = (): never => {
    throw Object.assign(new Error(`${CODIGO_FRACAO_INVALIDA}: RN-VEN-02: quantidade inválida para a unidade.`), { codigo: CODIGO_FRACAO_INVALIDA });
  };
  if (!(i.quantidade > 0) || !quantidadeValida(i.quantidade) || !quantidadeValida(i.fator)) return recusa();
  const qFrac = temFracao(i.quantidade);
  const fFrac = temFracao(i.fator);
  if (qFrac && (!unidadeFracionaria(i.unidade) || fFrac)) return recusa();
}

/** Algum item tem quantidade ou fator com casas decimais? Valor fora das 4 casas não conta (a recusa `exigirQuantidade` o pega). */
export function haFracao(itens: ReadonlyArray<{ quantidade: number; fator: number }>): boolean {
  const frac = (n: number): boolean => quantidadeValida(n) && temFracao(n);
  return itens.some((i) => frac(i.quantidade) || frac(i.fator));
}

/** Texto único da recusa `quantidade_fracionaria_invalida` (pedido, orçamento e aprovação). */
export const MENSAGEM_FRACAO_INVALIDA_PEDIDO = 'Quantidade com casas decimais só em KG e M, com até 4 casas. Ajuste a quantidade.';

/**
 * RN-VEN-02 v3 + ADR 0076 D6: a recusa (422) do pedido ou orçamento com quantidade fracionária. Primeiro a regra (`exigirQuantidade`:
 * fração só em KG/M, até 4 casas, nunca com fator fracionário); depois a trava: com `liberada` falso (as duas variantes na `VERSAO_APP_FRACAO` ainda
 * não obrigatórias), qualquer item com quantidade ou fator fracionário é recusado. Sem fração, `null`.
 */
export function recusaDeFracao(itens: ReadonlyArray<{ quantidade: number; unidade: string | null; fator: number }>, liberada: boolean): { codigo: string; http: number; mensagem: string } | null {
  for (const i of itens) {
    try {
      exigirQuantidade(i);
    } catch {
      return { codigo: CODIGO_FRACAO_INVALIDA, http: 422, mensagem: MENSAGEM_FRACAO_INVALIDA_PEDIDO };
    }
  }
  if (!liberada && haFracao(itens)) {
    return { codigo: CODIGO_FRACAO_BLOQUEADA, http: 422, mensagem: MENSAGEM_FRACAO_BLOQUEADA };
  }
  return null;
}

/** Trunca em 4 casas (nunca arredonda) sem o erro do float: `0,29 × 10.000` vira 2.900, não 2.899. */
export function truncarEm4Casas(n: number): number {
  return Math.trunc(Number((n * ESCALA_QUANTIDADE).toFixed(6))) / ESCALA_QUANTIDADE;
}

/**
 * RN-VEN-04: quantidade de 0 até o estoque. Em KG/M trunca em 4 casas; nas demais unidades (ou sem unidade) trunca no inteiro.
 */
export function quantidadePermitida(estoque: number, quantidade: number, unidade?: string | null): number {
  if (!unidadeFracionaria(unidade)) {
    const max = Math.max(0, Math.trunc(estoque));
    return Math.max(0, Math.min(max, Math.trunc(quantidade)));
  }
  return Math.max(0, Math.min(truncarEm4Casas(Math.max(0, estoque)), truncarEm4Casas(quantidade)));
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
