/**
 * Regras de tela das "Frases do dia" (RN-CORE-41), puras: mensagem de cada erro do domain (`validarFrase`) e da API (422
 * `RN-CORE-41` com `detalhes.motivo`) e a troca de posição para o `PUT /ordem`.
 */
import { ApiRequestError, errorMessage } from '@macuxi/platform-sdk/web';
import { FRASE_TEXTO_MAX, FRASES_MAX } from '../../../contracts/frases';
import type { ErroFrase } from '../../../domain/frase-avatar/frase-do-dia';

export const MENSAGEM_ERRO_FRASE: Record<ErroFrase['motivo'], string> = {
  vazia: 'Escreva a frase.',
  longa: `Use até ${FRASE_TEXTO_MAX} caracteres.`,
  repetida: 'Esta frase já está na lista.',
  limite: `A lista já tem ${FRASES_MAX} frases. Remova uma para adicionar outra.`,
  ordem_incompleta: 'A lista mudou. Atualize a página e tente de novo.',
};

/** 422 `RN-CORE-41` da API com o motivo do domain → a mesma mensagem da validação local; outro erro → mensagem da API. */
export function mensagemDoErroFrase(e: unknown): string {
  const motivo = e instanceof ApiRequestError && e.code === 'RN-CORE-41' ? e.details?.motivo : undefined;
  return typeof motivo === 'string' && motivo in MENSAGEM_ERRO_FRASE ? MENSAGEM_ERRO_FRASE[motivo as ErroFrase['motivo']] : errorMessage(e);
}

/** Nova ordem com a frase `id` uma posição acima (-1) ou abaixo (+1); `null` na ponta da lista. */
export function moverFrase(ids: readonly string[], id: string, delta: -1 | 1): string[] | null {
  const i = ids.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  const out = [...ids];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}
