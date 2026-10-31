// S0-012 domain próprio usando packages/* e contracts alheios (tipo)
import { somar } from '../../../packages/comum/index';
import type { ContratoB } from '../../b/contracts/index';
import type { Id } from '../../core/contracts/index';
export const regraA = (c: ContratoB, id: Id): string => c.id + id + String(somar(1, 2));
