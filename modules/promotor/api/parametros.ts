/**
 * Parâmetros do tenant para o Promotor (`ctx.parametros()`, doc 03 "Parâmetros do tenant"). Valor ausente ou inválido
 * cai no padrão do domain (nunca derruba a requisição); a validação de faixa é a de `resolverParametros`.
 */
import type { ContextoBase } from '@macuxi/platform-sdk';
import { PARAMETROS_PADRAO, resolverParametros, type ParametrosPromotor } from '../domain';

export function parametrosDoTenant(ctx: Pick<ContextoBase, 'parametros'>): ParametrosPromotor {
  const brutos = ctx.parametros();
  const parcial: Partial<ParametrosPromotor> = {};
  for (const k of Object.keys(PARAMETROS_PADRAO) as (keyof ParametrosPromotor)[]) {
    const v = Number(brutos[k]);
    if (brutos[k] !== undefined && brutos[k] !== null && Number.isFinite(v)) parcial[k] = v;
  }
  try {
    return resolverParametros(parcial);
  } catch {
    return { ...PARAMETROS_PADRAO };
  }
}
