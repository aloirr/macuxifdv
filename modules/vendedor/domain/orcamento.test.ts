/**
 * T-0053: orçamento (pré-venda) × pedido — RF-VEN-03, RN-VEN-32, RN-VEN-13. Funções puras; o "agora" é sempre argumento
 * (instantes fixos só como dado, nenhuma comparação com o relógio real).
 */
import { describe, expect, it } from 'vitest';
import {
  acoesDoOrcamento,
  dataDaValidade,
  historicoDoOrcamento,
  momentoDaConversao,
  pedidoDoOrcamento,
  situacaoDoOrcamento,
  validadeDoOrcamento,
  validadeOrcamentoDias,
  verificarConversao,
  verificarTipoParaCliente,
  VALIDADE_ORCAMENTO_DIAS_PADRAO,
  type OrcamentoParaConversao,
} from './orcamento';

const CRIADO = '2026-11-02T12:00:00.000Z';
const mais = (iso: string, horas: number) => new Date(Date.parse(iso) + horas * 3_600_000);
const ORC: OrcamentoParaConversao = {
  id: '00000000-0000-4000-8000-000000000001',
  tipo: 'orcamento',
  status: 'received',
  vendedor_id: 'v1',
  cliente_id: 'c1',
  validade_ate: '2026-11-09T12:00:00.000Z',
  convertido_pedido_id: null,
};

describe('RN-VEN-32: validade do orçamento', () => {
  it('RN-VEN-32: padrão de 7 dias; o parâmetro do tenant vale entre 1 e 90', () => {
    expect(VALIDADE_ORCAMENTO_DIAS_PADRAO).toBe(7);
    expect(validadeOrcamentoDias({})).toBe(7);
    expect(validadeOrcamentoDias({ 'orcamento.validade_dias': 15 })).toBe(15);
    expect(validadeOrcamentoDias({ 'orcamento.validade_dias': '10' })).toBe(10);
    for (const ruim of [0, -1, 91, 2.5, 'x', null]) expect(validadeOrcamentoDias({ 'orcamento.validade_dias': ruim })).toBe(7);
  });

  it('RN-VEN-18: vale até o fim do dia civil de criação + N dias no fuso (instante UTC)', () => {
    expect(validadeDoOrcamento(CRIADO, 7, 'America/Manaus')).toEqual({ data: '2026-11-09', ate: '2026-11-10T04:00:00.000Z' });
  });

  it('RN-VEN-18 (T-0135): salvo às 22h de Manaus (já é outro dia em UTC), a tag e o histórico dizem a mesma data', () => {
    const salvo = '2026-11-09T02:00:00.000Z'; // 08/11 22h em Manaus
    const v = validadeDoOrcamento(salvo, 7, 'America/Manaus');
    expect(v.data).toBe('2026-11-15');
    expect(dataDaValidade(v.data)).toBe('15/11');
    expect(historicoDoOrcamento(v.data)[0]!.motivo).toMatch(/válido até 15\/11\/2026/);
    // vale até 23:59 de Manaus do dia 15: 03:59:59Z do dia 16 ainda aberto; 04:00Z vencido
    expect(v.ate).toBe('2026-11-16T04:00:00.000Z');
  });

  it('RN-VEN-18 (T-0135): virada de mês — salvo em 28/10 às 22h de Manaus, 7 dias → 04/11/2026', () => {
    const v = validadeDoOrcamento('2026-10-29T02:00:00.000Z', 7, 'America/Manaus');
    expect(v.data).toBe('2026-11-04');
    expect(historicoDoOrcamento(v.data)[0]!.motivo).toMatch(/04\/11\/2026/);
    expect(dataDaValidade(v.data, true)).toBe('04/11/2026');
  });

  it('RN-VEN-32: situação aberto → expirado; cancelado e convertido prevalecem', () => {
    expect(situacaoDoOrcamento(ORC, mais(CRIADO, 24))).toBe('aberto');
    expect(situacaoDoOrcamento(ORC, mais(ORC.validade_ate!, -0.001))).toBe('aberto');
    expect(situacaoDoOrcamento(ORC, mais(ORC.validade_ate!, 0))).toBe('expirado'); // RN-VEN-18: vencido ⇔ agora ≥ validade_ate
    expect(situacaoDoOrcamento(ORC, mais(ORC.validade_ate!, 1))).toBe('expirado');
    expect(situacaoDoOrcamento({ ...ORC, status: 'cancelled' }, mais(CRIADO, 1))).toBe('cancelado');
    expect(situacaoDoOrcamento({ ...ORC, convertido_pedido_id: 'p9' }, mais(ORC.validade_ate!, 48))).toBe('convertido');
  });

  it('RN-VEN-18: ações por situação (converter e cancelar só no aberto; vencido só duplica; duplicar sempre)', () => {
    expect(acoesDoOrcamento('aberto')).toMatchObject({ pode_converter: true, pode_cancelar: true, pode_duplicar: true });
    expect(acoesDoOrcamento('expirado')).toMatchObject({ pode_converter: false, pode_cancelar: false, pode_duplicar: true }); // RN-VEN-18: o vencido não se cancela
    // V14 (T-0071): o selo "Vencido" já diz o motivo; a tela não repete a explicação
    expect(acoesDoOrcamento('expirado').texto).toBe('');
    expect(acoesDoOrcamento('convertido').texto).toBe('');
    expect(acoesDoOrcamento('convertido')).toMatchObject({ pode_converter: false, pode_cancelar: false });
    expect(acoesDoOrcamento('cancelado')).toMatchObject({ pode_converter: false, pode_cancelar: false });
  });
});

describe('RN-VEN-13: cliente bloqueado ou inativo → só orçamento', () => {
  it('RN-VEN-13: pedido para cliente inativo é recusado com a ação seguinte; orçamento passa', () => {
    expect(verificarTipoParaCliente('pedido', true)).toBeNull();
    expect(verificarTipoParaCliente('orcamento', true)).toBeNull();
    expect(verificarTipoParaCliente('orcamento', false)).toBeNull();
    const r = verificarTipoParaCliente('pedido', false);
    expect(r).toMatchObject({ codigo: 'RN-VEN-13', http: 422 });
    expect(r!.mensagem).toMatch(/orçamento/);
  });
});

describe('RF-VEN-03 / RN-VEN-32: converter orçamento em pedido', () => {
  const base = { vendedor_id: 'v1', cliente_id: 'c1', pedido_id: 'p1' };

  it('RN-VEN-32: orçamento aberto do próprio vendedor converte', () => {
    expect(verificarConversao({ ...base, orcamento: ORC, momento: mais(CRIADO, 48) })).toBeNull();
  });

  it('RN-VEN-32: inexistente, de outro vendedor ou que não é orçamento = não encontrado (não revela)', () => {
    for (const o of [null, { ...ORC, vendedor_id: 'v2' }, { ...ORC, tipo: 'pedido' as const }]) {
      expect(verificarConversao({ ...base, orcamento: o, momento: mais(CRIADO, 1) })).toMatchObject({ codigo: 'ORCAMENTO_NAO_ENCONTRADO', http: 404 });
    }
  });

  it('RN-VEN-32: cliente do pedido diferente do orçamento é recusado', () => {
    expect(verificarConversao({ ...base, cliente_id: 'c2', orcamento: ORC, momento: mais(CRIADO, 1) })).toMatchObject({ codigo: 'PAYLOAD_INVALIDO' });
  });

  it('RN-VEN-32: expirado, cancelado ou já convertido em OUTRO pedido não converte; o mesmo pedido é idempotente (RN-VEN-33)', () => {
    expect(verificarConversao({ ...base, orcamento: ORC, momento: mais(ORC.validade_ate!, 1) })).toMatchObject({ codigo: 'RN-VEN-18', http: 422 });
    expect(verificarConversao({ ...base, orcamento: { ...ORC, status: 'cancelled' }, momento: mais(CRIADO, 1) })).toMatchObject({ codigo: 'RN-VEN-18' });
    expect(verificarConversao({ ...base, orcamento: { ...ORC, convertido_pedido_id: 'p2' }, momento: mais(CRIADO, 1) })).toMatchObject({ codigo: 'ORCAMENTO_JA_CONVERTIDO', http: 409 });
    expect(verificarConversao({ ...base, orcamento: { ...ORC, convertido_pedido_id: 'p1' }, momento: mais(CRIADO, 1) })).toBeNull();
  });

  it('RN-VEN-32 + offline: vale o momento da conversão no aparelho, limitado a 7 dias antes da chegada e nunca no futuro', () => {
    const chegada = mais(ORC.validade_ate!, 30);
    // convertido offline antes de expirar, sincronizado depois: converte
    expect(momentoDaConversao('2026-11-08T10:00:00.000Z', chegada).toISOString()).toBe('2026-11-08T10:00:00.000Z');
    expect(verificarConversao({ ...base, orcamento: ORC, momento: momentoDaConversao('2026-11-08T10:00:00.000Z', chegada) })).toBeNull();
    // relógio do aparelho no futuro ou ausente: vale a chegada
    expect(momentoDaConversao(mais(chegada.toISOString(), 5).toISOString(), chegada)).toEqual(chegada);
    expect(momentoDaConversao(null, chegada)).toEqual(chegada);
    expect(momentoDaConversao('lixo', chegada)).toEqual(chegada);
    // mais de 7 dias antes da chegada: limitado
    expect(momentoDaConversao('2026-10-01T00:00:00.000Z', chegada)).toEqual(mais(chegada.toISOString(), -7 * 24));
  });

  it('RF-VEN-03: o pedido nasce do orçamento com novo UUID, os mesmos itens/condição/desconto e a origem; o preço é o de hoje (revalidado no servidor)', () => {
    const p = pedidoDoOrcamento(
      {
        id: ORC.id,
        cliente_id: 'c1',
        desconto_pct: 4,
        condicao_pagamento_id: 'cp1',
        observacao: 'entregar sexta',
        visita_id: null,
        itens: [
          { product_id: 'p1', quantity: 2 },
          { product_id: 'p2', quantity: 6 },
        ],
      },
      '00000000-0000-4000-8000-0000000000aa',
      CRIADO,
    );
    expect(p).toEqual({
      id: '00000000-0000-4000-8000-0000000000aa',
      tipo: 'pedido',
      orcamento_origem_id: ORC.id,
      customer_id: 'c1',
      discount_pct: 4,
      condicao_pagamento_id: 'cp1',
      observacao: 'entregar sexta',
      visita_id: null,
      created_offline_at: CRIADO,
      items: [
        { product_id: 'p1', quantity: 2 },
        { product_id: 'p2', quantity: 6 },
      ],
    });
  });

  it('RN-VEN-32: o histórico do orçamento diz que não reserva estoque nem consome crédito e quando expira', () => {
    const h = historicoDoOrcamento('2026-11-09');
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ de: null, para: 'received' });
    expect(h[0]!.motivo).toMatch(/não reserva estoque nem consome crédito/);
    expect(h[0]!.motivo).toMatch(/09\/11\/2026/);
  });
});
