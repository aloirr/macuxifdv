/**
 * Parâmetros do tenant do Gestor (doc 03, tabela de parâmetros). A validação mora em `ParametrosGestorSchema`
 * (contracts); aqui o padrão e a mistura com o parcial do tenant. Parâmetros dos ALERTAS ficam nas regras (`alertas.ts`).
 */
import { ParametrosGestorSchema, type ParametrosGestorContrato } from '../contracts/parametros';

export type ParametrosGestor = ParametrosGestorContrato;

export const PARAMETROS_PADRAO: Readonly<ParametrosGestor> = Object.freeze(ParametrosGestorSchema.parse({}));

/** Mistura os parâmetros do tenant com o padrão e recusa valores inválidos. */
export function resolverParametros(parcial: Partial<ParametrosGestor> = {}): ParametrosGestor {
  const r = ParametrosGestorSchema.safeParse({ ...PARAMETROS_PADRAO, ...parcial });
  if (!r.success) {
    const i = r.error.issues[0]!;
    throw new RangeError(`Parâmetro ${i.path.join('.') || 'do tenant'} inválido: ${i.message}`);
  }
  return r.data;
}

/**
 * Parâmetros do tenant como chegam da plataforma (`ctx.parametros()`, chaves livres) + o fuso do tenant (`ctx.fuso()`,
 * que sempre vence). Só as chaves conhecidas do Gestor entram; valor inválido NÃO derruba a tela: volta ao padrão com
 * `erro` em português (a API registra o aviso, sem dado pessoal).
 */
export function parametrosDoTenant(brutos: Readonly<Record<string, unknown>>, fuso: string): { params: ParametrosGestor; erro: string | null } {
  const conhecidos = Object.fromEntries(Object.entries(brutos).filter(([k]) => Object.hasOwn(PARAMETROS_PADRAO, k))) as Partial<ParametrosGestor>;
  // T-0073: o limite do "parado" é parâmetro do Início (Core): chave `inicio.parado_min` (aceita também `parado_min`)
  if (conhecidos.parado_min === undefined && brutos['inicio.parado_min'] !== undefined) conhecidos.parado_min = brutos['inicio.parado_min'] as number;
  try {
    return { params: resolverParametros({ ...conhecidos, fuso }), erro: null };
  } catch (e) {
    try {
      return { params: resolverParametros({ fuso }), erro: (e as Error).message };
    } catch {
      return { params: resolverParametros(), erro: (e as Error).message };
    }
  }
}
