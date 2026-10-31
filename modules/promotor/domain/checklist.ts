/** Checklist do dia por loja (RF-PRO-02) e bloqueio de checkout (RN-PRO-06). */
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
 * RN-PRO-06: o checkout exige as etapas obrigatórias do checklist, exceto "loja fechada" ou "acesso negado",
 * que exigem a foto da fachada (e dispensam o checklist).
 */
export function avaliarCheckout(e: { desfecho: DesfechoVisita; etapas: readonly EtapaChecklist[]; tem_foto_fachada: boolean }): AvaliacaoCheckout {
  if (e.desfecho === 'loja_fechada' || e.desfecho === 'acesso_negado') {
    if (!e.tem_foto_fachada) {
      return { pode: false, pendentes: [], motivo_bloqueio: 'Tire a foto da fachada para registrar loja fechada ou acesso negado.' };
    }
    return { pode: true, pendentes: [], motivo_bloqueio: null };
  }
  const pendentes = progressoChecklist(e.etapas).obrigatorias_pendentes.map((x) => x.rotulo);
  if (pendentes.length > 0) {
    return { pode: false, pendentes, motivo_bloqueio: `Faltam etapas obrigatórias: ${pendentes.join('; ')}. Conclua-as para fazer o checkout.` };
  }
  return { pode: true, pendentes: [], motivo_bloqueio: null };
}
