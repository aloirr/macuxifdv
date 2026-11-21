/**
 * Parâmetros do tenant da Pesquisa. O padrão e a validação vêm do contrato (`ParametrosPesquisaSchema`), para app,
 * web e API usarem os mesmos valores. Valores de RN: tolerância de 24 h (RN-PES-04), foto 1600 px/JPEG 80 (RN-PES-06) e limites do construtor (RN-PES-07); só a amplitude da escala é premissa.
 */
import { ParametrosPesquisaSchema, type ParametrosPesquisa } from '../contracts';

export type { ParametrosPesquisa };

export const PARAMETROS_PADRAO: Readonly<ParametrosPesquisa> = Object.freeze(ParametrosPesquisaSchema.parse({}));

/** Só as chaves conhecidas da Pesquisa, sem o `fuso` (o fuso vem do tenant, não do cadastro de parâmetros). */
function parametrosConhecidos(brutos: Readonly<Record<string, unknown>>): Partial<ParametrosPesquisa> {
  return Object.fromEntries(Object.entries(brutos).filter(([k]) => k !== 'fuso' && Object.hasOwn(PARAMETROS_PADRAO, k))) as Partial<ParametrosPesquisa>;
}

/** Mistura os parâmetros do tenant com o padrão e recusa valores inválidos (mensagem em português). */
export function resolverParametros(parcial: Partial<ParametrosPesquisa> = {}): ParametrosPesquisa {
  const r = ParametrosPesquisaSchema.safeParse({ ...PARAMETROS_PADRAO, ...parcial });
  if (!r.success) {
    const i = r.error.issues[0]!;
    throw new RangeError(`Parâmetro ${i.path.join('.') || '(raiz)'} inválido: ${i.message}`);
  }
  return r.data;
}

/**
 * Parâmetros em uso (RN-PES-04/06/07): só as chaves conhecidas; valor inválido vira o padrão em tudo, com a mensagem do erro
 * para a API registrar no log. O fuso, quando informado, é o do tenant; sem ele vale o padrão.
 */
export function parametrosComPadrao(brutos: Readonly<Record<string, unknown>>, fuso?: string): { parametros: ParametrosPesquisa; erro?: string } {
  const base = fuso === undefined ? {} : { fuso };
  try {
    return { parametros: resolverParametros({ ...parametrosConhecidos(brutos), ...base }) };
  } catch (e) {
    return { parametros: resolverParametros(base), erro: e instanceof Error ? e.message : String(e) };
  }
}
