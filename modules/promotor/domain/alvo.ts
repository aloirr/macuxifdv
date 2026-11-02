/**
 * Cadastro de trade que vale para a loja na data (RN-PRO-10, T-0056): alvo (loja, segmento/canal ou todas) + vigência
 * + não removido. Quando mais de uma versão vale, a mais específica vence (loja > segmento > todas) e, empatadas,
 * a de início mais recente (`versaoVigente`). Roda no app (offline) e na API.
 */
import { vigenteEm } from './vigencia';

export interface CadastroComAlvo {
  id: string;
  cliente_id: string | null;
  segmento: string | null;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  deleted_at?: string | null;
}

export interface LojaAlvo {
  id: string;
  segmento: string | null;
}

/** RN-PRO-10: o cadastro vale para a loja na data civil `data` (fuso do tenant). */
export function cadastroValeParaLoja(c: CadastroComAlvo, loja: LojaAlvo, data: string): boolean {
  if (c.deleted_at) return false;
  if (!vigenteEm(c, data)) return false;
  if (c.cliente_id !== null) return c.cliente_id === loja.id;
  if (c.segmento !== null) return loja.segmento !== null && c.segmento.trim().toLowerCase() === loja.segmento.trim().toLowerCase();
  return true;
}

/** Todos os cadastros que valem para a loja (mix obrigatório, tarefas, pontos extras). */
export function cadastrosDaLoja<T extends CadastroComAlvo>(lista: readonly T[], loja: LojaAlvo, data: string): T[] {
  return lista.filter((c) => cadastroValeParaLoja(c, loja, data));
}

const especificidade = (c: CadastroComAlvo) => (c.cliente_id !== null ? 2 : c.segmento !== null ? 1 : 0);

function maisEspecifico<T extends CadastroComAlvo>(lista: readonly T[]): T | null {
  let melhor: T | null = null;
  for (const c of lista) {
    if (!melhor || especificidade(c) > especificidade(melhor) || (especificidade(c) === especificidade(melhor) && c.vigencia_inicio > melhor.vigencia_inicio)) melhor = c;
  }
  return melhor;
}

/** RN-PRO-10: checklist do dia da loja (o mais específico vigente) ou `null`. */
export function checklistDaLoja<T extends CadastroComAlvo>(modelos: readonly T[], loja: LojaAlvo, data: string): T | null {
  return maisEspecifico(cadastrosDaLoja(modelos, loja, data));
}

/** RN-PRO-03/10: meta de share vigente da categoria na loja (a mais específica) ou `null` (sem meta). */
export function metaDaCategoria<T extends CadastroComAlvo & { categoria_gondola_id: string }>(metas: readonly T[], categoria_gondola_id: string, loja: LojaAlvo, data: string): T | null {
  return maisEspecifico(cadastrosDaLoja(metas, loja, data).filter((m) => m.categoria_gondola_id === categoria_gondola_id));
}
