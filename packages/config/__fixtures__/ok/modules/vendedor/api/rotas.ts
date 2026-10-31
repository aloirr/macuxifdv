// PERMITIDO: camada interna do próprio módulo
import { total } from '../domain/total';
import { pedidoPublico } from '../contracts/index';
export const rota = total + pedidoPublico;
