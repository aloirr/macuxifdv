/**
 * Valor pendente dos campos numéricos do novo pedido (T-0071, V2): o que está digitado vale já no primeiro toque seguinte
 * (Avançar, trocar de aba, Salvar, +/−, chip de medida), sem fechar o teclado antes. Cada função devolve o valor que o
 * texto atual representa, já limitado ao teto, ou `null` quando ainda não representa número (campo vazio ou "," sozinha):
 * nesse caso nada é gravado e o item não some enquanto a pessoa digita. Ao sair do campo vazio, vale 0.
 */
import { limitarDesconto } from '../../domain/quantidade';
import { reaisParaCents } from './novo-pedido';

/** Quantidade: só dígitos; vazio = ainda não digitou. */
export function valorPendenteQuantidade(texto: string): number | null {
  const d = texto.replace(/\D/g, '');
  if (d === '') return null;
  return Math.min(Number(d), 999_999);
}

/** Percentual com vírgula ou ponto ("5," vale 5; "1,5" vale 1,5), limitado a 0..`maximo` com 2 casas. */
export function valorPendentePct(texto: string, maximo = 100): number | null {
  const limpo = texto.replace('%', '').trim();
  if (limpo === '') return null;
  const n = Number(limpo.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(maximo, limitarDesconto(n));
}

/** Reais em centavos, limitado a `maximo` (o desconto não passa do preço). */
export function valorPendenteReais(texto: string, maximo?: number): number | null {
  if (texto.replace(/\D/g, '') === '') return null;
  const c = reaisParaCents(texto);
  return maximo === undefined ? c : Math.min(maximo, c);
}

/**
 * Texto do campo quando o valor gravado muda. Com foco, o que foi digitado fica enquanto vale o mesmo que o valor (a vírgula
 * de "5," não some e o "150" limitado a 100 só é corrigido ao sair); se o valor mudou por fora (+/−, troca de modo), vale o formatado.
 */
export function textoAposMudancaDoValor(e: { texto: string; valor: number; focado: boolean; pendente: (texto: string) => number | null; formatar: (n: number) => string }): string {
  if (!e.focado) return e.formatar(e.valor);
  const p = e.pendente(e.texto);
  if (p === null || p === e.valor) return e.texto;
  return e.formatar(e.valor);
}

/** Quantidade a gravar enquanto digita: zero ou vazio não tira o item (só ao sair do campo ou pelo botão −). */
export function quantidadeAoDigitar(texto: string): number | null {
  const n = valorPendenteQuantidade(texto);
  return n !== null && n > 0 ? n : null;
}

/**
 * Quantidade a gravar ao confirmar (Salvar, Avançar, trocar de aba, +/−, sair do campo): "0" ou campo vazio tira o item
 * (0); um número válido grava. É o complemento de `quantidadeAoDigitar`, que durante a digitação ignora o zero (W1).
 */
export function quantidadeAoConfirmar(texto: string): number {
  return valorPendenteQuantidade(texto) ?? 0;
}

/** Base do passo +/−: com o campo em foco vale o que está digitado ("0" + 1 = 1); sem foco, a quantidade gravada. */
export function quantidadeBaseDoPasso(e: { texto: string; focado: boolean; qtd: number }): number {
  return e.focado ? quantidadeAoConfirmar(e.texto) : e.qtd;
}

/** Quantidade depois de um toque no − (delta -1) ou no + (delta 1): parte da base do passo e nunca fica abaixo de zero. */
export function quantidadePorPasso(e: { texto: string; focado: boolean; qtd: number }, delta: number): number {
  return Math.max(0, Math.min(999_999, quantidadeBaseDoPasso(e) + delta));
}

// Registro do campo em foco: quem confirma a tela (Salvar, Avançar, aba) aplica o valor pendente antes de seguir.
let pendente: (() => void) | null = null;

/** O campo em foco registra como aplicar o que está digitado; devolve a função que desfaz o registro (no blur/desmonte). */
export function registrarValorPendente(aplicar: () => void): () => void {
  pendente = aplicar;
  return () => {
    if (pendente === aplicar) pendente = null;
  };
}

/** Aplica o valor pendente do campo em foco, se houver. Devolve `true` quando havia um campo pendente. */
export function aplicarValorPendente(): boolean {
  const f = pendente;
  if (!f) return false;
  f();
  return true;
}
