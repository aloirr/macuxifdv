/** Checklist do dia por loja (RF-PRO-02) e bloqueio de checkout (RN-PRO-06). */
import type { ContextoCheckout } from '@macuxi/core/contracts';
import { arredondar } from './numeros';

export interface EtapaChecklist {
  id: string;
  rotulo: string;
  obrigatoria: boolean;
  concluida: boolean;
}

export interface ProgressoChecklist {
  total: number;
  concluidas: number;
  pendentes: EtapaChecklist[];
  obrigatorias_pendentes: EtapaChecklist[];
  pct_concluido: number;
}

export function progressoChecklist(etapas: readonly EtapaChecklist[]): ProgressoChecklist {
  const pendentes = etapas.filter((e) => !e.concluida);
  const concluidas = etapas.length - pendentes.length;
  return {
    total: etapas.length,
    concluidas,
    pendentes,
    obrigatorias_pendentes: pendentes.filter((e) => e.obrigatoria),
    pct_concluido: etapas.length === 0 ? 100 : arredondar((concluidas / etapas.length) * 100),
  };
}

export const DESFECHOS_VISITA = ['realizada', 'loja_fechada', 'acesso_negado'] as const;
export type DesfechoVisita = (typeof DESFECHOS_VISITA)[number];

export interface AvaliacaoCheckout {
  pode: boolean;
  /** Rótulos das etapas obrigatórias pendentes. */
  pendentes: string[];
  /** Mensagem em português com a ação seguinte; `null` quando o checkout está liberado. */
  motivo_bloqueio: string | null;
}

/**
 * RN-PRO-06: o checkout exige as etapas obrigatórias do checklist da loja, exceto cliente fechado.
 * A regra de cliente fechado (motivos, foto da fachada) é única e vive no core (RN-CORE-14): aqui só se
 * consome `clienteFechado` do `ContextoCheckout`; a exigência da foto é validada pelo core.
 */
export function avaliarCheckout(e: {
  contexto: Pick<ContextoCheckout, 'clienteFechado' | 'motivoClienteFechado'>;
  etapas: readonly EtapaChecklist[];
}): AvaliacaoCheckout {
  if (e.contexto.clienteFechado === true) return { pode: true, pendentes: [], motivo_bloqueio: null };
  const pendentes = progressoChecklist(e.etapas).obrigatorias_pendentes.map((x) => x.rotulo);
  if (pendentes.length > 0) {
    return { pode: false, pendentes, motivo_bloqueio: `Faltam etapas obrigatórias: ${pendentes.join('; ')}. Conclua-as para fazer o checkout.` };
  }
  return { pode: true, pendentes: [], motivo_bloqueio: null };
}
