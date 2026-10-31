/** Conformidade da gôndola (RF-PRO-03): conforme | parcial | não conforme, com motivo. */
import { percentual } from './numeros';

export const CONFORMIDADES = ['conforme', 'parcial', 'nao_conforme'] as const;
export type Conformidade = (typeof CONFORMIDADES)[number];

export const ROTULO_CONFORMIDADE: Readonly<Record<Conformidade, string>> = {
  conforme: 'Conforme',
  parcial: 'Parcial',
  nao_conforme: 'Não conforme',
};

/** RF-PRO-03: motivo obrigatório quando não conforme. Lista vazia = válido. */
export function validarConformidade(r: { conformidade: Conformidade; motivo?: string | null }): string[] {
  if (!(CONFORMIDADES as readonly string[]).includes(r.conformidade)) return ['Escolha a conformidade: conforme, parcial ou não conforme.'];
  if (r.conformidade === 'nao_conforme' && !(r.motivo ?? '').trim()) return ['Gôndola não conforme: informe o motivo.'];
  return [];
}

/**
 * RF-PRO-12: % conformidade = (conformes + parciais × peso) ÷ gôndolas registradas × 100.
 * O peso do parcial é 0 por padrão (só conta o que está totalmente conforme).
 */
export function pctConformidade(conformidades: readonly Conformidade[], pesoParcial = 0): number | null {
  const conformes = conformidades.filter((c) => c === 'conforme').length;
  const parciais = conformidades.filter((c) => c === 'parcial').length;
  return percentual(conformes + parciais * pesoParcial, conformidades.length);
}
