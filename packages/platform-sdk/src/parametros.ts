/**
 * T-0180 (ADR 0059 §8): gravação dos parâmetros do tenant DO PRÓPRIO MÓDULO (`ctx.gravarParametros`). Regra 1: só a
 * plataforma toca em `plataforma.parametro`; o módulo grava pelo SDK, e só com `modulo` = o módulo dono da rota. Aqui fica a
 * validação pura (vale na API e nos contextos falsos dos testes dos módulos); quem grava é a API (`apps/api/src/parametros-modulo.ts`).
 */
import { MODULOS, type ModuloId } from './nomes';

/** Mesmo formato do CHECK `parametro_chave_formato` de `plataforma.parametro` (0001). */
export const CHAVE_PARAMETRO_RE = /^[a-z][a-z0-9_.]*$/;

/** Teto de chaves por chamada (uma tela de parâmetros grava poucas; mais que isso é engano). */
export const MAX_CHAVES_GRAVAR_PARAMETROS = 50;

/** Ação de auditoria padrão de `gravarParametros` (RN-AUD-01) quando a rota não informa a sua. */
export const ACAO_AUDITORIA_PARAMETROS = 'parametro.gravar';

export interface OpcoesGravarParametros {
  /** Ação gravada na auditoria (RN-AUD-01), ex.: `alerta_regra.gerenciar`. Padrão: `parametro.gravar`. */
  acao?: string;
}

/**
 * Problemas de uma chamada de `gravarParametros` feita pelo módulo `modulo` (`null` = rota da plataforma). Vazio = pode gravar.
 * Recusa: rota sem módulo; nenhuma chave ou chaves demais; chave fora do formato do banco; chave com o prefixo de OUTRO módulo
 * (`core.checkin.raio_m` vindo do Gestor: cada módulo grava só os próprios parâmetros, e a chave não leva o módulo); valor
 * `undefined` ou que não vira JSON (função, símbolo, bigint, número não finito).
 */
export function problemasGravarParametros(modulo: ModuloId | null, valores: Readonly<Record<string, unknown>>): string[] {
  if (!modulo) return ['rota da plataforma não grava parâmetro de módulo'];
  const chaves = Object.keys(valores);
  const p: string[] = [];
  if (chaves.length === 0) p.push('informe ao menos um parâmetro');
  if (chaves.length > MAX_CHAVES_GRAVAR_PARAMETROS) p.push(`no máximo ${MAX_CHAVES_GRAVAR_PARAMETROS} parâmetros por chamada`);
  for (const c of chaves) {
    if (!CHAVE_PARAMETRO_RE.test(c)) {
      p.push(`chave "${c}" fora do formato (minúsculas, dígitos, "_" e ".")`);
      continue;
    }
    const outro = MODULOS.find((m) => m !== modulo && c.startsWith(`${m}.`));
    if (outro) p.push(`chave "${c}" é do módulo ${outro}: ${modulo} grava só os próprios parâmetros`);
    if (!valorJson(valores[c])) p.push(`valor de "${c}" não é JSON`);
  }
  return p;
}

function valorJson(v: unknown): boolean {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(valorJson);
  if (typeof v === 'object') {
    const proto = Object.getPrototypeOf(v) as unknown;
    return (proto === Object.prototype || proto === null) && Object.values(v as Record<string, unknown>).every(valorJson);
  }
  return false;
}
