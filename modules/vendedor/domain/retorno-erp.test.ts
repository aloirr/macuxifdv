/**
 * T-0053: retorno do ERP aplicado ao pedido (consumo de `integracao.pedido.retorno_erp@1`). Funções puras; instantes
 * fixos só como dado (nenhuma comparação com o relógio real).
 */
import { describe, expect, it } from 'vitest';
import { ORDER_STATUSES, type OrderStatus } from './order';
import { itensFaturadosDoRetorno, planejarRetornoErp, type RetornoErpEntrada } from './retorno-erp';

const EM = '2026-11-02T13:00:00.000Z';
const ret = (status: string, extra: Partial<RetornoErpEntrada> = {}): RetornoErpEntrada => ({ status, numero_erp: 'P-778', motivo: null, ocorrido_em: EM, itens_faturados: null, ...extra });

describe('RN-VEN-30 / RN-INT-08: retorno do ERP → status do pedido', () => {
  it.each<[OrderStatus, OrderStatus]>([
    ['approved', 'integrated'],
    ['sent_to_erp', 'integrated'],
  ])('RN-VEN-30: integrado em %s → %s, com o número do ERP', (de, para) => {
    const p = planejarRetornoErp(de, ret('integrado'));
    expect(p).toMatchObject({ acao: 'aplicar', de, para, muda_status: true, numero_erp: 'P-778', faturar: false });
    if (p.acao === 'aplicar') expect(p.texto_historico).toMatch(/ERP/);
  });

  it('RN-VEN-30: enviado (entregue ao Conector) leva aprovado a enviado ao ERP', () => {
    expect(planejarRetornoErp('approved', ret('enviado', { numero_erp: null }))).toMatchObject({ acao: 'aplicar', para: 'sent_to_erp', numero_erp: null });
    expect(planejarRetornoErp('integrated', ret('enviado'))).toMatchObject({ acao: 'ignorar', motivo: 'repetido_ou_atrasado' });
  });

  it('RN-INT-08: pendente é estado só do Hub e não muda o pedido', () => {
    expect(planejarRetornoErp('approved', ret('pendente'))).toEqual({ acao: 'ignorar', motivo: 'status_do_hub' });
  });

  it('RN-VEN-30: integrado repetido ou depois do faturamento não volta o status (a ordem dos eventos não é garantida)', () => {
    for (const s of ['integrated', 'invoiced_partial', 'invoiced'] as const) {
      expect(planejarRetornoErp(s, ret('integrado'))).toMatchObject({ acao: 'ignorar', motivo: 'repetido_ou_atrasado' });
    }
  });

  it('RN-INT-08: retorno de pedido que nunca foi para a fila é ignorado (só aprovado entra)', () => {
    for (const s of ['draft', 'queued', 'received', 'pending_approval'] as const) {
      expect(planejarRetornoErp(s, ret('integrado'))).toMatchObject({ acao: 'ignorar', motivo: 'pedido_nao_enviado' });
    }
  });

  it('RN-VEN-30: faturado parcial muda o status uma vez; a 2ª nota parcial fatura sem mudar o status', () => {
    expect(planejarRetornoErp('integrated', ret('faturado_parcial'))).toMatchObject({ acao: 'aplicar', para: 'invoiced_partial', muda_status: true, faturar: true });
    expect(planejarRetornoErp('approved', ret('faturado_parcial'))).toMatchObject({ acao: 'aplicar', para: 'invoiced_partial', muda_status: true });
    expect(planejarRetornoErp('invoiced_partial', ret('faturado_parcial'))).toMatchObject({ acao: 'aplicar', para: 'invoiced_partial', muda_status: false, faturar: true });
    expect(planejarRetornoErp('invoiced', ret('faturado_parcial'))).toMatchObject({ acao: 'ignorar', motivo: 'repetido_ou_atrasado' });
  });

  it('RN-VEN-30: faturado total fecha o pedido; repetido é ignorado', () => {
    for (const s of ['approved', 'sent_to_erp', 'integrated', 'invoiced_partial'] as const) {
      expect(planejarRetornoErp(s, ret('faturado_total'))).toMatchObject({ acao: 'aplicar', para: 'invoiced', muda_status: true, faturar: true });
    }
    expect(planejarRetornoErp('invoiced', ret('faturado_total'))).toMatchObject({ acao: 'ignorar', motivo: 'repetido_ou_atrasado' });
  });

  it('RN-INT-08: rejeitado pelo ERP vira rejeitado com o motivo do ERP (motivo de 3+ caracteres, RN-GES-08)', () => {
    const p = planejarRetornoErp('sent_to_erp', ret('rejeitado_erp', { numero_erp: null, motivo: 'CNPJ sem inscrição' }));
    expect(p).toMatchObject({ acao: 'aplicar', para: 'rejected', motivo_rejeicao: 'Recusado pelo ERP: CNPJ sem inscrição' });
    const semMotivo = planejarRetornoErp('approved', ret('rejeitado_erp', { motivo: null }));
    expect(semMotivo.acao === 'aplicar' && semMotivo.motivo_rejeicao!.length).toBeGreaterThanOrEqual(3);
    expect(planejarRetornoErp('integrated', ret('rejeitado_erp', { motivo: 'x' }))).toMatchObject({ acao: 'ignorar', motivo: 'repetido_ou_atrasado' });
  });

  it('decisão do Alexandre (R-20261031-100601, opção b): cancelado vem só do ERP e vale do aprovado em diante', () => {
    for (const s of ['approved', 'sent_to_erp', 'integrated', 'invoiced_partial', 'invoiced', 'rejected'] as const) {
      expect(planejarRetornoErp(s, ret('cancelado', { motivo: 'cliente desistiu' }))).toMatchObject({ acao: 'aplicar', para: 'cancelled', motivo_cancelamento: 'Cancelado no ERP: cliente desistiu' });
    }
    expect(planejarRetornoErp('cancelled', ret('cancelado'))).toMatchObject({ acao: 'ignorar', motivo: 'repetido_ou_atrasado' });
    expect(planejarRetornoErp('pending_approval', ret('cancelado'))).toMatchObject({ acao: 'ignorar', motivo: 'pedido_nao_enviado' });
  });

  it('status desconhecido nunca muda o pedido', () => {
    expect(planejarRetornoErp('approved', ret('qualquer'))).toEqual({ acao: 'ignorar', motivo: 'status_desconhecido' });
  });

  it('todo plano aplicado leva a um status válido do contrato (ORDER_STATUSES)', () => {
    for (const de of ORDER_STATUSES) {
      for (const s of ['enviado', 'integrado', 'rejeitado_erp', 'faturado_parcial', 'faturado_total', 'cancelado']) {
        const p = planejarRetornoErp(de, ret(s, { motivo: 'm' }));
        if (p.acao === 'aplicar') {
          expect(ORDER_STATUSES).toContain(p.para);
          expect(p.muda_status).toBe(p.para !== de);
        }
      }
    }
  });
});

describe('RN-INT-08 / vendedor.pedido.faturado@1: itens faturados pela sequência do pedido enviado', () => {
  const itens = [
    { sequencia: 1, produto_id: 'p1', quantidade: 10 },
    { sequencia: 2, produto_id: 'p2', quantidade: 4 },
  ];

  it('itens_faturados do retorno: traduz a sequência para o produto do Macuxi', () => {
    expect(itensFaturadosDoRetorno('faturado_parcial', 'integrated', itens, [{ sequencia: 2, quantidade: 3 }])).toEqual({ base: 'itens_do_retorno', itens: [{ product_id: 'p2', quantity: 3 }] });
  });

  it('sequência que não existe no pedido fica de fora (o Hub já registrou o erro no monitor)', () => {
    expect(itensFaturadosDoRetorno('faturado_parcial', 'integrated', itens, [{ sequencia: 9, quantidade: 1 }])).toEqual({ base: 'sem_base', itens: [] });
  });

  it('faturado total sem itens e sem parcial antes: o pedido inteiro', () => {
    expect(itensFaturadosDoRetorno('faturado_total', 'integrated', itens, null)).toEqual({
      base: 'pedido_inteiro',
      itens: [{ product_id: 'p1', quantity: 10 }, { product_id: 'p2', quantity: 4 }],
    });
  });

  it('faturado total sem itens depois de parcial: o restante só com o acumulado (sem ele, não publica para não contar em dobro)', () => {
    expect(itensFaturadosDoRetorno('faturado_total', 'invoiced_partial', itens, null)).toEqual({ base: 'sem_base', itens: [] });
    expect(itensFaturadosDoRetorno('faturado_total', 'invoiced_partial', itens, null, [{ product_id: 'p1', quantity: 6 }])).toEqual({
      base: 'restante',
      itens: [{ product_id: 'p1', quantity: 4 }, { product_id: 'p2', quantity: 4 }],
    });
  });

  it('faturado parcial sem itens: sem base (não inventa quantidade)', () => {
    expect(itensFaturadosDoRetorno('faturado_parcial', 'integrated', itens, null)).toEqual({ base: 'sem_base', itens: [] });
  });
});
