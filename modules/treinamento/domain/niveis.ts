/** Níveis por faixas de XP (RF-TRE-03). As faixas são do tenant (premissa T-0011: padrão em `FAIXAS_NIVEL_PADRAO`). */
import { arredondar } from './numeros';
import { FAIXAS_NIVEL_PADRAO, validarFaixasDeNivel } from './parametros';

export interface NivelDoXp {
  nivel: number;
  xp_total: number;
  /** XP em que o nível atual começa. */
  xp_inicio_nivel: number;
  /** XP em que o próximo nível começa; null no último nível. */
  xp_proximo_nivel: number | null;
  /** XP que falta para o próximo nível (0 no último). */
  xp_faltante: number;
  /** Quanto do nível atual já foi percorrido (0–100; 100 no último). */
  progresso_pct: number;
  nivel_maximo: boolean;
}

export function nivelDoXp(xp: number, faixas: readonly number[] = FAIXAS_NIVEL_PADRAO): NivelDoXp {
  if (!Number.isInteger(xp) || xp < 0) throw new RangeError('O XP precisa ser um número inteiro maior ou igual a zero.');
  validarFaixasDeNivel(faixas);
  let i = 0;
  while (i + 1 < faixas.length && xp >= faixas[i + 1]!) i++;
  const inicio = faixas[i]!;
  const proximo = i + 1 < faixas.length ? faixas[i + 1]! : null;
  return {
    nivel: i + 1,
    xp_total: xp,
    xp_inicio_nivel: inicio,
    xp_proximo_nivel: proximo,
    xp_faltante: proximo === null ? 0 : proximo - xp,
    progresso_pct: proximo === null ? 100 : arredondar(((xp - inicio) / (proximo - inicio)) * 100),
    nivel_maximo: proximo === null,
  };
}

/** Celebração discreta (UX): subiu de nível ao passar de `antes` para `depois` de XP? */
export function subiuDeNivel(antes: number, depois: number, faixas: readonly number[] = FAIXAS_NIVEL_PADRAO): { subiu: boolean; de: number; para: number } {
  const de = nivelDoXp(antes, faixas).nivel;
  const para = nivelDoXp(depois, faixas).nivel;
  return { subiu: para > de, de, para };
}
