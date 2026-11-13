/**
 * RN-CORE-41 Frase do dia (T-0170; desenho `docs/desenho/inicio-frase-avatar-pedidos.md` §3). Funções puras: o aparelho
 * (offline), o BKO ("Frase de hoje") e a API fazem a mesma conta. Quem chama passa `hoje` como data civil AAAA-MM-DD no fuso
 * do tenant (não lê o relógio).
 */
import { exigirDataCivil } from '@macuxi/comum/calendar';
import { FRASE_TEXTO_MAX, FRASES_MAX } from '../../contracts/frases';

/** O que o rodízio precisa de cada linha de `core.frase_dia` (a linha do pull serve). */
export interface FraseDoRodizio {
  id: string;
  texto: string;
  ativa: boolean;
  ordem: number;
  deleted_at?: string | null;
}

const DIA_MS = 86_400_000;

/**
 * Frase de hoje, a mesma para todos os usuários do tenant (D1): entre as ativas e vivas, na ordem do BKO (empate pelo `id`),
 * a de posição (dias desde 01/01/1970 de `hoje`) mod (número de ativas). Sem frase ativa: `null` (a linha não aparece).
 */
export function fraseDoDia<F extends FraseDoRodizio>(frases: readonly F[], hoje: string): F | null {
  exigirDataCivil(hoje);
  const ativas = frases.filter((f) => f.ativa && !f.deleted_at).sort((a, b) => a.ordem - b.ordem || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (ativas.length === 0) return null;
  const dia = Math.floor(Date.parse(`${hoje}T12:00:00Z`) / DIA_MS);
  return ativas[dia % ativas.length] ?? null;
}

export type ErroFrase = { ok: false; codigo: 'RN-CORE-41'; motivo: 'vazia' | 'longa' | 'repetida' | 'limite' | 'ordem_incompleta' };

const chave = (texto: string) => texto.trim().toLowerCase();

/**
 * Valida o texto de uma frase nova (sem `editando`) ou editada (`editando.id`) contra as frases VIVAS do tenant: 1 a 120
 * caracteres depois do `trim`, sem repetir (sem diferenciar maiúsculas) e, na criação, no máximo 366 vivas. Devolve o texto
 * já sem os espaços das pontas, que é o que se grava.
 */
export function validarFrase(
  texto: string,
  vivas: ReadonlyArray<{ id: string; texto: string }>,
  editando?: { id: string },
): { ok: true; texto: string } | ErroFrase {
  const limpo = texto.trim();
  if (limpo.length === 0) return { ok: false, codigo: 'RN-CORE-41', motivo: 'vazia' };
  if (limpo.length > FRASE_TEXTO_MAX) return { ok: false, codigo: 'RN-CORE-41', motivo: 'longa' };
  const outras = vivas.filter((f) => f.id !== editando?.id);
  if (outras.some((f) => chave(f.texto) === chave(limpo))) return { ok: false, codigo: 'RN-CORE-41', motivo: 'repetida' };
  if (!editando && outras.length >= FRASES_MAX) return { ok: false, codigo: 'RN-CORE-41', motivo: 'limite' };
  return { ok: true, texto: limpo };
}

/** `PUT /ordem`: a nova ordem tem de ser exatamente os ids vivos, cada um uma vez. */
export function validarNovaOrdem(idsVivos: readonly string[], ids: readonly string[]): { ok: true } | ErroFrase {
  const vivos = new Set(idsVivos);
  const recebidos = new Set(ids);
  const igual = recebidos.size === ids.length && recebidos.size === vivos.size && ids.every((id) => vivos.has(id));
  return igual ? { ok: true } : { ok: false, codigo: 'RN-CORE-41', motivo: 'ordem_incompleta' };
}
