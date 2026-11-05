/**
 * RN-CORE-27 (T-0080): positivação do mês pelas notas do ERP (Vendedor desligado). Funções puras.
 * Cada cliente conta uma vez, no dia (fuso do tenant) da primeira nota de faturamento não cancelada do mês.
 */
import { dataLocal } from './checkin';

export interface NotaParaPositivar {
  cliente_id: string;
  emitida_em: string | Date;
  tipo?: 'faturamento' | 'devolucao';
  cancelada?: boolean;
}

/** RN-CORE-27: positiva a nota de faturamento não cancelada (a consulta já tira as inativadas). */
export function notaPositiva(n: { tipo: 'faturamento' | 'devolucao'; cancelada: boolean }): boolean {
  return n.tipo === 'faturamento' && !n.cancelada;
}

/** RN-CORE-27 + RN-CORE-26: clientes distintos do mês; `hoje` = clientes cuja 1ª nota válida é hoje; `ate_ontem` = dias anteriores. */
export function positivacaoPorNotas(
  notas: readonly NotaParaPositivar[],
  o: { periodo: string; fuso: string; hoje: string },
): { ate_ontem: number; hoje: number; mes: number } {
  const primeiro = new Map<string, string>();
  for (const n of notas) {
    if (!notaPositiva({ tipo: n.tipo ?? 'faturamento', cancelada: n.cancelada ?? false })) continue;
    const dia = dataLocal(n.emitida_em, o.fuso);
    if (dia.slice(0, 7) !== o.periodo || dia > o.hoje) continue;
    const atual = primeiro.get(n.cliente_id);
    if (atual === undefined || dia < atual) primeiro.set(n.cliente_id, dia);
  }
  let ate_ontem = 0;
  let hoje = 0;
  for (const dia of primeiro.values()) {
    if (dia < o.hoje) ate_ontem += 1;
    else hoje += 1;
  }
  return { ate_ontem, hoje, mes: primeiro.size };
}
