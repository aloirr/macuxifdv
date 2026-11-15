/**
 * Cards "Pedidos no ERP" no início da lista de Pedidos do BKO (T-0173; RN-INT-08, RN-VEN-42; spec em
 * docs/design/integracao-simples/README.md §8). Funções puras: os números vêm de `MonitorResumo.pedidos` (contrato do
 * módulo Integração) e o card filtra a lista pelo status do pedido no Vendedor.
 */
import type { MonitorResumo } from '@macuxi/integracao/contracts';

export type IdCardErp = 'na_fila' | 'entregue' | 'rejeitado' | 'presos' | 'retidos';
export interface CardErp {
  id: IdCardErp;
  rotulo: string;
  valor: number;
  /** cor do número; só quando maior que zero */
  tom?: 'danger' | 'warning';
}

/** RN-INT-08: Integrado, Faturado parcial, Faturado e Cancelado ficam fora (a coluna Situação já mostra). */
export function cardsPedidosErp(p: MonitorResumo['pedidos']): CardErp[] {
  const n = (e: keyof MonitorResumo['pedidos']['por_estado']) => p.por_estado[e] ?? 0;
  const com = (valor: number, tom: 'danger' | 'warning') => (valor > 0 ? tom : undefined);
  return [
    { id: 'na_fila', rotulo: 'Na fila', valor: n('pendente') },
    { id: 'entregue', rotulo: 'Entregue ao Conector', valor: n('enviado') },
    { id: 'rejeitado', rotulo: 'Rejeitado pelo ERP', valor: n('rejeitado_erp'), tom: com(n('rejeitado_erp'), 'danger') },
    { id: 'presos', rotulo: 'Presos sem retorno', valor: p.presos, tom: com(p.presos, 'danger') },
    { id: 'retidos', rotulo: 'Retidos sem mapeamento', valor: p.retidos, tom: com(p.retidos, 'warning') },
  ];
}

const STATUS_DO_CARD: Record<IdCardErp, string> = {
  na_fila: 'approved',
  entregue: 'sent_to_erp',
  rejeitado: 'rejected',
  presos: 'sent_to_erp',
  retidos: 'approved',
};

/** Status da lista ao clicar no card; clicar no card já ativo volta a "Todas". */
export function statusDoCard(id: IdCardErp, statusAtual: string): string {
  const alvo = STATUS_DO_CARD[id];
  return alvo === statusAtual ? '' : alvo;
}
