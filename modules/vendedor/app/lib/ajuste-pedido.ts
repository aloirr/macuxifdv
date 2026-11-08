/**
 * RF-VEN-11 / RN-VEN-02 (T-0137): o desconto/acréscimo do pedido numa linha só (`DescontoCompacto`, o mesmo do item). Função
 * pura: traduz o rascunho (modo % ou R$ e sentido) para o tipo do kit (Desc %, Desc R$, Acrésc %, Acrésc R$) e de volta.
 * O cálculo e a alçada continuam em `lib/novo-pedido` e no domain; aqui só o campo.
 */
import { lerDecimal, type ValorEquivalente } from '@macuxi/ui/mobile/puro';

import { centsParaCampo, trocarModoDoAjuste, type TipoDoAjuste } from './novo-pedido';
import { aplicarAjusteDoPedido, type Rascunho } from './pedidos';

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

export interface AjusteDoPedido {
  tipo: TipoDoAjuste;
  /** % (como digitado) ou centavos */
  valor: number;
}

/** O que o rascunho guarda como ajuste do pedido. Sem valor, lê o modo e fica em desconto. */
export function ajusteDoPedidoDoRascunho(r: Pick<Rascunho, 'ajuste_em' | 'discount_pct' | 'acrescimo_pct' | 'desconto_valor_cents' | 'acrescimo_valor_cents'>): AjusteDoPedido {
  const reais = r.ajuste_em === 'valor';
  const acrescimo = reais ? (r.acrescimo_valor_cents ?? 0) > 0 : (r.acrescimo_pct ?? 0) > 0;
  const tipo = `${acrescimo ? 'acresc' : 'desc'}_${reais ? 'reais' : 'pct'}` as TipoDoAjuste;
  const valor = reais ? (acrescimo ? (r.acrescimo_valor_cents ?? 0) : (r.desconto_valor_cents ?? 0)) : acrescimo ? (r.acrescimo_pct ?? 0) : r.discount_pct;
  return { tipo, valor };
}

const modoDoTipo = (t: TipoDoAjuste): 'pct' | 'valor' => (t.endsWith('reais') ? 'valor' : 'pct');
const sentidoDoTipo = (t: TipoDoAjuste): 'desconto' | 'acrescimo' => (t.startsWith('acresc') ? 'acrescimo' : 'desconto');

/** Digitou o valor no tipo mostrado: grava o ajuste (vale na hora, RN-VEN-02). `tetoReais` limita o R$ ao total dos itens. */
export function rascunhoComTextoDoPedido(r: Rascunho, tipo: TipoDoAjuste, texto: string, tetoReais?: number): Rascunho {
  const n = valorDoTexto(tipo, texto);
  const v = tipo.endsWith('reais') && tetoReais !== undefined ? Math.min(tetoReais, n) : n;
  return aplicarAjusteDoPedido(r, { modo: modoDoTipo(tipo), sentido: sentidoDoTipo(tipo), valor: v });
}

/**
 * Trocou o tipo com valor: o domain converte pelo equivalente (% ↔ R$), como no item. Só o sentido (desconto ↔ acréscimo)
 * mantém o número. Sem valor, a tela só guarda o tipo escolhido e nada muda no rascunho.
 */
export function rascunhoComTipoDoPedido(r: Rascunho, novo: TipoDoAjuste, equivalente: ValorEquivalente | null): Rascunho {
  const atual = ajusteDoPedidoDoRascunho(r);
  if (!(atual.valor > 0)) return r;
  const modoNovo = modoDoTipo(novo);
  let valor = atual.valor;
  if (modoDoTipo(atual.tipo) !== modoNovo) {
    const sentidoAtual = sentidoDoTipo(atual.tipo);
    const base: Parameters<typeof trocarModoDoAjuste>[0] =
      modoDoTipo(atual.tipo) === 'valor'
        ? { em: 'valor', desconto_cents: sentidoAtual === 'desconto' ? atual.valor : 0, acrescimo_cents: sentidoAtual === 'acrescimo' ? atual.valor : 0 }
        : { em: 'pct', desconto_pct: sentidoAtual === 'desconto' ? atual.valor : 0, acrescimo_pct: sentidoAtual === 'acrescimo' ? atual.valor : 0 };
    const c = trocarModoDoAjuste(base, modoNovo, equivalente ? { cents: equivalente.cents, pct_exibicao: equivalente.pct } : null);
    valor = modoNovo === 'valor' ? (sentidoAtual === 'acrescimo' ? (c.acrescimo_cents ?? 0) : (c.desconto_cents ?? 0)) : sentidoAtual === 'acrescimo' ? (c.acrescimo_pct ?? 0) : (c.desconto_pct ?? 0);
  }
  return aplicarAjusteDoPedido(r, { modo: modoNovo, sentido: sentidoDoTipo(novo), valor });
}
