/** Mensagem legível de um erro (as telas mostram em português e dizem o que fazer a seguir). */
export function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return 'Algo deu errado. Tente de novo.';
}
