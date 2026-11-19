import { describe, expect, it } from 'vitest';
import { Order, OrderDetail } from '../contracts';
import { comNomesDosDecisores, paraAprovacaoMotivo, type LinhaAprovacao } from './aprovacoes';
import { paraDetalhe, paraOrder, type LinhaPedido } from './mapeamento';

const ID = '11111111-1111-4111-8111-111111111111';
const linha = (over: Partial<LinhaPedido> = {}): LinhaPedido => ({
  id: ID, numero: '000021', vendedor_id: '22222222-2222-4222-8222-222222222222', vendedor_nome: 'Carla Lima',
  cliente_id: '33333333-3333-4333-8333-333333333333', cliente_nome: 'Mercado Bom Preço', cliente_resumo: null,
  tabela_preco_id: null, condicao_pagamento: null, condicao_pagamento_descricao: null, status: 'pending_approval', desconto_pct: 12, total_tabela_cents: 1000, total_cents: 880,
  nivel_aprovacao: 'gerente', motivos_aprovacao: ['desconto', 'credito'], motivo_rejeicao: null, numero_erp: null, criado_no_aparelho_em: null, recebido_em: '2026-11-18T13:12:00.000Z',
  created_at: '2026-11-18T13:12:00.000Z', updated_at: '2026-11-18T13:12:00.000Z', itens: 1, unidades: 1, ...over,
});
const ap = (over: Partial<LinhaAprovacao>): LinhaAprovacao => ({ pedido_id: ID, ciclo: 1, motivo: 'desconto', nivel: 'supervisor', estado: 'pendente', texto_pendencia: 'Desconto de 12,0% acima da alçada de 5,0%: aguardando supervisor', decidida_por: null, decidida_em: null, texto_decisao: null, ...over });

describe('T-0184: a lista e o detalhe trazem o estado de cada motivo (aditivo)', () => {
  const linhas = [
    ap({}),
    ap({ motivo: 'credito', nivel: 'gerente', texto_pendencia: 'Cliente sem limite de crédito informado pelo ERP: aguardando gerente' }),
  ].map(paraAprovacaoMotivo);
  it('Order.aprovacoes lista as aprovações do ciclo; o pedido sem aprovação não traz o campo', () => {
    const o = paraOrder(linha(), {}, 'gerente', linhas);
    expect(o.aprovacoes).toHaveLength(2);
    expect(Order.safeParse(o).success).toBe(true);
    expect(paraOrder(linha(), {}, 'gerente').aprovacoes).toBeUndefined();
  });
  it('RN-VEN-10: pode_decidir é verdadeiro se o perfil decide pelo menos uma pendente; o nível é o maior pendente', () => {
    expect(paraOrder(linha({ nivel_aprovacao: 'gerente' }), {}, 'supervisor', linhas)).toMatchObject({ pode_decidir: true, nivel_aprovacao: 'gerente' });
    expect(paraOrder(linha(), {}, 'analista', linhas).pode_decidir).toBe(false);
  });
  it('RN-VEN-30: aprovada deixa de pesar no nível e no texto da pendência', () => {
    const l = [{ ...linhas[0]!, estado: 'aprovada' as const, decidida_por_id: ID, decidida_em: '2026-11-18T14:00:00.000Z' }, linhas[1]!];
    const o = paraOrder(linha(), {}, 'gerente', l);
    expect(o).toMatchObject({ nivel_aprovacao: 'gerente', pending_reason: 'Cliente sem limite de crédito informado pelo ERP: aguardando gerente', approval_reasons: ['credito'] });
  });
  it('detalhe: aprovacoes vão junto e o detalhe segue válido', () => {
    const d = paraDetalhe(linha(), [], [], 'gerente', {}, undefined, linhas);
    expect(d.aprovacoes).toHaveLength(2);
    expect(OrderDetail.safeParse(d).success).toBe(true);
  });
  it('T-0184: a aprovação decidida leva o nome de quem decidiu; a pendente não leva o campo', () => {
    const r = comNomesDosDecisores([ap({ estado: 'aprovada', decidida_por: ID, decidida_em: '2026-11-18T14:05:00.000Z' }), ap({ motivo: 'credito' }), ap({ motivo: 'inadimplencia', estado: 'aprovada', decidida_por: '9' })], new Map([[ID, 'Rui Matos']]));
    expect(r[0]?.decidida_por_nome).toBe('Rui Matos');
    expect(r[1]).not.toHaveProperty('decidida_por_nome');
    expect(r[2]?.decidida_por_nome).toBeNull();
  });
  it('a linha do banco vira AprovacaoMotivo com quem e quando decidiu', () => {
    expect(paraAprovacaoMotivo(ap({ estado: 'devolvida', decidida_por: ID, decidida_em: '2026-11-18T14:00:00.000Z', texto_decisao: 'baixe o desconto' }))).toMatchObject({ estado: 'devolvida', decidida_por_id: ID, texto_decisao: 'baixe o desconto' });
  });
});
