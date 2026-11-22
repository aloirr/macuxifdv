// Viola core-contracts-importa-outro-modulo e fecha o ciclo direto com integracao/contracts (caso do PR #636).
import { Entidade } from '../../integracao/contracts';
import { regra } from '../domain/regra';

export const horario = { entidade: Entidade, regra };
