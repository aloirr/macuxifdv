import { formatInt, valorComPadrao, type ValorComPadrao } from '@macuxi/ui/web';
import { ParametrosPesquisaSchema } from '../../contracts';

type Brutos = Readonly<Record<string, unknown>>;
type Parametros = ReturnType<typeof ParametrosPesquisaSchema.parse>;

const PADRAO: Parametros = ParametrosPesquisaSchema.parse({});

/** Valor em uso: o do tenant quando válido; senão o padrão do contrato (mesma tolerância do app e da API). */
export function parametrosEmUso(brutos: Brutos): Parametros {
  const conhecidos = Object.fromEntries(Object.entries(brutos).filter(([k]) => Object.hasOwn(PADRAO, k)));
  const r = ParametrosPesquisaSchema.safeParse(conhecidos);
  return r.success ? r.data : PADRAO;
}

/** Valor em uso de um parâmetro e, se o tenant mudou, "Padrão: X" (`valorComPadrao` do kit, RD-1584). */
export function valorDoParametro(brutos: Brutos, chave: keyof Parametros, formatar: (v: number) => string = formatInt): ValorComPadrao {
  return valorComPadrao(parametrosEmUso(brutos)[chave] as number, PADRAO[chave] as number, formatar);
}
