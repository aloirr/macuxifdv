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

export type ResultadoCheckout = 'atendido' | 'pedido' | 'sem_pedido' | 'cliente_fechado';

export interface EntradaCheckoutVisita {
  resultado: ResultadoCheckout | null;
  /** O módulo Vendedor está efetivo para o usuário (RN-CORE-01/03): decide se há "pedido / sem pedido". */
  vendedorEfetivo: boolean;
  /** Motivo de não venda informado (id da lista ou texto). */
  temMotivo: boolean;
  /** Motivo escolhido é do tipo `cliente_fechado` (lista fechada do core). */
  motivoClienteFechado: boolean;
  fotoFachada: boolean;
  temPedido: boolean;
  etapas: EtapaCheckoutAvaliavel[];
}

/**
 * Checkout da visita com o `resultado` do contrato novo (`CheckoutVisitaSchema`):
 * - RN-CORE-12: com Vendedor efetivo o resultado é `pedido` ou `sem_pedido` (esta exige motivo); sem Vendedor (promotor) é `atendido`;
 *   etapas obrigatórias dos módulos ativos precisam estar cumpridas.
 * - RN-CORE-14: `cliente_fechado` exige motivo da lista fechada + foto da fachada e DISPENSA as etapas obrigatórias.
 * Pendências: 'resultado', 'motivo', 'pedido', 'foto_fachada' ou o rótulo da etapa.
 */
export function avaliarCheckoutVisita(e: EntradaCheckoutVisita): AvaliacaoCheckout {
  if (e.resultado === null) return { pode: false, pendencias: ['resultado'], etapasDispensadas: false };
  if (e.resultado === 'cliente_fechado') {
    const pendencias: string[] = [];
    if (!e.motivoClienteFechado) pendencias.push('motivo');
    if (!e.fotoFachada) pendencias.push('foto_fachada');
    return { pode: pendencias.length === 0, pendencias, etapasDispensadas: true };
  }
  const pendencias: string[] = [];
  if (e.vendedorEfetivo) {
    if (e.resultado === 'atendido') pendencias.push('resultado');
    if (e.resultado === 'pedido' && !e.temPedido) pendencias.push('pedido');
    if (e.resultado === 'sem_pedido' && !e.temMotivo) pendencias.push('motivo');
  } else if (e.resultado === 'pedido' || e.resultado === 'sem_pedido') {
    pendencias.push('resultado'); // sem Vendedor efetivo não há pedido a registrar
  }
  for (const et of e.etapas) if (et.obrigatoria && !et.concluida) pendencias.push(et.rotulo);
  return { pode: pendencias.length === 0, pendencias, etapasDispensadas: false };
}
