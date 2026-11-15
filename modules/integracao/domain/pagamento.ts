/**
 * T-0089 (RN-VEN-24): prazo médio de um prazo de pagamento vindo do ERP. O Macuxi CALCULA o prazo médio (média das parcelas,
 * arredondada para cima: 28/56 = 42; 30/45 = 38); o `prazo_medio_dias` do ERP é só informativo, e valor diferente vira o aviso
 * `prazo_medio_divergente` (a linha é aplicada com o valor calculado, nunca recusada). Mesma conta do domain do Vendedor.
 */
import type { PrazoPagamentoPayload } from '../contracts';

export type AvisoPrazo = { external_id: string; codigo: 'prazo_medio_divergente'; mensagem: string };

export function prazoMedioCalculado(parcelasDias: readonly number[]): number {
  if (parcelasDias.length === 0) throw new Error('RN-VEN-24: o prazo precisa de ao menos uma parcela.');
  return Math.ceil(parcelasDias.reduce((a, b) => a + b, 0) / parcelasDias.length);
}

/** Aviso quando o ERP informou um prazo médio diferente do calculado; sem valor informado, não há o que comparar. */
export function avisoPrazoMedioDivergente(r: Pick<PrazoPagamentoPayload, 'external_id' | 'parcelas_dias' | 'prazo_medio_dias'>): AvisoPrazo | null {
  if (r.prazo_medio_dias == null) return null;
  const calculado = prazoMedioCalculado(r.parcelas_dias);
  if (calculado === r.prazo_medio_dias) return null;
  return {
    external_id: r.external_id,
    codigo: 'prazo_medio_divergente',
    mensagem: `O ERP informou prazo médio de ${r.prazo_medio_dias} dias, mas as parcelas ${r.parcelas_dias.join('/')} dão ${calculado}. O Macuxi usa ${calculado} (RN-VEN-24); confira o cadastro no ERP.`,
  };
}

/** RN-INT-15: percentual de ajuste do prazo ("% Acres.Fin."); ausente ou nulo vale 0 (sem ajuste). */
export function percentualAjusteDoPrazo(r: { percentual_ajuste?: number | null }): number {
  return r.percentual_ajuste ?? 0;
}
