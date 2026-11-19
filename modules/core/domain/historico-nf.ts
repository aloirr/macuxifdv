/**
 * Histórico de NF do Cliente 360 v2 (T-0186; RN-CORE-40; decisões P3, P4, P8, P14 e P17 de 19/11/2026). Funções puras, as mesmas
 * na API e no aparelho. `hoje` é a data civil no fuso do tenant.
 * - O status da NF sai das parcelas (títulos) e das devoluções: enquanto houver saldo, "Em aberto" (ou "Em atraso") prevalece (P3).
 * - "Em atraso" é só o fato: a tela não mostra a data de vencimento (R-20261119-0530).
 * - Limite, Saldo disponível e Prazo médio são o cartão do Resumo (sem "Em aberto" nem "Crédito disponível").
 */
import { situacaoTitulo } from './cliente360';

export type StatusNf = 'em_atraso' | 'em_aberto' | 'pago' | 'devolvido' | 'devolvido_parcial';
export const STATUS_NF: readonly StatusNf[] = ['em_atraso', 'em_aberto', 'pago', 'devolvido', 'devolvido_parcial'];
export type TomStatusNf = 'danger' | 'warning' | 'success' | 'neutral' | 'accent';

/** P8/P17: o aparelho guarda 90 dias de linhas; além disso só se consulta o servidor. */
export const JANELA_APARELHO_DIAS = 90;

export interface ParcelaNf {
  vencimento: string;
  saldo_cents: number;
  situacao: 'aberto' | 'liquidado' | 'cancelado';
}

const ROTULOS: Record<StatusNf, string> = {
  em_atraso: 'Em atraso',
  em_aberto: 'Em aberto',
  pago: 'Pago',
  devolvido: 'Devolvido',
  devolvido_parcial: 'Devolvido parcial',
};
const TONS: Record<StatusNf, TomStatusNf> = { em_atraso: 'danger', em_aberto: 'warning', pago: 'success', devolvido: 'neutral', devolvido_parcial: 'accent' };

/** Texto do chip de status, sem data. */
export const rotuloStatusNf = (s: StatusNf): string => ROTULOS[s];
export const tomStatusNf = (s: StatusNf): TomStatusNf => TONS[s];

/** Parcela aberta, com saldo e vencida (vence hoje ainda não está vencida). */
const parcelaVencida = (p: ParcelaNf, hoje: string) => p.saldo_cents > 0 && situacaoTitulo(p, hoje).situacao === 'vencido';

/** R-20261119-0530: a NF está em atraso se alguma parcela aberta, com saldo, venceu. Só o fato, sem a data. */
export const nfEmAtraso = (parcelas: readonly ParcelaNf[], hoje: string): boolean => parcelas.some((p) => parcelaVencida(p, hoje));

/**
 * RN-CORE-40 / P3: enquanto houver saldo em parcela aberta, o status é "Em atraso" (alguma vencida) ou "Em aberto". Sem saldo:
 * devolvido ≥ valor da nota = "Devolvido"; devolvido > 0 = "Devolvido parcial"; senão "Pago" (nota sem parcela no ERP = à vista, paga).
 */
export function statusDaNf(nota: { valor_cents: number; devolvido_cents: number }, parcelas: readonly ParcelaNf[], hoje: string): StatusNf {
  const comSaldo = parcelas.filter((p) => p.situacao === 'aberto' && p.saldo_cents > 0);
  if (comSaldo.length > 0) return nfEmAtraso(comSaldo, hoje) ? 'em_atraso' : 'em_aberto';
  if (nota.devolvido_cents > 0) return nota.devolvido_cents >= nota.valor_cents ? 'devolvido' : 'devolvido_parcial';
  return 'pago';
}

/** P4: valor devolvido da NF = soma das devoluções vivas (não canceladas) cuja NF original é esta. */
export function devolvidoDaNota(numeroNf: string, devolucoes: ReadonlyArray<{ nf_original: string | null; total_cents: number; cancelada: boolean }>): number {
  return devolucoes.filter((d) => !d.cancelada && d.nf_original === numeroNf).reduce((s, d) => s + d.total_cents, 0);
}

export interface FinanceiroDoResumo {
  limite_cents: number;
  saldo_aberto_cents: number;
  credito_disponivel_erp_cents: number | null;
  bloqueado?: boolean;
  motivo_bloqueio?: string | null;
}

/**
 * RN-VEN-12: Saldo disponível = (crédito do ERP, se vier, senão limite − em aberto) − pedidos aprovados ainda não faturados.
 * `aprovadosNaoFaturadosCents` já vem sem os pedidos integrados quando o ERP informou o crédito (conta do Vendedor). Pode ficar negativo.
 */
export function saldoDisponivelCents(f: Pick<FinanceiroDoResumo, 'limite_cents' | 'saldo_aberto_cents' | 'credito_disponivel_erp_cents'>, aprovadosNaoFaturadosCents: number): number {
  return (f.credito_disponivel_erp_cents ?? f.limite_cents - f.saldo_aberto_cents) - aprovadosNaoFaturadosCents;
}

export interface CartaoCreditoResumo {
  limite_cents: number;
  saldo_disponivel_cents: number;
  prazo_medio_dias: number | null;
  bloqueado: boolean;
  motivo_bloqueio: string | null;
}

/** Spec §3.2: o cartão do Resumo só tem Limite, Saldo disponível e Prazo médio; o motivo entra só com o cliente bloqueado. Sem linha financeira = `null`. */
export function limiteEDisponivelDoResumo(f: FinanceiroDoResumo | null | undefined, aprovadosNaoFaturadosCents: number, prazoMedioDias: number | null): CartaoCreditoResumo | null {
  if (!f) return null;
  const bloqueado = f.bloqueado ?? false;
  return {
    limite_cents: f.limite_cents,
    saldo_disponivel_cents: saldoDisponivelCents(f, aprovadosNaoFaturadosCents),
    prazo_medio_dias: prazoMedioDias,
    bloqueado,
    motivo_bloqueio: bloqueado ? (f.motivo_bloqueio ?? null) : null,
  };
}

const MS_DIA = 86_400_000;
const somarDias = (data: string, dias: number): string => new Date(Date.parse(`${data}T00:00:00Z`) + dias * MS_DIA).toISOString().slice(0, 10);

export type PeriodoNf = '30d' | '90d' | '12m';

/** P8: início do período do filtro, contado de `hoje` (12 meses = mesmo dia do ano anterior). */
export function inicioDoPeriodoNf(p: PeriodoNf, hoje: string): string {
  if (p === '12m') return `${Number(hoje.slice(0, 4)) - 1}${hoje.slice(4)}`;
  return somarDias(hoje, -(p === '30d' ? 30 : JANELA_APARELHO_DIAS));
}

/** P17: o início pedido cai além da janela do aparelho = só online. */
export const periodoPrecisaDoServidor = (de: string, hoje: string): boolean => de < somarDias(hoje, -JANELA_APARELHO_DIAS);

export interface LinhaHistoricoNf {
  data: string;
  numero_nf: string;
  valor_cents: number;
  forma_pagamento: string | null;
  status: StatusNf;
}

export interface FiltroHistoricoNf {
  de?: string;
  ate?: string;
  /** Vazio ou ausente = todos. */
  status?: readonly StatusNf[];
  forma_pagamento?: readonly string[];
  /** P14: parte do número da NF. */
  numero_nf?: string;
}

/** P14: filtra as linhas e as devolve da mais recente para a mais antiga. */
export function filtrarNotas<T extends LinhaHistoricoNf>(linhas: readonly T[], f: FiltroHistoricoNf): T[] {
  const busca = f.numero_nf?.trim();
  return linhas
    .filter(
      (l) =>
        (!f.de || l.data >= f.de) &&
        (!f.ate || l.data <= f.ate) &&
        (!f.status?.length || f.status.includes(l.status)) &&
        (!f.forma_pagamento?.length || (l.forma_pagamento !== null && f.forma_pagamento.includes(l.forma_pagamento))) &&
        (!busca || l.numero_nf.includes(busca)),
    )
    .sort((a, b) => (a.data === b.data ? b.numero_nf.localeCompare(a.numero_nf) : b.data.localeCompare(a.data)));
}
