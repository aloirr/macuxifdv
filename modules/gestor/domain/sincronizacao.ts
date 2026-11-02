/**
 * RN-CORE-23 (doc 03): ritmo da atualização automática e proteção do "puxar para baixo", para as telas do Gestor.
 * A atualização do app é do motor de sync da plataforma (agendado pelo shell); aqui só os números que a tela usa:
 * o intervalo do BKO (painel de aprovação, item 6) e a trava de 30 s contra toques repetidos (item 5).
 */

/** `sync_auto_min` padrão (doc 03, tabela de parâmetros). */
export const INTERVALO_PADRAO_MIN = 30;
/** Nenhum timer automático abaixo de 15 min no app e no BKO. */
export const INTERVALO_MINIMO_MIN = 15;
/** Item 5: puxar para baixo = Sincronizar, com proteção de 30 s contra toques repetidos. */
export const PROTECAO_PUXAR_MS = 30_000;

/** Intervalo em ms a partir do parâmetro cru `sync_auto_min` (inválido = padrão; abaixo do mínimo = mínimo). */
export function intervaloAutomaticoMs(syncAutoMin: unknown): number {
  const n = typeof syncAutoMin === 'number' && Number.isFinite(syncAutoMin) && syncAutoMin > 0 ? syncAutoMin : INTERVALO_PADRAO_MIN;
  return Math.max(INTERVALO_MINIMO_MIN, n) * 60_000;
}

/** Item 5: só sincroniza de novo se a última vez pelo puxar foi há 30 s ou mais (`null` = nunca). */
export function podeSincronizarAgora(ultimoMs: number | null, agoraMs: number): boolean {
  return ultimoMs === null || agoraMs - ultimoMs >= PROTECAO_PUXAR_MS;
}
