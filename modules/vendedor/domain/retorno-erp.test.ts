/**
 * Retorno do ERP no pedido (T-0053 status + T-0054 faturamento e devolução). Funções puras; instantes fixos só como dado
 * (nenhuma comparação com o relógio real).
 */
import { describe, expect, it } from 'vitest';
import { PedidoFaturadoEvento } from '../contracts/eventos';
import { ORDER_STATUSES, type OrderStatus } from './order';
import {
  camposFaturamento,
  textoItemFaturado,
  decidirNotaDevolucao,
  eventoFaturadoDosItens,
  itensDoFaturamento,
  planejarRetornoErp,
  resumoFaturamento,
  textoSituacaoFaturamento,
  type RetornoErpEntrada,
} from './retorno-erp';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const PED = '33333333-3333-4333-8333-333333333333';
const VEN = '44444444-4444-4444-8444-444444444444';
const OCORRIDO = '2026-10-30T15:00:00.000Z';
const itensPedido = [
  { sequencia: 1, product_id: P1, quantity: 10, total_cents: 10_000 },
  { sequencia: 2, product_id: P2, quantity: 4, total_cents: 2_000 },
];
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

describe('itensDoFaturamento — sequência → produto, limitado ao saldo (RN-INT-08, RN-TRE-08)', () => {
  it('RN-TRE-08: converte a sequência do retorno no produto do pedido', () => {
    const r = itensDoFaturamento('faturado_parcial', [{ sequencia: 1, quantidade: 6, valor_cents: 6_000 }], itensPedido, []);
    expect(r.itens).toEqual([{ sequencia: 1, product_id: P1, quantity: 6, valor_cents: 6_000 }]);
    expect(r.divergencias).toEqual([]);
  });

  it('RN-INT-08: sequência inexistente fica de fora e quantidade acima do saldo é limitada (divergência para o log)', () => {
    const r = itensDoFaturamento(
      'faturado_parcial',
      [{ sequencia: 9, quantidade: 1 }, { sequencia: 2, quantidade: 5, valor_cents: 2_500 }],
      itensPedido,
      [{ sequencia: 2, quantidade: 1 }],
    );
    expect(r.itens).toEqual([{ sequencia: 2, product_id: P2, quantity: 3, valor_cents: 2_500 }]);
    expect(r.divergencias).toEqual([
      { sequencia: 9, codigo: 'sequencia_inexistente', informada: 1, aceita: 0 },
      { sequencia: 2, codigo: 'acima_do_saldo', informada: 5, aceita: 3 },
    ]);
  });

  it('RN-INT-08: a mesma sequência repetida no retorno soma antes de limitar', () => {
    const r = itensDoFaturamento('faturado_parcial', [{ sequencia: 1, quantidade: 4 }, { sequencia: 1, quantidade: 3 }], itensPedido, []);
    expect(r.itens).toEqual([{ sequencia: 1, product_id: P1, quantity: 7, valor_cents: null }]);
  });

  it('RN-TRE-08: faturado_total sem itens fatura o saldo de cada sequência; parcial sem itens não fatura nada', () => {
    const total = itensDoFaturamento('faturado_total', null, itensPedido, [{ sequencia: 1, quantidade: 10 }, { sequencia: 2, quantidade: 1 }]);
    expect(total.itens).toEqual([{ sequencia: 2, product_id: P2, quantity: 3, valor_cents: null }]);
    expect(itensDoFaturamento('faturado_parcial', null, itensPedido, []).itens).toEqual([]);
    expect(itensDoFaturamento('faturado_parcial', [], itensPedido, []).itens).toEqual([]);
  });

  it('T-0053 (portado): sem a tabela do faturamento e com parcial antes (acumulado desconhecido), o total sem itens não fatura nada', () => {
    expect(itensDoFaturamento('faturado_total', null, itensPedido, null).itens).toEqual([]);
  });

  it('T-0053 (portado): sem parcial antes, o total sem itens é o pedido inteiro', () => {
    expect(itensDoFaturamento('faturado_total', null, itensPedido, []).itens.map((i) => [i.product_id, i.quantity])).toEqual([[P1, 10], [P2, 4]]);
  });

  it('T-0053 (portado): com acumulado desconhecido, os itens do retorno valem limitados à quantidade do pedido', () => {
    const r = itensDoFaturamento('faturado_total', [{ sequencia: 1, quantidade: 12 }], itensPedido, null);
    expect(r.itens).toEqual([{ sequencia: 1, product_id: P1, quantity: 10, valor_cents: null }]);
    expect(r.divergencias).toEqual([{ sequencia: 1, codigo: 'acima_do_saldo', informada: 12, aceita: 10 }]);
  });

  it('RN-TRE-08: faturado_total COM itens usa os itens do retorno (o ERP pode cortar quantidade)', () => {
    const r = itensDoFaturamento('faturado_total', [{ sequencia: 1, quantidade: 8 }], itensPedido, []);
    expect(r.itens).toEqual([{ sequencia: 1, product_id: P1, quantity: 8, valor_cents: null }]);
  });
});

describe('eventoFaturadoDosItens — vendedor.pedido.faturado@1 (RN-TRE-08)', () => {
  it('RN-TRE-08: evento válido pelo contrato, com faturado_em = ocorrido_em do retorno e itens somados por produto', () => {
    const ev = eventoFaturadoDosItens({ id: PED, vendedor_id: VEN }, OCORRIDO, true, [
      { sequencia: 1, product_id: P1, quantity: 2, valor_cents: null },
      { sequencia: 3, product_id: P1, quantity: 1, valor_cents: null },
    ]);
    expect(PedidoFaturadoEvento.parse(ev)).toEqual({ pedido_id: PED, vendedor_id: VEN, faturado_em: OCORRIDO, parcial: true, itens: [{ produto_id: P1, quantidade: 3 }] });
  });
  it('RN-TRE-08: sem itens não há evento (nunca publica faturado vazio)', () => {
    expect(eventoFaturadoDosItens({ id: PED, vendedor_id: VEN }, OCORRIDO, false, [])).toBeNull();
  });
});

describe('decidirNotaDevolucao — nota de devolução do ERP (RN-VEN-37 proposta, integracao.nota.atualizado@1)', () => {
  const nota = { tipo: 'devolucao', pedido_uuid: PED, numero: '555', serie: '2', emitida_em: OCORRIDO, total_cents: 1_500, cancelada: false };

  it('RN-VEN-37: nota de devolução com pedido do Macuxi é gravada pelo external_id da nota', () => {
    expect(decidirNotaDevolucao({ acao: 'criado', external_id: 'NF-D-555', registro: nota })).toEqual({
      tipo: 'gravar', pedido_id: PED, external_id: 'NF-D-555', numero: '555', serie: '2', emitida_em: OCORRIDO, total_cents: 1_500,
    });
  });
  it('RN-VEN-37: valor negativo do ERP vira valor absoluto (devolução é sempre valor a menos)', () => {
    expect(decidirNotaDevolucao({ acao: 'atualizado', external_id: 'X', registro: { ...nota, total_cents: -700 } })).toMatchObject({ tipo: 'gravar', total_cents: 700 });
  });
  it('RN-VEN-37: nota cancelada, inativada ou que deixou de ser devolução sai da soma (remover pelo external_id)', () => {
    expect(decidirNotaDevolucao({ acao: 'atualizado', external_id: 'X', registro: { ...nota, cancelada: true } })).toEqual({ tipo: 'remover', external_id: 'X' });
    expect(decidirNotaDevolucao({ acao: 'inativado', external_id: 'X' })).toEqual({ tipo: 'remover', external_id: 'X' });
    expect(decidirNotaDevolucao({ acao: 'atualizado', external_id: 'X', registro: { ...nota, tipo: 'faturamento' } })).toEqual({ tipo: 'remover', external_id: 'X' });
  });
  it('RN-VEN-37: devolução sem pedido do Macuxi (venda direta no ERP) não é do Vendedor', () => {
    expect(decidirNotaDevolucao({ acao: 'criado', external_id: 'X', registro: { ...nota, pedido_uuid: null } })).toEqual({ tipo: 'remover', external_id: 'X' });
  });
});

describe('resumoFaturamento e texto da situação (RF-VEN-05, RN-VEN-37 proposta)', () => {
  it('RF-VEN-05: quantidades faturadas por item, saldo e situação da devolução', () => {
    const r = resumoFaturamento(itensPedido, [
      { nota_numero: '1', nota_total_cents: 7_000, faturado_em: OCORRIDO, itens: [{ sequencia: 1, quantidade: 6, valor_cents: 6_000 }] },
      { nota_numero: '2', nota_total_cents: 1_000, faturado_em: '2026-10-31T15:00:00.000Z', itens: [{ sequencia: 2, quantidade: 2, valor_cents: null }] },
    ], [{ total_cents: 1_000 }]);
    expect(r.itens).toEqual([
      { sequencia: 1, quantidade: 10, faturada: 6, saldo: 4 },
      { sequencia: 2, quantidade: 4, faturada: 2, saldo: 2 },
    ]);
    // item sem valor usa o valor proporcional do pedido (2 de 4 unidades de 2.000)
    expect(r.faturado_cents).toBe(7_000);
    expect(r.devolvido_cents).toBe(1_000);
    expect(r.devolucao).toBe('parcial');
    expect(r.notas).toBe(2);
    expect(r.ultima_nota).toBe('2');
  });

  it('RN-VEN-37: devolução que cobre o faturado é total; sem devolução é nenhuma; nota sem itens usa o total da nota', () => {
    const r = resumoFaturamento(itensPedido, [{ nota_numero: '1', nota_total_cents: 12_000, faturado_em: OCORRIDO, itens: [] }], [{ total_cents: 12_000 }]);
    expect(r.faturado_cents).toBe(12_000);
    expect(r.devolucao).toBe('total');
    expect(resumoFaturamento(itensPedido, [], []).devolucao).toBe('nenhuma');
  });

  it('RF-VEN-05: texto curto para o app e o BKO (em reais, sem percentuais)', () => {
    expect(textoSituacaoFaturamento({ faturado_cents: 7_000, devolvido_cents: 0, ultima_nota: '2', notas: 2 })).toEqual(['Faturado R$ 70,00 em 2 notas (última NF 2)']);
    expect(textoSituacaoFaturamento({ faturado_cents: 7_000, devolvido_cents: 7_000, ultima_nota: '1', notas: 1 })).toEqual(['Faturado R$ 70,00 (NF 1)', 'Devolvido R$ 70,00 (total)']);
    expect(textoSituacaoFaturamento({ faturado_cents: 7_000, devolvido_cents: 1_000, ultima_nota: null, notas: 1 })).toEqual(['Faturado R$ 70,00', 'Devolvido R$ 10,00 (parcial)']);
    expect(textoSituacaoFaturamento({ faturado_cents: 0, devolvido_cents: 0, ultima_nota: null, notas: 0 })).toEqual([]);
  });
});

describe('camposFaturamento e textoItemFaturado — o mesmo resumo na API e no app offline (RF-VEN-05)', () => {
  it('RF-VEN-05: sem a coluna de faturamento (linha antiga) não mostra nada', () => {
    expect(camposFaturamento({})).toEqual({});
    expect(camposFaturamento({ faturado_cents: null })).toEqual({});
  });
  it('RF-VEN-05 / RN-VEN-37: com o resumo do pedido monta valores, situação da devolução e linhas da tela', () => {
    expect(camposFaturamento({ faturado_cents: '7000', devolvido_cents: 1_000, notas_faturamento: 2, ultima_nota_numero: '2' })).toEqual({
      faturado_cents: 7_000,
      devolvido_cents: 1_000,
      devolucao: 'parcial',
      ultima_nota: '2',
      situacao_faturamento: ['Faturado R$ 70,00 em 2 notas (última NF 2)', 'Devolvido R$ 10,00 (parcial)'],
    });
  });
  it('RF-VEN-05: texto do item faturado', () => {
    expect(textoItemFaturado(10, undefined)).toBeNull();
    expect(textoItemFaturado(10, 0)).toBe('Não faturado');
    expect(textoItemFaturado(10, 6)).toBe('Faturado 6 de 10');
    expect(textoItemFaturado(10, 10)).toBe('Faturado');
  });
});
