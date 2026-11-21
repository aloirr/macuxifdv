import { formatInt, valorComPadrao, type ValorComPadrao } from '@macuxi/ui/web';
import { PARAMETROS_PADRAO, parametrosComPadrao, type ParametrosPesquisa } from '../../domain';

type Brutos = Readonly<Record<string, unknown>>;

/** Valor em uso de um parâmetro e, se o tenant mudou, "Padrão: X" (`valorComPadrao` do kit, RD-1584). */
export function valorDoParametro(brutos: Brutos, chave: keyof ParametrosPesquisa, formatar: (v: number) => string = formatInt): ValorComPadrao {
  return valorComPadrao(parametrosComPadrao(brutos).parametros[chave] as number, PARAMETROS_PADRAO[chave] as number, formatar);
}
