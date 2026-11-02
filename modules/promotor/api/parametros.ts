/** Parâmetros do tenant para o Promotor na API (`ctx.parametros()`); regra de leitura no domain (`parametrosDosBrutos`). */
import type { ContextoBase } from '@macuxi/platform-sdk';
import { parametrosDosBrutos, type ParametrosPromotor } from '../domain';

export function parametrosDoTenant(ctx: Pick<ContextoBase, 'parametros'>): ParametrosPromotor {
  return parametrosDosBrutos(ctx.parametros());
}
