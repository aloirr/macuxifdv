// PERMITIDO: packages/*, core/contracts e contracts de outro módulo
import { toCents } from '../../../packages/comum/index';
import { clientePublico } from '../../core/contracts/index';
import type { ProdutoPublico } from '../../catalogo/contracts/index';
export const produto: ProdutoPublico = { id: clientePublico };
export const total = toCents(1.5);
