/**
 * Regras do checkout (RN-CORE-12 e RN-CORE-14). Função pura, igual no app (offline) e na API.
 *
 * - RN-CORE-12: etapas obrigatórias dos módulos ativos precisam estar cumpridas; sem pedido exige motivo.
 * - RN-CORE-14: cliente fechado (`loja_fechada`, `acesso_negado`) exige foto da fachada e DISPENSA todas as etapas obrigatórias.
 * Os literais espelham `MOTIVOS_NAO_ATENDIMENTO` de `contracts` (o domain não importa contracts).
 */
export const MOTIVOS_CLIENTE_FECHADO = ['loja_fechada', 'acesso_negado'] as const;

export function ehClienteFechado(motivo: string | null | undefined): boolean {
  return motivo != null && (MOTIVOS_CLIENTE_FECHADO as readonly string[]).includes(motivo);
}

export interface EtapaCheckoutAvaliavel {
  rotulo: string;
  obrigatoria: boolean;
  concluida: boolean;
}

export interface EntradaCheckout {
  resultado: 'order' | 'no_order' | null;
  motivo: string | null;
  fotoFachada: boolean;
  etapas: EtapaCheckoutAvaliavel[];
}

export interface AvaliacaoCheckout {
  pode: boolean;
  /** 'motivo', 'foto_fachada', 'resultado' ou o rótulo da etapa obrigatória pendente. */
  pendencias: string[];
  etapasDispensadas: boolean;
}

export function avaliarCheckout(e: EntradaCheckout): AvaliacaoCheckout {
  if (e.resultado === null) return { pode: false, pendencias: ['resultado'], etapasDispensadas: false };
  const fechado = e.resultado === 'no_order' && ehClienteFechado(e.motivo);
  if (fechado) {
    const pendencias = e.fotoFachada ? [] : ['foto_fachada'];
    return { pode: pendencias.length === 0, pendencias, etapasDispensadas: true };
  }
  const pendencias: string[] = [];
  if (e.resultado === 'no_order' && !e.motivo) pendencias.push('motivo');
  for (const et of e.etapas) if (et.obrigatoria && !et.concluida) pendencias.push(et.rotulo);
  return { pode: pendencias.length === 0, pendencias, etapasDispensadas: false };
}
