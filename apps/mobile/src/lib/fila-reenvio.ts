/**
 * RN-CORE-23 item 2 (exceção à regra "nenhum timer automático abaixo de 15 min"): o reenvio da FILA do aparelho. Só roda
 * com item pendente, nunca consulta novidades nem faz pull, e a espera cresce a cada tentativa sem sucesso: 15 s, 30 s,
 * 1 min, 2 min, 4 min e depois 5 min. Item novo na fila (ou voltar ao app) recomeça do 15 s.
 */
export const ESPERA_FILA_INICIAL_MS = 15_000;
export const ESPERA_FILA_MAXIMA_MS = 5 * 60_000;

/** Espera antes da próxima tentativa, dado o número de tentativas já feitas desde o último sucesso. */
export function proximaEsperaFila(tentativas: number): number {
  const n = Number.isFinite(tentativas) && tentativas > 0 ? Math.floor(tentativas) : 0;
  return Math.min(ESPERA_FILA_MAXIMA_MS, ESPERA_FILA_INICIAL_MS * 2 ** Math.min(n, 10));
}
