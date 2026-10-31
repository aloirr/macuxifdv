/** Conformidade da gôndola (RF-PRO-03): conforme | parcial | não conforme, com motivo. */
import { percentual } from './numeros';
import { resolverParametros } from './parametros';

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
export function pctConformidade(
  conformidades: readonly Conformidade[],
  pesoParcial: number = resolverParametros().peso_parcial_conformidade,
): number | null {
  const conformes = conformidades.filter((c) => c === 'conforme').length;
  const parciais = conformidades.filter((c) => c === 'parcial').length;
  return percentual(conformes + parciais * pesoParcial, conformidades.length);
}

export interface ResumoConformidade {
  registradas: number;
  conformes: number;
  /** RN-PRO-11: o total de parciais aparece à parte, qualquer que seja o peso. */
  parciais: number;
  nao_conformes: number;
  conformidade_pct: number | null;
}

/** RN-PRO-11: % conformidade com o peso do parcial do tenant e o total de parciais à parte. */
export function resumirConformidade(conformidades: readonly Conformidade[], pesoParcial?: number): ResumoConformidade {
  const peso = pesoParcial ?? resolverParametros().peso_parcial_conformidade;
  return {
    registradas: conformidades.length,
    conformes: conformidades.filter((c) => c === 'conforme').length,
    parciais: conformidades.filter((c) => c === 'parcial').length,
    nao_conformes: conformidades.filter((c) => c === 'nao_conforme').length,
    conformidade_pct: pctConformidade(conformidades, peso),
  };
}
