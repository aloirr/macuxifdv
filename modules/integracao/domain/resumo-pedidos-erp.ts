import type { MonitorResumo, ResumoPedidosErp } from '../contracts';

/**
 * RN-INT-08 / T-0173: os 5 números dos cards de BKO > Pedidos a partir do resumo do monitor. Na fila = `pendente`; Entregue ao
 * Conector = `enviado`; Rejeitado pelo ERP = `rejeitado_erp`; Presos sem retorno e Retidos sem mapeamento vêm contados à parte.
 */
export function resumoPedidosErp(p: MonitorResumo['pedidos']): ResumoPedidosErp {
  return {
    na_fila: p.por_estado.pendente ?? 0,
    entregue_ao_conector: p.por_estado.enviado ?? 0,
    rejeitado_pelo_erp: p.por_estado.rejeitado_erp ?? 0,
    presos_sem_retorno: p.presos,
    retidos_sem_mapeamento: p.retidos,
  };
}
