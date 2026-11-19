import { describe, expect, it } from 'vitest';
import { ROTA_DA_DECISAO, type Order } from '../../contracts';
import { ACOES_DO_PENDENTE, acoesDoPedido, COLUNAS_DA_TABELA, motivoDoPedido, SEM_VALOR, textoOuTraco } from './tabela-pedidos';

const pedido = (over: Partial<Order> = {}): Order => ({
  id: 'o1', number: '000021', idempotency_key: 'o1', seller_id: 's1', seller_name: 'Carla Lima', customer_id: 'c1', customer_name: 'Mercado Bom Preço',
  branch_id: null, branch_name: null, price_table_id: null, discount_pct: 0, subtotal_cents: 100, discount_cents: 0, total_cents: 100, payment_terms: '',
  status: 'pending_approval', pending_reason: '', rejection_reason: '', erp_order_code: '', created_offline_at: null,
  received_at: '2026-11-18T13:12:00.000Z', updated_at: '2026-11-18T13:12:00.000Z', items_count: 1, units: 1, ...over,
});

describe('BKO > Pedidos: tabela simples (R-20261116-143000, R-20261118-214740)', () => {
  it('colunas na ordem aprovada na prancha 04: Código do cliente a Observação, Situação e Ações por último (Ações na ponta, MC-1760)', () => {
    expect(COLUNAS_DA_TABELA.map((c) => c.titulo)).toEqual(['Código do cliente', 'Cliente', 'UF', 'Cidade', 'Nº', 'Vendedor', 'Supervisor', 'Recebido', 'Valor', 'Motivo', 'Observação do pedido', 'Situação', 'Ações']);
  });
  it('largura menor: Código e Cliente fixos à esquerda; Ações e Situação fixos à direita', () => {
    const fixas = Object.fromEntries(COLUNAS_DA_TABELA.filter((c) => c.fixa).map((c) => [c.titulo, c.fixa]));
    expect(fixas).toEqual({ 'Código do cliente': 'esquerda', Cliente: 'esquerda', Ações: 'direita', Situação: 'direita' });
  });
  it('RF-VEN-09: Ações só no pedido aguardando aprovação; nos outros status a célula fica vazia', () => {
    expect(acoesDoPedido(pedido()).map((a) => a.rotulo)).toEqual(['Aprovar', 'Rejeitar', 'Devolver ao vendedor']);
    for (const status of ['received', 'approved', 'integrated', 'rejected', 'cancelled', 'invoiced'] as const) expect(acoesDoPedido(pedido({ status }))).toEqual([]);
  });
  it('RN-GES-04: quem não pode decidir o nível do pedido não recebe ações', () => {
    expect(acoesDoPedido(pedido({ pode_decidir: false }))).toEqual([]);
    expect(acoesDoPedido(pedido({ pode_decidir: true })).length).toBe(3);
  });
  it('RN-GES-08 e P6 A: Aprovar aprova; Devolver ao vendedor devolve (rota rejeitar) e Rejeitar encerra como Cancelado (rota recusar), os dois com motivo', () => {
    const a = Object.fromEntries(ACOES_DO_PENDENTE.map((x) => [x.id, x]));
    expect(a.aprovar).toMatchObject({ decisao: 'aprovar' });
    expect(a.devolver).toMatchObject({ decisao: 'devolver' });
    expect(a.rejeitar).toMatchObject({ decisao: 'recusar' });
    expect(ACOES_DO_PENDENTE.map((x) => ROTA_DA_DECISAO[x.decisao])).toEqual(['aprovar', 'recusar', 'rejeitar']);
  });
  it('RN-VEN-30 (T-0184, prancha 04): a coluna Motivo lista os motivos sem repetir o estado, que a Situação já diz', () => {
    const ap = (motivo: 'credito' | 'inadimplencia' | 'desconto', estado: 'pendente' | 'aprovada' | 'devolvida' | 'rejeitada' | 'encerrada') => ({ motivo, nivel: 'gerente' as const, estado, texto_pendencia: '', decidida_por_id: null, decidida_em: null, texto_decisao: null });
    expect(motivoDoPedido(pedido({ approval_reasons: ['credito'], aprovacoes: [ap('credito', 'pendente'), ap('inadimplencia', 'aprovada')] }))).toBe('Crédito, Inadimplente');
    expect(motivoDoPedido(pedido({ status: 'cancelled', aprovacoes: [ap('credito', 'rejeitada'), ap('desconto', 'encerrada')], effective_discount_pct: 12 }))).toBe('Crédito, Desconto 12%');
  });
  it('Motivo: Crédito, Desconto com o %, vários separados por vírgula; vazio = traço', () => {
    expect(motivoDoPedido(pedido({ approval_reasons: ['credito'] }))).toBe('Crédito');
    expect(motivoDoPedido(pedido({ approval_reasons: ['desconto'], effective_discount_pct: 12 }))).toBe('Desconto 12%');
    expect(motivoDoPedido(pedido({ approval_reasons: ['desconto'], effective_discount_pct: 8.8 }))).toBe('Desconto 8,8%');
    expect(motivoDoPedido(pedido({ approval_reasons: ['credito', 'desconto'], effective_discount_pct: 12 }))).toBe('Crédito, Desconto 12%');
    expect(motivoDoPedido(pedido({ status: 'approved', approval_reasons: [] }))).toBe(SEM_VALOR);
    expect(motivoDoPedido(pedido({ status: 'approved' }))).toBe(SEM_VALOR);
  });
  it('célula vazia mostra traço, como nas outras tabelas do BKO', () => {
    expect(textoOuTraco('')).toBe('—');
    expect(textoOuTraco(null)).toBe('—');
    expect(textoOuTraco('  ')).toBe('—');
    expect(textoOuTraco('Entregar pela manhã')).toBe('Entregar pela manhã');
  });
});
