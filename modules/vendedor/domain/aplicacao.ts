/**
 * RN-VEN-19 — aplicação do produto no item do orçamento e do pedido. Puro, sem I/O.
 * O texto é RETRATO: gravado no momento do pedido, nunca trocado pelo cadastro depois.
 */

export const APLICACAO_MAX_ORCAMENTO_PADRAO = 300;
export const APLICACAO_MAX_ORCAMENTO_MIN = 50;
export const APLICACAO_MAX_ORCAMENTO_TETO = 1000;
export const PARAMETRO_APLICACAO_MAX_ORCAMENTO = 'aplicacao_max_orcamento';
export const PARAMETRO_APLICACAO_NO_ORCAMENTO_PADRAO = 'aplicacao_no_orcamento_padrao';
export const PARAMETRO_REFERENCIA_NO_ORCAMENTO = 'referencia_no_orcamento';

/** `aplicacao_max_orcamento` do tenant (50..1.000; fora da faixa ou inválido = 300). */
export function aplicacaoMaxOrcamento(parametros: Readonly<Record<string, unknown>>): number {
  const bruto = parametros[PARAMETRO_APLICACAO_MAX_ORCAMENTO];
  const n = typeof bruto === 'number' ? bruto : typeof bruto === 'string' && bruto.trim() !== '' ? Number(bruto) : NaN;
  return Number.isInteger(n) && n >= APLICACAO_MAX_ORCAMENTO_MIN && n <= APLICACAO_MAX_ORCAMENTO_TETO ? n : APLICACAO_MAX_ORCAMENTO_PADRAO;
}

function booleano(bruto: unknown, padrao: boolean): boolean {
  if (typeof bruto === 'boolean') return bruto;
  if (typeof bruto === 'string') {
    const s = bruto.trim().toLowerCase();
    if (['true', 'sim', '1', 'on'].includes(s)) return true;
    if (['false', 'nao', 'não', '0', 'off'].includes(s)) return false;
  }
  return padrao;
}

/** `aplicacao_no_orcamento_padrao` (padrão sim): a caixa do item já vem marcada. */
export function aplicacaoNoOrcamentoPadrao(parametros: Readonly<Record<string, unknown>>): boolean {
  return booleano(parametros[PARAMETRO_APLICACAO_NO_ORCAMENTO_PADRAO], true);
}

/** `referencia_no_orcamento` (padrão não, RN-CAT-10): a referência cruzada sai no PDF do cliente. */
export function referenciaNoOrcamento(parametros: Readonly<Record<string, unknown>>): boolean {
  return booleano(parametros[PARAMETRO_REFERENCIA_NO_ORCAMENTO], false);
}

/**
 * RN-VEN-19: `null` se desmarcado ou vazio; senão corta em `max` na última palavra inteira com "…" (o "…" conta).
 * Palavra única maior que `max` é cortada em `max − 1` + "…". Idempotente.
 */
export function retratoAplicacao(texto: string | null | undefined, incluir: boolean, max: number): string | null {
  if (!incluir) return null;
  const limpo = (texto ?? '').trim();
  if (limpo === '') return null;
  const teto = Number.isFinite(max) ? Math.max(2, Math.floor(max)) : APLICACAO_MAX_ORCAMENTO_PADRAO;
  const pontos = Array.from(limpo);
  if (pontos.length <= teto) return limpo;
  const janela = pontos.slice(0, teto - 1).join('');
  // só corta na palavra inteira se o caractere seguinte à janela for espaço, ou se há espaço dentro da janela
  const proximoEhEspaco = /\s/.test(pontos[teto - 1] ?? '');
  let corte = janela;
  if (!proximoEhEspaco) {
    const ultimo = janela.search(/\s\S*$/);
    if (ultimo > 0) corte = janela.slice(0, ultimo);
  }
  const base = corte.trimEnd();
  return base === '' ? `${janela}…` : `${base}…`;
}
