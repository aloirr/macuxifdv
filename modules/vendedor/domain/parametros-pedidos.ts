/**
 * Parâmetros do tenant de Parâmetros › Pedidos que o Vendedor lê: `titulo_vencido_dias` (RN-VEN-13) e `validade_orcamento_dias`
 * (RN-VEN-18). Faixas e padrões vivem em `pagamento.ts` e `orcamento.ts`; a conferência da faixa é `lerInteiroNaFaixa`; aqui só a validação com mensagem em português
 * (vale no painel e na API, que sempre revalida).
 */
import { lerInteiroNaFaixa } from './inteiro-na-faixa';
import { VALIDADE_MAX_DIAS, VALIDADE_MIN_DIAS } from './orcamento';
import { TITULO_VENCIDO_DIAS_MAX, TITULO_VENCIDO_DIAS_MIN } from './pagamento';

/* funções: `aprovacao` e `orcamento` se importam; a constante nasceria antes das faixas (ciclo) */
const msgTituloVencidoDias = () => `Use um número de ${TITULO_VENCIDO_DIAS_MIN} a ${TITULO_VENCIDO_DIAS_MAX}`;
const msgValidadeOrcamentoDias = () => `Use um número de ${VALIDADE_MIN_DIAS} a ${VALIDADE_MAX_DIAS}`;

export type ResultadoParametroPedidos = { ok: true; valor: number } | { ok: false; codigo: 'RN-VEN-13' | 'RN-VEN-18' | 'RN-VEN-22'; mensagem: string };

/** RN-VEN-12 (P-6): o que fazer com o pedido a prazo acima do crédito disponível. Padrão `aprovacao` (comportamento de antes). */
export const ACOES_CREDITO_EXCEDIDO = ['aprovacao', 'orcamento', 'avisar'] as const;
export type AcaoCreditoExcedido = (typeof ACOES_CREDITO_EXCEDIDO)[number];
const ACAO_CREDITO_EXCEDIDO_PADRAO: AcaoCreditoExcedido = 'aprovacao';
/** RN-VEN-20: o que fazer com o item acima do estoque da filial. Padrão `orcamento` (o pedido só sai como orçamento, desde 10/11). */
export const ACOES_ESTOQUE_INSUFICIENTE = ['orcamento', 'aprovacao', 'avisar'] as const;
export type AcaoEstoqueInsuficiente = (typeof ACOES_ESTOQUE_INSUFICIENTE)[number];
const ACAO_ESTOQUE_INSUFICIENTE_PADRAO: AcaoEstoqueInsuficiente = 'orcamento';

export type ResultadoAcaoParametro<T extends string, R extends string> = { ok: true; valor: T } | { ok: false; codigo: R; mensagem: string };

/** RN-VEN-22: 0 = sem pedido mínimo; teto de R$ 100.000,00 (PA-9). */
const PEDIDO_MINIMO_MAX_CENTS = 10_000_000;
const PARAMETRO_PEDIDO_MINIMO_CENTS = 'pedido_minimo_cents';
/** O BKO só aceita de R$ 0,01 a R$ 100.000,00 (a caixa "Exigir a partir de" desligada é o zero). */
export const MSG_PEDIDO_MINIMO_CENTS = 'Use um valor de R$ 0,01 a R$ 100.000,00';
/** A API aceita também 0 (sem mínimo). */
export const MSG_PEDIDO_MINIMO_CENTS_API = 'Use 0 (sem mínimo) ou um valor até R$ 100.000,00';
const MSG_ACAO_CREDITO_EXCEDIDO = 'Escolha Enviar para aprovação, Só como orçamento ou Avisar e enviar';
const MSG_ACAO_ESTOQUE_INSUFICIENTE = 'Escolha Só como orçamento, Enviar para aprovação ou Avisar e enviar';

/** Só número inteiro da faixa vale (texto numérico não); fora disso, `undefined`. */
function conferir(v: unknown, min: number, max: number): number | undefined {
  const n = lerInteiroNaFaixa(typeof v === 'number' ? v : Number.NaN, min, max, Number.NaN);
  return Number.isNaN(n) ? undefined : n;
}

/** RN-VEN-13: dias de atraso para o título vencido bloquear (inteiro 0..365). */
export function validarTituloVencidoDias(valor: unknown): ResultadoParametroPedidos {
  const n = conferir(valor, TITULO_VENCIDO_DIAS_MIN, TITULO_VENCIDO_DIAS_MAX);
  return n !== undefined ? { ok: true, valor: n } : { ok: false, codigo: 'RN-VEN-13', mensagem: msgTituloVencidoDias() };
}

/** RN-VEN-18: validade do orçamento em dias (inteiro 1..90). */
export function validarValidadeOrcamentoDias(valor: unknown): ResultadoParametroPedidos {
  const n = conferir(valor, VALIDADE_MIN_DIAS, VALIDADE_MAX_DIAS);
  return n !== undefined ? { ok: true, valor: n } : { ok: false, codigo: 'RN-VEN-18', mensagem: msgValidadeOrcamentoDias() };
}

/** RN-VEN-22: valor mínimo do pedido em centavos (inteiro de 0 a R$ 100.000,00; 0 = sem mínimo). */
export function validarPedidoMinimoCents(valor: unknown): ResultadoParametroPedidos {
  const n = conferir(valor, 0, PEDIDO_MINIMO_MAX_CENTS);
  return n !== undefined ? { ok: true, valor: n } : { ok: false, codigo: 'RN-VEN-22', mensagem: MSG_PEDIDO_MINIMO_CENTS_API };
}

/** RN-VEN-22: o mínimo do tenant; sem linha (ou valor inválido) = 0, sem pedido mínimo. */
export function pedidoMinimoCents(parametros: Readonly<Record<string, unknown>>): number {
  return lerInteiroNaFaixa(parametros[PARAMETRO_PEDIDO_MINIMO_CENTS], 0, PEDIDO_MINIMO_MAX_CENTS, 0);
}

function conferirAcao<T extends string>(v: unknown, lista: readonly T[]): T | undefined {
  return (lista as readonly unknown[]).includes(v) ? (v as T) : undefined;
}

/** RN-VEN-12: ação do crédito excedido (`aprovacao` | `orcamento` | `avisar`). */
export function validarAcaoCreditoExcedido(valor: unknown): ResultadoAcaoParametro<AcaoCreditoExcedido, 'RN-VEN-12'> {
  const a = conferirAcao(valor, ACOES_CREDITO_EXCEDIDO);
  return a ? { ok: true, valor: a } : { ok: false, codigo: 'RN-VEN-12', mensagem: MSG_ACAO_CREDITO_EXCEDIDO };
}

/** RN-VEN-12: a ação do tenant; sem linha ou valor inválido = `aprovacao`. */
export function acaoCreditoExcedido(parametros: Readonly<Record<string, unknown>>): AcaoCreditoExcedido {
  return conferirAcao(parametros['credito_excedido_acao'], ACOES_CREDITO_EXCEDIDO) ?? ACAO_CREDITO_EXCEDIDO_PADRAO;
}

/** RN-VEN-20: ação do estoque insuficiente (`orcamento` | `aprovacao` | `avisar`). */
export function validarAcaoEstoqueInsuficiente(valor: unknown): ResultadoAcaoParametro<AcaoEstoqueInsuficiente, 'RN-VEN-20'> {
  const a = conferirAcao(valor, ACOES_ESTOQUE_INSUFICIENTE);
  return a ? { ok: true, valor: a } : { ok: false, codigo: 'RN-VEN-20', mensagem: MSG_ACAO_ESTOQUE_INSUFICIENTE };
}

/** RN-VEN-20: a ação do tenant; sem linha ou valor inválido = `orcamento` (PA-6). */
export function acaoEstoqueInsuficiente(parametros: Readonly<Record<string, unknown>>): AcaoEstoqueInsuficiente {
  return conferirAcao(parametros['estoque_insuficiente_acao'], ACOES_ESTOQUE_INSUFICIENTE) ?? ACAO_ESTOQUE_INSUFICIENTE_PADRAO;
}
