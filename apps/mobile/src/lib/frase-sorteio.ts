/**
 * T-0181 (spec docs/design/carga-aviso-frases/spec.md §2): a frase do "Você sabia?" da tela de carga. Puro (roda em Node).
 * - Uma frase por carga, sorteada quando a tela monta, entre as ativas; não troca durante a carga.
 * - Nunca repete a última mostrada no aparelho (o aparelho guarda só o id dela).
 * - A lista vem no sync (`GET /v1/sync/frases-carga`) e fica no aparelho; antes do 1º sync valem as ativas das 30 iniciais
 *   do bundle (`FRASES_CARGA_INICIAIS`). Sem nenhuma ativa, a frase não aparece.
 * - A resposta do servidor fora do contrato não substitui a lista guardada (o sync não quebra).
 * A fonte da frase não faz parte do contrato: nunca chega aqui nem à tela.
 */
import { FRASES_CARGA_INICIAIS, FrasesCargaAppRespostaSchema } from '@macuxi/platform-sdk';

/** O que o sorteio precisa de cada frase. A lista do sync só traz ativas; a do bundle traz a situação. */
export interface FraseSorteavel {
  id: string;
  texto: string;
  ativa?: boolean;
}

/** Chaves no armazenamento do aparelho (as mesmas para todos os usuários: as frases são da plataforma). */
export const CHAVE_FRASES_CARGA = 'fv:frases-carga';
export const CHAVE_ULTIMA_FRASE_CARGA = 'fv:frase-carga-ultima';

/**
 * Sorteia uma frase entre as ativas, diferente da última quando houver mais de uma. `rnd` em [0, 1) (Math.random no app).
 * Nenhuma ativa → `null` (o bloco "Você sabia?" não aparece).
 */
export function sortearFrase<F extends FraseSorteavel>(
  frases: readonly F[],
  ultimaId: string | null,
  rnd: () => number,
): F | null {
  const ativas = frases.filter((f) => f.ativa !== false);
  if (ativas.length === 0) return null;
  const candidatas = ativas.length > 1 ? ativas.filter((f) => f.id !== ultimaId) : ativas;
  const i = Math.min(candidatas.length - 1, Math.max(0, Math.floor(rnd() * candidatas.length)));
  return candidatas[i] ?? null;
}

/** A lista do aparelho: a guardada no último sync ou, sem ela, a das 30 iniciais do bundle. */
export function frasesDoAparelho(guardadas: readonly FraseSorteavel[] | null | undefined): readonly FraseSorteavel[] {
  return guardadas ?? FRASES_CARGA_INICIAIS;
}

/** A resposta do `GET /v1/sync/frases-carga` vira a lista a guardar (`{ id, texto }`); fora do contrato → `null`. */
export function frasesDaResposta(dados: unknown): FraseSorteavel[] | null {
  const r = FrasesCargaAppRespostaSchema.safeParse(dados);
  if (!r.success) return null;
  return r.data.frases.map(({ id, texto }) => ({ id, texto }));
}
