import type { ParametrosTreinamento } from '../../domain/parametros';
import { parametrosEmUso } from '../../domain/parametros-em-uso';

/** Conjunto em uso (RN-TRE-02), igual ao da API e do app: tipo errado ou fora da faixa em qualquer chave = padrão em todas. */
export const parametrosDoPainel = (bruto: Readonly<Record<string, unknown>>): ParametrosTreinamento => parametrosEmUso(bruto).parametros;
