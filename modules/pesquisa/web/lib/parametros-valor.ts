import { formatInt } from '@macuxi/ui/web';
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

export interface ValorParametro {
  texto: string;
  /** Texto do padrão, só quando o valor do tenant difere dele. */
  padrao: string | null;
}

/** Texto do valor de um parâmetro e, se o tenant mudou, o padrão ("Padrão: X"). */
export function valorDoParametro(brutos: Brutos, chave: keyof Parametros, formatar: (v: number) => string = formatInt): ValorParametro {
  const atual = parametrosEmUso(brutos)[chave] as number;
  const padrao = PADRAO[chave] as number;
  return { texto: formatar(atual), padrao: atual === padrao ? null : formatar(padrao) };
}
