/**
 * Vigência de checklist, mix obrigatório e metas de share (RN-PRO-10): a coleta guarda a versão
 * vigente no momento. Datas civis `AAAA-MM-DD`; início e fim inclusivos; fim `null` = sem prazo.
 */
export interface Vigencia {
  vigencia_inicio: string;
  vigencia_fim?: string | null;
}

export function vigenteEm(v: Vigencia, data: string): boolean {
  return v.vigencia_inicio <= data && (v.vigencia_fim === null || v.vigencia_fim === undefined || data <= v.vigencia_fim);
}

/** Versão vigente na data (a de início mais recente entre as vigentes); `null` se nenhuma. */
export function versaoVigente<T extends Vigencia>(versoes: readonly T[], data: string): T | null {
  const vigentes = versoes.filter((v) => vigenteEm(v, data));
  if (vigentes.length === 0) return null;
  return vigentes.reduce((a, b) => (b.vigencia_inicio > a.vigencia_inicio ? b : a));
}
