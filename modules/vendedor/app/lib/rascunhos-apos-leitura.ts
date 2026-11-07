/**
 * Rascunhos depois de uma leitura do repositório (T-0089, R1): a leitura pode ter começado ANTES do toque no +/−. Se a geração
 * dos rascunhos mudou desde o início da leitura, ou ainda há gravação em andamento, os rascunhos da memória valem; senão, os lidos.
 */
export function rascunhosAposLeitura<R>(e: { lidos: Record<string, R>; memoria: Record<string, R>; geracaoAntes: number; geracaoAgora: number; emAndamento: number }): Record<string, R> {
  return e.geracaoAgora !== e.geracaoAntes || e.emAndamento > 0 ? e.memoria : e.lidos;
}
