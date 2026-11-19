import { describe, expect, it } from 'vitest';
import type { OrderDetail } from '../../contracts';
import { aplicarDecisaoNoDetalhe, corpoDaDecisaoNoApp } from './decisao-pedido';

const ap = (motivo: 'credito' | 'desconto', estado: 'pendente' | 'aprovada') => ({ motivo, nivel: 'gerente' as const, estado, texto_pendencia: '', decidida_por_id: null, decidida_em: null, texto_decisao: null });
const detalhe = { id: 'p1', status: 'pending_approval', nivel_aprovacao: 'gerente', pode_decidir: true, pending_reason: 'x', approval_reasons: ['credito', 'desconto'], items: [], history: [] } as unknown as OrderDetail;

describe('RN-VEN-30 (T-0184): o app aplica a resposta das rotas de decisão ao detalhe', () => {
  it('RN-GES-08: aprovar leva só o comentário; rejeitar (devolver) leva o texto', () => {
    expect(corpoDaDecisaoNoApp('aprovar', ' ok ')).toEqual({ comentario: 'ok' });
    expect(corpoDaDecisaoNoApp('aprovar', '')).toEqual({});
    expect(corpoDaDecisaoNoApp('rejeitar', ' sem verba ')).toEqual({ texto: 'sem verba' });
  });
  it('P7 A: aprovação parcial deixa o pedido em aprovação, com as pendentes que restam', () => {
    const d = aplicarDecisaoNoDetalhe(detalhe, { status: 'pending_approval', aprovacoes: [ap('credito', 'aprovada'), ap('desconto', 'pendente')] });
    expect(d).toMatchObject({ status: 'pending_approval', approval_reasons: ['desconto'], aprovacoes: expect.any(Array) });
  });
  it('P7 A: todas aprovadas leva o pedido a aprovado e tira a decisão pendente', () => {
    const d = aplicarDecisaoNoDetalhe(detalhe, { status: 'approved', aprovacoes: [ap('credito', 'aprovada'), ap('desconto', 'aprovada')] });
    expect(d).toMatchObject({ status: 'approved', nivel_aprovacao: null, pode_decidir: false, pending_reason: '' });
    expect(d.approval_reasons).toBeUndefined();
  });
});
