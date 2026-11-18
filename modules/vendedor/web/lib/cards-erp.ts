/**
 * Cards "Pedidos no ERP" no início da lista de Pedidos do BKO (T-0173; RN-INT-08, RN-VEN-42; spec em
 * docs/design/integracao-simples/README.md §8). Funções puras: os números vêm de `MonitorResumo.resumo_pedidos` (contrato do
 * módulo Integração) e os cards são só informativos (sem clique e sem filtro).
 */
import { formatInt } from '@macuxi/ui/web';
import type { ResumoPedidosErp } from '@macuxi/integracao/contracts';

export type IdCardErp = 'na_fila' | 'entregue' | 'rejeitado' | 'presos' | 'retidos';
export interface CardErp {
  id: IdCardErp;
  rotulo: string;
  valor: number;
  /** número formatado em pt-BR (1.234) */
  texto: string;
  /** cor do número; só quando maior que zero */
  tom?: 'danger' | 'warning';
}

/** RN-INT-08: os 5 números já vêm prontos da Integração; aqui só rótulo, ordem, formatação e tom (RN-VEN-42). */
export function cardsPedidosErp(r: ResumoPedidosErp): CardErp[] {
  const com = (valor: number, tom: 'danger' | 'warning') => (valor > 0 ? tom : undefined);
  const card = (c: Omit<CardErp, 'texto'>): CardErp => ({ ...c, texto: formatInt(c.valor) });
  return [
    card({ id: 'na_fila', rotulo: 'Na fila', valor: r.na_fila }),
    card({ id: 'entregue', rotulo: 'Entregue ao Conector', valor: r.entregue_ao_conector }),
    card({ id: 'rejeitado', rotulo: 'Rejeitado pelo ERP', valor: r.rejeitado_pelo_erp, tom: com(r.rejeitado_pelo_erp, 'danger') }),
    card({ id: 'presos', rotulo: 'Presos sem retorno', valor: r.presos_sem_retorno, tom: com(r.presos_sem_retorno, 'danger') }),
    card({ id: 'retidos', rotulo: 'Retidos sem mapeamento', valor: r.retidos_sem_mapeamento, tom: com(r.retidos_sem_mapeamento, 'warning') }),
  ];
}
