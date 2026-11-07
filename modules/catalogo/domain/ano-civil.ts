/**
 * Ano civil no fuso do tenant (RN-CORE-11, ADR 0015): expande as faixas abertas da aplicação ("2015 em diante"). Função pura,
 * a mesma no índice do aparelho e no ranking, para a virada de 31/12 para 01/01 cair no mesmo instante nos dois.
 */
export const FUSO_PADRAO_ANO = 'America/Manaus';

/** Um formatador por fuso (criar um por chamada custa ~1,5 ms). */
const formatadores = new Map<string, Intl.DateTimeFormat | null>();
function formatadorDoFuso(fuso: string): Intl.DateTimeFormat | null {
  if (!formatadores.has(fuso)) {
    try {
      formatadores.set(fuso, new Intl.DateTimeFormat('en-US', { timeZone: fuso, year: 'numeric' }));
    } catch {
      formatadores.set(fuso, null);
    }
  }
  return formatadores.get(fuso)!;
}

/** Ano civil de `agora` (instante UTC) no `fuso`; fuso ausente ou inválido cai em America/Manaus e, sem Intl, no UTC. */
export function anoCivilNoFuso(agora: Date | string, fuso?: string | null): number {
  const data = typeof agora === 'string' ? new Date(agora) : agora;
  const f = formatadorDoFuso(fuso ?? FUSO_PADRAO_ANO) ?? formatadorDoFuso(FUSO_PADRAO_ANO);
  const ano = f && !Number.isNaN(data.getTime()) ? Number(f.format(data)) : NaN;
  return Number.isFinite(ano) ? ano : data.getUTCFullYear();
}
