/**
 * RN-CORE-23 item 5: "puxar para baixo" = Sincronizar, com proteção de 30 s contra toques repetidos. Puro (sem relógio
 * próprio): quem chama passa o instante do último sync manual e o de agora (ms).
 */
export const PROTECAO_SYNC_MANUAL_MS = 30_000;

export function podeSincronizarManual(ultimoMs: number, agoraMs: number): boolean {
  return ultimoMs <= 0 || agoraMs - ultimoMs >= PROTECAO_SYNC_MANUAL_MS || agoraMs < ultimoMs;
}
