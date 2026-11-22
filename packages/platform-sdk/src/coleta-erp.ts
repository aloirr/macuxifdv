/**
 * Limites de plataforma da busca na API do ERP (Conector tipo `nuvem`; desenho `docs/desenho/integracao-modelos-erp.md`
 * §2.3; ADR 0066 D3; RN-INT-17 proposta). Puro TypeScript. O plano de coleta, a frequência de cada entidade e a janela de
 * sobreposição são do `domain` do módulo integracao (fatia F3); aqui ficam só o piso e os tetos que a plataforma impõe.
 */
import { INTERVALO_MINIMO_TAREFA_MIN } from './api';

/** Piso da frequência de coleta por entidade: o mesmo da tarefa periódica (RN-CORE-23, ADR 0022). Sem exceção (D3). */
export const FREQUENCIA_MINIMA_COLETA_MIN = INTERVALO_MINIMO_TAREFA_MIN;

/** Teto: 1 vez por dia. A carga completa semanal (§2.3 item 4) é um modo à parte, não uma frequência. */
export const FREQUENCIA_MAXIMA_COLETA_MIN = 24 * 60;

/** Tetos por Conector `nuvem` (§2.3 item 6). Os parâmetros do tenant só podem baixar estes valores. */
export const LIMITES_COLETA_ERP = {
  chamadasPorMinutoPorConector: 60,
  timeoutChamadaMs: 30_000,
  coletasSimultaneasPorConector: 1,
  linhasPorLote: 5_000,
  paginaMinima: 100,
  paginaMaxima: 500,
  bytesRespostaMaximo: 20 * 1024 * 1024,
} as const;

/**
 * Problema da frequência de coleta (null = válida): inteiro, múltiplo de 15 min, de 15 min a 1 dia. O agendador acorda a
 * cada 15 min, então outro valor não teria efeito real (RN-CORE-23).
 */
export function problemaFrequenciaColeta(minutos: number): string | null {
  if (!Number.isInteger(minutos)) return 'a frequência de coleta precisa ser um número inteiro de minutos';
  if (minutos < FREQUENCIA_MINIMA_COLETA_MIN) return `a frequência de coleta mínima é de ${FREQUENCIA_MINIMA_COLETA_MIN} min (RN-CORE-23)`;
  if (minutos > FREQUENCIA_MAXIMA_COLETA_MIN) return `a frequência de coleta máxima é de ${FREQUENCIA_MAXIMA_COLETA_MIN} min (1 dia)`;
  if (minutos % FREQUENCIA_MINIMA_COLETA_MIN !== 0) return `a frequência de coleta precisa ser múltipla de ${FREQUENCIA_MINIMA_COLETA_MIN} min (RN-CORE-23)`;
  return null;
}
