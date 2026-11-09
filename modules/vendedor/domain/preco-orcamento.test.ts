import { describe, expect, it } from 'vitest';
import {
  acoesDoOrcamento,
  etiquetaPrecoDe,
  precoDoOrcamentoVale,
  reconferirOrcamento,
  situacaoDoOrcamento,
  validadeDoPreco,
  verificarConversao,
  type DadosAtuais,
  type OrcamentoParaReconferir,
} from './orcamento';
import { politicaDosParametros } from './aprovacao';

const FUSO = 'America/Manaus'; // UTC-4

describe('RN-VEN-18: o preço do orçamento vale até D+7 23:59 no fuso do tenant (função única)', () => {
  it('RN-VEN-18: salvo em 09/11 às 05h50 (Manaus), o preço vale até 16/11 às 23:59:59', () => {
    const v = validadeDoPreco('2026-11-09T09:50:00.000Z', 7, FUSO);
    expect(v.data).toBe('2026-11-16');
    expect(precoDoOrcamentoVale(v.ate, new Date('2026-11-17T03:59:59.999Z'))).toBe(true); // 16/11 23:59:59 em Manaus
    expect(precoDoOrcamentoVale(v.ate, new Date('2026-11-17T04:00:00.000Z'))).toBe(false); // 17/11 00:00 em Manaus
  });

  it('RN-VEN-18: salvo à noite (UTC já no dia seguinte) conta o dia civil do tenant', () => {
    // 09/11 22:30 em Manaus = 10/11 02:30 UTC
    expect(validadeDoPreco('2026-11-10T02:30:00.000Z', 7, FUSO).data).toBe('2026-11-16');
  });

  it('RN-VEN-18: a etiqueta mostra a data do preço, no fuso do tenant, sem "até" nem "vencido"', () => {
    expect(etiquetaPrecoDe('2026-11-10T02:30:00.000Z', FUSO)).toBe('preço de 09/11');
    expect(etiquetaPrecoDe('2026-11-09T09:50:00.000Z', FUSO)).toBe('preço de 09/11');
  });
});

describe('RN-VEN-18/32: orçamento não expira e não some', () => {
  const ate = validadeDoPreco('2026-11-09T09:50:00.000Z', 7, FUSO).ate;
  it('RN-VEN-18: meses depois o orçamento segue aberto (nunca "expirado")', () => {
    expect(situacaoDoOrcamento({ status: 'received', validade_ate: ate, convertido_pedido_id: null }, new Date('2027-03-01T00:00:00Z'))).toBe('aberto');
  });
  it('RN-VEN-18: aberto edita, transforma, cancela e duplica a qualquer tempo', () => {
    expect(acoesDoOrcamento('aberto')).toMatchObject({ pode_converter: true, pode_editar: true, pode_cancelar: true, pode_duplicar: true });
  });
  it('RN-VEN-18: converter depois dos 7 dias não é recusado (reprecifica); cancelado e já convertido continuam recusados', () => {
    const o = { id: 'o1', tipo: 'orcamento' as const, vendedor_id: 'v1', cliente_id: 'c1', status: 'received', validade_ate: ate, convertido_pedido_id: null };
    const base = { vendedor_id: 'v1', cliente_id: 'c1', pedido_id: 'p1', momento: new Date('2027-01-01T00:00:00Z') };
    expect(verificarConversao({ ...base, orcamento: o })).toBeNull();
    expect(verificarConversao({ ...base, orcamento: { ...o, status: 'cancelled' } })?.codigo).toBe('RN-VEN-18');
    expect(verificarConversao({ ...base, orcamento: { ...o, convertido_pedido_id: 'outro' } })?.codigo).toBe('ORCAMENTO_JA_CONVERTIDO');
  });
});

describe('RN-VEN-18: Transformar depois do preço vencido reprecifica pela tabela do dia e mostra a diferença', () => {
  const orc: OrcamentoParaReconferir = {
    itens: [
      { product_id: 'a', unidade: 'UN', quantity: 2, ajuste: null, tabela_cents: 1000 },
      { product_id: 'b', unidade: 'UN', quantity: 1, ajuste: { sentido: 'desconto', em: 'pct', pct: 10 }, tabela_cents: 2000 },
    ],
    ajuste_pedido: null,
    alcada_nivel: null,
  };
  const hoje = (a: number, b: number): DadosAtuais => ({
    cliente: { ativo: true, bloqueado: false, cadastro_incompleto: false, campos_faltantes: [] },
    itens: {
      a: { tabela_cents: a, medida_ativa: true, estoque_base: null, fator: 1, minimo_base_cents: null },
      b: { tabela_cents: b, medida_ativa: true, estoque_base: null, fator: 1, minimo_base_cents: null },
    },
    policy: politicaDosParametros({}),
    estoque_bloqueia: false,
  });

  it('RN-VEN-18: preço ainda vale: mantém o do orçamento e não acusa diferença', () => {
    const r = reconferirOrcamento(orc, hoje(1100, 2200), { preco_vale: true });
    expect(r.calculo.totais.total_cents).toBe(2 * 1000 + 1800);
    expect(r.mudancas.filter((m) => m.tipo === 'preco')).toEqual([]);
    expect(r.diferenca_total_cents).toBe(0);
  });

  it('RN-VEN-18: preço vencido: usa a tabela do dia, lista a diferença por item e no total', () => {
    const r = reconferirOrcamento(orc, hoje(1100, 2200), { preco_vale: false });
    expect(r.calculo.totais.total_cents).toBe(2 * 1100 + 1980); // o desconto de 10% do item é mantido
    expect(r.mudancas.filter((m) => m.tipo === 'preco')).toEqual([
      { tipo: 'preco', produto_id: 'a', de_cents: 1000, para_cents: 1100 },
      { tipo: 'preco', produto_id: 'b', de_cents: 2000, para_cents: 2200 },
    ]);
    expect(r.total_orcado_cents).toBe(3800);
    expect(r.diferenca_total_cents).toBe(4180 - 3800);
  });

  it('RN-VEN-18: preço vencido e item sem preço hoje: sai do pedido, com aviso', () => {
    const h = hoje(1100, 2200);
    h.itens.b!.tabela_cents = null;
    const r = reconferirOrcamento(orc, h, { preco_vale: false });
    expect(r.rascunho.itens.map((i) => i.product_id)).toEqual(['a']);
    expect(r.mudancas.some((m) => m.tipo === 'sem_preco' && m.produto_id === 'b')).toBe(true);
  });

  it('RN-VEN-18: preço vencido e preço igual ao de hoje: nenhuma diferença', () => {
    const r = reconferirOrcamento(orc, hoje(1000, 2000), { preco_vale: false });
    expect(r.mudancas.filter((m) => m.tipo === 'preco')).toEqual([]);
    expect(r.diferenca_total_cents).toBe(0);
  });
});
