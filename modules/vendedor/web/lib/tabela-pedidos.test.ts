import { describe, expect, it } from 'vitest';
import type { Order } from '../../contracts';
import { ACOES_DO_PENDENTE, acoesDoPedido, COLUNAS_DA_TABELA, corpoDaDecisao, DECISAO_REJEITAR_ENCERRA, motivoDoPedido, SEM_VALOR, textoOuTraco } from './tabela-pedidos';

const pedido = (over: Partial<Order> = {}): Order => ({
  id: 'o1', number: '000021', idempotency_key: 'o1', seller_id: 's1', seller_name: 'Carla Lima', customer_id: 'c1', customer_name: 'Mercado Bom Preço',
  branch_id: null, branch_name: null, price_table_id: null, discount_pct: 0, subtotal_cents: 100, discount_cents: 0, total_cents: 100, payment_terms: '',
  status: 'pending_approval', pending_reason: '', rejection_reason: '', erp_order_code: '', created_offline_at: null,
  received_at: '2026-11-18T13:12:00.000Z', updated_at: '2026-11-18T13:12:00.000Z', items_count: 1, units: 1, ...over,
});

describe('BKO > Pedidos: tabela simples (R-20261116-143000, R-20261118-214740)', () => {
  it('colunas na ordem aprovada na prancha 04: Código do cliente a Observação, Ações e Situação por último', () => {
    expect(COLUNAS_DA_TABELA.map((c) => c.titulo)).toEqual(['Código do cliente', 'Cliente', 'UF', 'Cidade', 'Nº', 'Vendedor', 'Supervisor', 'Recebido', 'Valor', 'Motivo', 'Observação do pedido', 'Ações', 'Situação']);
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
  it('RN-GES-08: Devolver ao vendedor rejeita (rota rejeitar, com motivo); Aprovar aprova', () => {
    const a = Object.fromEntries(ACOES_DO_PENDENTE.map((x) => [x.id, x]));
    expect(a.aprovar).toMatchObject({ rota: 'aprovar', exigeMotivo: false });
    expect(a.devolver).toMatchObject({ rota: 'rejeitar', exigeMotivo: true });
  });
  it('RN-VEN-30 (P6 A): Rejeitar encerra o pedido como Cancelado pela rota recusar, com motivo; está ligado', () => {
    expect(DECISAO_REJEITAR_ENCERRA).toEqual({ disponivel: true, rota: 'recusar' });
    expect(acoesDoPedido(pedido()).find((a) => a.id === 'rejeitar')).toMatchObject({ rota: 'recusar', exigeMotivo: true, desligada: false });
  });
  it('RN-GES-08: os corpos das rotas levam texto (devolver e recusar) e motivo opcional; aprovar vai vazio', () => {
    expect(corpoDaDecisao('aprovar', '')).toEqual({});
    expect(corpoDaDecisao('rejeitar', ' sem verba ')).toEqual({ texto: 'sem verba' });
    expect(corpoDaDecisao('recusar', 'cliente bloqueado')).toEqual({ texto: 'cliente bloqueado' });
  });
  it('P3 B: o motivo mostra o estado de cada aprovação decidida; pendente fica só com o nome', () => {
    const ap = (motivo: 'credito' | 'inadimplencia' | 'desconto', estado: 'pendente' | 'aprovada' | 'devolvida' | 'rejeitada' | 'encerrada') => ({ motivo, nivel: 'gerente' as const, estado, texto_pendencia: '', decidida_por_id: null, decidida_em: null, texto_decisao: null });
    expect(motivoDoPedido(pedido({ approval_reasons: ['credito'], aprovacoes: [ap('credito', 'pendente'), ap('inadimplencia', 'aprovada')] }))).toBe('Crédito, Inadimplente (aprovada)');
    expect(motivoDoPedido(pedido({ status: 'cancelled', aprovacoes: [ap('credito', 'rejeitada'), ap('desconto', 'encerrada')], effective_discount_pct: 12 }))).toBe('Crédito (rejeitada), Desconto 12% (encerrada)');
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
