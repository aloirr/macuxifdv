import { describe, expect, it } from 'vitest';
import { PedidoFaturadoEvento } from '../contracts/eventos';
import { ORDER_STATUSES, type OrderStatus } from './order';
import {
  camposFaturamento,
  textoItemFaturado,
  decidirNotaDevolucao,
  decidirRetornoErp,
  eventoFaturadoDosItens,
  itensDoFaturamento,
  resumoFaturamento,
  textoSituacaoFaturamento,
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
const retorno = (status: string, extra: Partial<{ numero_erp: string | null; motivo: string | null; nota: { numero: string; serie?: string | null } | null }> = {}) => ({
  status,
  numero_erp: extra.numero_erp === undefined ? 'ERP-1' : extra.numero_erp,
  motivo: extra.motivo ?? null,
  nota: extra.nota ?? null,
  ocorrido_em: OCORRIDO,
});

describe('decidirRetornoErp — status do pedido pelo retorno do ERP (RN-INT-08, RN-VEN-30)', () => {
  it('RN-INT-08: integrado leva aprovado direto a integrado (o Hub não publica o "enviado") com o número do ERP', () => {
    const d = decidirRetornoErp('approved', retorno('integrado', { numero_erp: '9876' }));
    expect(d).toMatchObject({ aplicar: true, de: 'approved', para: 'integrated', mudouStatus: true, numero_erp: '9876', registraFaturamento: false });
    if (d.aplicar) expect(d.historico).toContain('9876');
  });

  it('RN-INT-08: faturado_parcial vai a invoiced_partial e registra o faturamento; o segundo parcial registra sem mudar o status', () => {
    const d1 = decidirRetornoErp('integrated', retorno('faturado_parcial', { nota: { numero: '123', serie: '1' } }));
    expect(d1).toMatchObject({ aplicar: true, para: 'invoiced_partial', mudouStatus: true, registraFaturamento: true, parcial: true });
    if (d1.aplicar) expect(d1.historico).toContain('NF 123/1');
    const d2 = decidirRetornoErp('invoiced_partial', retorno('faturado_parcial', { nota: { numero: '124' } }));
    expect(d2).toMatchObject({ aplicar: true, para: 'invoiced_partial', mudouStatus: false, registraFaturamento: true });
  });

  it('RN-INT-08: faturado_total fecha o pedido em invoiced (de integrado, parcial ou aprovado)', () => {
    for (const de of ['approved', 'sent_to_erp', 'integrated', 'invoiced_partial'] as OrderStatus[]) {
      expect(decidirRetornoErp(de, retorno('faturado_total', { nota: { numero: '9' } }))).toMatchObject({ aplicar: true, para: 'invoiced', mudouStatus: true, parcial: false, registraFaturamento: true });
    }
  });

  it('RN-VEN-30: retorno atrasado não volta o status (integrado depois de faturado é ignorado)', () => {
    expect(decidirRetornoErp('invoiced', retorno('integrado'))).toEqual({ aplicar: false, motivo: 'fora_de_ordem' });
    expect(decidirRetornoErp('invoiced_partial', retorno('integrado'))).toEqual({ aplicar: false, motivo: 'fora_de_ordem' });
  });

  it('RN-INT-08: faturamento parcial atrasado depois do total registra a nota sem mudar o status', () => {
    expect(decidirRetornoErp('invoiced', retorno('faturado_parcial', { nota: { numero: '1' } }))).toMatchObject({ aplicar: true, para: 'invoiced', mudouStatus: false, registraFaturamento: true });
  });

  it('RN-INT-08: rejeitado_erp só antes de integrado; o motivo vira motivo_rejeicao com 3+ caracteres', () => {
    const d = decidirRetornoErp('approved', retorno('rejeitado_erp', { numero_erp: null, motivo: 'X' }));
    expect(d).toMatchObject({ aplicar: true, para: 'rejected', mudouStatus: true });
    if (d.aplicar) expect((d.motivo_rejeicao ?? '').length).toBeGreaterThanOrEqual(3);
    expect(decidirRetornoErp('integrated', retorno('rejeitado_erp', { motivo: 'tarde' }))).toEqual({ aplicar: false, motivo: 'fora_de_ordem' });
  });

  it('RN-INT-08: cancelado do ERP vale de aprovado em diante (inclusive faturado, sem estorno) e grava o motivo', () => {
    for (const de of ['approved', 'sent_to_erp', 'integrated', 'invoiced_partial', 'invoiced', 'rejected'] as OrderStatus[]) {
      const d = decidirRetornoErp(de, retorno('cancelado', { motivo: 'cliente desistiu' }));
      expect(d).toMatchObject({ aplicar: true, para: 'cancelled', mudouStatus: true, registraFaturamento: false });
      if (d.aplicar) expect(d.motivo_cancelamento).toContain('cliente desistiu');
    }
    const semMotivo = decidirRetornoErp('integrated', retorno('cancelado'));
    if (semMotivo.aplicar) expect(semMotivo.motivo_cancelamento).toBe('Cancelado no ERP.');
  });

  it('RN-VEN-30: pedido cancelado é final; retorno de pedido que não chegou a aprovado é ignorado', () => {
    expect(decidirRetornoErp('cancelled', retorno('faturado_total', { nota: { numero: '1' } }))).toEqual({ aplicar: false, motivo: 'pedido_finalizado' });
    for (const de of ['draft', 'queued', 'received', 'pending_approval'] as OrderStatus[]) {
      expect(decidirRetornoErp(de, retorno('integrado'))).toEqual({ aplicar: false, motivo: 'pedido_nao_aprovado' });
    }
  });

  it('RN-INT-08: pendente e enviado do Hub; repetido sem novidade não faz nada; status desconhecido é ignorado', () => {
    expect(decidirRetornoErp('approved', retorno('pendente'))).toEqual({ aplicar: false, motivo: 'sem_efeito' });
    expect(decidirRetornoErp('approved', retorno('enviado'))).toMatchObject({ aplicar: true, para: 'sent_to_erp', mudouStatus: true });
    expect(decidirRetornoErp('integrated', retorno('integrado', { numero_erp: 'ERP-1' }), 'ERP-1')).toEqual({ aplicar: false, motivo: 'sem_efeito' });
    // número novo no mesmo status: só atualiza o número
    expect(decidirRetornoErp('integrated', retorno('integrado', { numero_erp: 'ERP-2' }), 'ERP-1')).toMatchObject({ aplicar: true, mudouStatus: false, numero_erp: 'ERP-2' });
    expect(decidirRetornoErp('approved', retorno('qualquer'))).toEqual({ aplicar: false, motivo: 'status_desconhecido' });
  });

  it('RN-VEN-30: toda transição decidida é permitida pela máquina de status ou é o salto documentado do retorno', () => {
    for (const de of ORDER_STATUSES) {
      for (const st of ['enviado', 'integrado', 'rejeitado_erp', 'faturado_parcial', 'faturado_total', 'cancelado']) {
        const d = decidirRetornoErp(de, retorno(st, { motivo: 'm', nota: { numero: '1' } }));
        if (d.aplicar && d.mudouStatus) expect(d.de).not.toBe(d.para);
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
