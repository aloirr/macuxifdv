/**
 * Regra única da necessidade diária (RN-CORE-22/26), em contrato para o Core, o Gestor e quem mais precisar sem importar o domain.
 * Os dias úteis restantes vêm de `diasUteisDoPeriodo` (`@macuxi/comum`): lista de feriados vazia = só a semana conta.
 */
/** RN-CORE-22: (meta − realizado) ÷ dias úteis restantes, em centavos (arredonda para cima); nunca negativa; null sem dias úteis. */
export function necessidadeDiaria(meta_cents: number, realizado_cents: number, diasUteisRestantes: number): number | null {
  if (diasUteisRestantes <= 0) return null;
  return Math.max(0, Math.ceil((meta_cents - realizado_cents) / diasUteisRestantes));
}
