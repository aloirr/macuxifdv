/**
 * RN-CORE-23 (docs/produto/03 seção 3; R-20261102-121135 e R-20261102-124413): números da sincronização, comuns ao app
 * (Campo e Gestão) e ao BKO. Parte pura: sem React, sem react-native, sem DOM.
 *
 * - `sync_auto_min` (parâmetro do tenant): atualização automática leve do app e do BKO, padrão 30 min, mínimo 15.
 * - Voltar ao primeiro plano dispara a verificação se a última sincronização tem 30 min ou mais.
 * - Puxar para baixo = Sincronizar; disparo manual no máximo 1 vez a cada 30 s, toques repetidos ignorados em silêncio (R-20261115-125500).
 * - Nenhum timer automático abaixo de 15 min no app e no BKO; a exceção é o envio da fila (só sobe o que está pendente).
 */

/** Nome do parâmetro do tenant (RN-CORE-23). */
export const PARAMETRO_SYNC_AUTO = 'sync_auto_min';
export const SYNC_AUTO_PADRAO_MIN = 30;
/** Abaixo de 15 min vale 15 (RN-CORE-23: carga no servidor com 10.000 aparelhos). */
export const SYNC_AUTO_MIN_MIN = 15;
/** Teto de segurança (1 dia): valores maiores estouram o temporizador do JavaScript (2^31 ms ≈ 24 dias) e não têm uso. */
export const SYNC_AUTO_MAX_MIN = 24 * 60;
/** Voltar ao primeiro plano dispara a verificação depois de 30 min sem sincronizar. */
export const VOLTA_PRIMEIRO_PLANO_MS = 30 * 60_000;
/**
 * Intervalo mínimo entre disparos manuais (R-20261115-125500): botão Sincronizar, puxar para baixo, selo e a completa
 * (segurar 10 s) disparam no máximo 1 vez a cada 30 s por aparelho. Toque dentro do intervalo é ignorado em silêncio
 * (nada visível: sem aviso, contador nem botão desabilitado). Regra interna, para aliviar o servidor.
 */
export const INTERVALO_MIN_SYNC_MANUAL_MS = 30_000;

/** Intervalo em ms a partir do valor do parâmetro (número ou texto). Inválido, ausente, 0 ou negativo → 30 min; abaixo de 15 → 15. */
export function intervaloSyncAutoMs(valor: unknown): number {
  const n = typeof valor === 'number' ? valor : typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : NaN;
  const min = Number.isFinite(n) && n > 0 ? Math.min(SYNC_AUTO_MAX_MIN, Math.max(SYNC_AUTO_MIN_MIN, n)) : SYNC_AUTO_PADRAO_MIN;
  return Math.round(min * 60_000);
}

/** `true` = o disparo manual anterior foi há menos de `INTERVALO_MIN_SYNC_MANUAL_MS` e este é ignorado em silêncio. */
export function dentroDoIntervaloManual(ultimoManual: number | null, agora: number): boolean {
  return ultimoManual !== null && agora - ultimoManual >= 0 && agora - ultimoManual < INTERVALO_MIN_SYNC_MANUAL_MS;
}
