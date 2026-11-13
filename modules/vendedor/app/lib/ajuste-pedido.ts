/**
 * RN-VEN-02 (T-0137, T-0165): o texto do campo de desconto/acréscimo (item e Desc./Acrésc. geral) e o número que ele vale. Funções puras.
 * Não existe mais desconto do pedido: o ajuste fica sempre no item. O cálculo e a alçada continuam em `lib/novo-pedido` e no domain.
 */
import { lerDecimal } from '@macuxi/ui/mobile/puro';

import { centsParaCampo, type TipoDoAjuste } from './novo-pedido';

/** Texto do campo para o tipo e o valor: % com até 2 casas, R$ com 2 casas. Zero = vazio. */
export function textoDoAjuste(tipo: TipoDoAjuste, valor: number): string {
  if (!(valor > 0)) return '';
  return tipo.endsWith('reais') ? centsParaCampo(valor) : valor.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2, useGrouping: false });
}

/** O número que o texto digitado representa para o tipo (% até 100, ou centavos); vazio ou inválido = 0. */
export function valorDoTexto(tipo: TipoDoAjuste, texto: string): number {
  const n = lerDecimal(texto);
  if (n === null || n < 0) return 0;
  return tipo.endsWith('reais') ? Math.round(n * 100) : Math.min(100, Math.round(n * 100) / 100);
}
