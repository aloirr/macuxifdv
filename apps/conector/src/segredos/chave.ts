/** Conferência local da chave de API do Hub (antes de gravar): formato razoável, sem espaços nem quebras de linha. */
export const CHAVE_MIN = 16;
export const CHAVE_MAX = 512;

/** Devolve a mensagem de erro (em português, com a ação seguinte) ou `null` se a chave pode ser usada. Nunca ecoa o valor. */
export function validarFormatoChave(chave: string): string | null {
  if (chave === '') return 'A chave veio vazia. Passe a chave nova pela entrada padrão: echo CHAVE| conector trocar-chave (nada foi gravado).';
  if (/\s/.test(chave)) return 'A chave tem espaço ou quebra de linha no meio. Copie a chave inteira, sem espaços, do BKO (Integração > Conectores) e tente de novo (nada foi gravado).';
  if (/[^\x21-\x7e]/.test(chave)) return 'A chave tem caracteres que não são ASCII visíveis; confira se copiou o texto certo do BKO (nada foi gravado).';
  if (chave.length < CHAVE_MIN) return `A chave tem menos de ${CHAVE_MIN} caracteres; parece incompleta. Copie a chave inteira do BKO (nada foi gravado).`;
  if (chave.length > CHAVE_MAX) return `A chave passa de ${CHAVE_MAX} caracteres; confira se copiou só a chave (nada foi gravado).`;
  return null;
}
