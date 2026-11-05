/**
 * Selo do orçamento na linha da lista de Pedidos (T-0071, V7): os mesmos textos do detalhe ("Orçamento · até 10/11", "Vencido",
 * "Cancelado", "Virou pedido 000015"), calculados no aparelho pela validade (RN-VEN-18). Pedido comum não tem selo (sai o status).
 */
import type { PedidoDaLista } from './pedidos';
import { situacaoNaTela, validadeCivilDoDocumento } from './pre-venda';
import { seloDoOrcamento } from './textos-pedido';

export function seloDaLinha(o: PedidoDaLista, p: { agora: Date; fuso: string; dias: number; numeroDoPedido: (id: string) => string | null }): { texto: string; tom: 'roxo' | 'neutro' | 'sucesso' } | null {
  const situacao = situacaoNaTela(o, p.agora);
  if (!situacao) return null;
  const validade = validadeCivilDoDocumento({ validade_data: o.validade_data ?? null, validade_ate: o.validade_ate ?? null, criado_em: o.received_at ?? null }, { fuso: p.fuso, dias: p.dias });
  if (!validade) return { texto: situacao === 'aberto' ? 'Orçamento' : situacao === 'expirado' ? 'Vencido' : situacao === 'cancelado' ? 'Cancelado' : 'Virou pedido', tom: 'neutro' };
  return seloDoOrcamento({ situacao, validade_data: validade, pedido_numero: o.convertido_pedido_id ? p.numeroDoPedido(o.convertido_pedido_id) : null });
}
