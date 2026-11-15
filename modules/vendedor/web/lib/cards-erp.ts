/**
 * Cards "Pedidos no ERP" no início da lista de Pedidos do BKO (T-0173; RN-INT-08, RN-VEN-42; spec em
 * docs/design/integracao-simples/README.md §8). Funções puras: os números vêm de `MonitorResumo.pedidos` (contrato do
 * módulo Integração) e os cards são só informativos (sem clique e sem filtro).
 */
import { formatInt } from '@macuxi/ui/web';
import type { MonitorResumo } from '@macuxi/integracao/contracts';

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

/** RN-INT-08: Integrado, Faturado parcial, Faturado e Cancelado ficam fora (a coluna Situação já mostra). */
export function cardsPedidosErp(p: MonitorResumo['pedidos']): CardErp[] {
  const n = (e: keyof MonitorResumo['pedidos']['por_estado']) => p.por_estado[e] ?? 0;
  const com = (valor: number, tom: 'danger' | 'warning') => (valor > 0 ? tom : undefined);
  const card = (c: Omit<CardErp, 'texto'>): CardErp => ({ ...c, texto: formatInt(c.valor) });
  return [
    card({ id: 'na_fila', rotulo: 'Na fila', valor: n('pendente') }),
    card({ id: 'entregue', rotulo: 'Entregue ao Conector', valor: n('enviado') }),
    card({ id: 'rejeitado', rotulo: 'Rejeitado pelo ERP', valor: n('rejeitado_erp'), tom: com(n('rejeitado_erp'), 'danger') }),
    card({ id: 'presos', rotulo: 'Presos sem retorno', valor: p.presos, tom: com(p.presos, 'danger') }),
    card({ id: 'retidos', rotulo: 'Retidos sem mapeamento', valor: p.retidos, tom: com(p.retidos, 'warning') }),
  ];
}
