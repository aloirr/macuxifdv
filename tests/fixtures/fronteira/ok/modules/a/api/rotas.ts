// interno do próprio módulo + contracts de outro via alias exportado
import { regraA } from '../domain/regra-a';
import type { ContratoB } from '@macuxi/b/contracts';
export const rota = (c: ContratoB): string => regraA(c, 'x');
