/**
 * Parâmetros do tenant de Parâmetros › Pedidos que o Vendedor lê: `titulo_vencido_dias` (RN-VEN-13) e `validade_orcamento_dias`
 * (RN-VEN-18). Faixas e padrões vivem em `pagamento.ts` e `orcamento.ts`; a conferência da faixa é `lerInteiroNaFaixa`; aqui só a validação com mensagem em português
 * (vale no painel e na API, que sempre revalida).
 */
import { lerInteiroNaFaixa } from './inteiro-na-faixa';
import { VALIDADE_MAX_DIAS, VALIDADE_MIN_DIAS } from './orcamento';
import { TITULO_VENCIDO_DIAS_MAX, TITULO_VENCIDO_DIAS_MIN } from './pagamento';

export const MSG_TITULO_VENCIDO_DIAS = `Use um número de ${TITULO_VENCIDO_DIAS_MIN} a ${TITULO_VENCIDO_DIAS_MAX}`;
export const MSG_VALIDADE_ORCAMENTO_DIAS = `Use um número de ${VALIDADE_MIN_DIAS} a ${VALIDADE_MAX_DIAS}`;

export type ResultadoParametroPedidos = { ok: true; valor: number } | { ok: false; codigo: 'RN-VEN-13' | 'RN-VEN-18'; mensagem: string };

/** Só número inteiro da faixa vale (texto numérico não); fora disso, `undefined`. */
function conferir(v: unknown, min: number, max: number): number | undefined {
  const n = lerInteiroNaFaixa(typeof v === 'number' ? v : Number.NaN, min, max, Number.NaN);
  return Number.isNaN(n) ? undefined : n;
}

/** RN-VEN-13: dias de atraso para o título vencido bloquear (inteiro 0..365). */
export function validarTituloVencidoDias(valor: unknown): ResultadoParametroPedidos {
  const n = conferir(valor, TITULO_VENCIDO_DIAS_MIN, TITULO_VENCIDO_DIAS_MAX);
  return n !== undefined ? { ok: true, valor: n } : { ok: false, codigo: 'RN-VEN-13', mensagem: MSG_TITULO_VENCIDO_DIAS };
}

/** RN-VEN-18: validade do orçamento em dias (inteiro 1..90). */
export function validarValidadeOrcamentoDias(valor: unknown): ResultadoParametroPedidos {
  const n = conferir(valor, VALIDADE_MIN_DIAS, VALIDADE_MAX_DIAS);
  return n !== undefined ? { ok: true, valor: n } : { ok: false, codigo: 'RN-VEN-18', mensagem: MSG_VALIDADE_ORCAMENTO_DIAS };
}
