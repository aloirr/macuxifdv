/**
 * T-0071 (desenho §1): orçamento v2 — validade por data civil (RN-VEN-18), ações por situação, reconferir ao transformar,
 * opções do Salvar (RN-VEN-13) e cópia COMPLETA ao transformar ou duplicar. Funções puras; o "agora" é sempre argumento.
 */
import { describe, expect, it } from 'vitest';

import { politicaDosParametros, revalidarPedido } from './aprovacao';
import {
  acoesDoOrcamento,
  duplicarDocumento,
  opcoesDoSalvar,
  pedidoDoOrcamento,
  precoDoItemNaEdicao,
  precosCongelados,
  reconferirOrcamento,
  situacaoDoOrcamento,
  validadeDoOrcamento,
  verificarTipoParaCliente,
  type DadosAtuais,
  type OrcamentoParaReconferir,
} from './orcamento';
import type { AjusteItem } from './preco-pedido';

const desc = (pct: number): AjusteItem => ({ sentido: 'desconto', em: 'pct', pct });
const descR = (cents: number): AjusteItem => ({ sentido: 'desconto', em: 'valor', cents });
const MANAUS = 'America/Manaus';

describe('RN-VEN-18: validade por data civil no fuso do tenant', () => {
  it('RN-VEN-18: criado em 2026-11-03T16:32Z (Manaus), 7 dias → data 2026-11-10 e vale até 2026-11-11T04:00:00Z', () => {
    expect(validadeDoOrcamento('2026-11-03T16:32:00.000Z', 7, MANAUS)).toEqual({ data: '2026-11-10', ate: '2026-11-11T04:00:00.000Z' });
  });
  it('RN-VEN-18: a data civil é a do fuso, não a do UTC (02:00Z ainda é o dia anterior em Manaus)', () => {
    expect(validadeDoOrcamento('2026-11-04T02:00:00.000Z', 7, MANAUS).data).toBe('2026-11-10');
  });
  it('RN-VEN-18: vencido ⇔ agora ≥ validade_ate — às 03:59:59Z aberto; às 04:00:00Z vencido', () => {
    const o = { status: 'received', validade_ate: '2026-11-11T04:00:00.000Z', convertido_pedido_id: null };
    expect(situacaoDoOrcamento(o, new Date('2026-11-11T03:59:59.000Z'))).toBe('aberto');
    expect(situacaoDoOrcamento(o, new Date('2026-11-11T04:00:00.000Z'))).toBe('expirado');
  });
});

describe('RN-VEN-18: ações por situação (desenho §1.2)', () => {
  it('RN-VEN-18: aberto — transformar, editar, duplicar, PDF e cancelar', () => {
    expect(acoesDoOrcamento('aberto')).toMatchObject({ pode_converter: true, pode_editar: true, pode_duplicar: true, pode_pdf: true, pode_cancelar: true });
  });
  it('RN-VEN-18: vencido — só Duplicar (e PDF)', () => {
    expect(acoesDoOrcamento('expirado')).toMatchObject({ pode_converter: false, pode_editar: false, pode_duplicar: true, pode_pdf: true, pode_cancelar: false });
  });
  it('RN-VEN-18: convertido — duplicar e PDF', () => {
    expect(acoesDoOrcamento('convertido')).toMatchObject({ pode_converter: false, pode_editar: false, pode_duplicar: true, pode_pdf: true, pode_cancelar: false });
  });
  it('RN-VEN-18: cancelado — só duplicar', () => {
    expect(acoesDoOrcamento('cancelado')).toMatchObject({ pode_converter: false, pode_editar: false, pode_duplicar: true, pode_pdf: false, pode_cancelar: false });
  });
});

describe('RN-VEN-13 (T-0071): cadastro incompleto ou bloqueado só faz orçamento', () => {
  const ok = { ativo: true, bloqueado: false, cadastro_incompleto: false, campos_faltantes: [] as string[] };
  it('RN-VEN-13: cliente completo faz pedido; incompleto, bloqueado ou inativo só orçamento (422)', () => {
    expect(verificarTipoParaCliente('pedido', ok)).toBeNull();
    for (const c of [{ ...ok, cadastro_incompleto: true, campos_faltantes: ['CEP'] }, { ...ok, bloqueado: true }, { ...ok, ativo: false }]) {
      expect(verificarTipoParaCliente('pedido', c)).toMatchObject({ codigo: 'RN-VEN-13', http: 422 });
      expect(verificarTipoParaCliente('orcamento', c)).toBeNull();
    }
    expect(verificarTipoParaCliente('pedido', { ...ok, cadastro_incompleto: true, campos_faltantes: ['CEP', 'e-mail'] })!.mensagem).toMatch(/CEP, e-mail/);
  });
  it('RN-VEN-13: opcoesDoSalvar oferece só o orçamento, com o motivo curto', () => {
    const o = opcoesDoSalvar({ cliente: { ...ok, cadastro_incompleto: true, campos_faltantes: ['CEP'] }, calculo: { nivel: null }, frete_erro: null, validade_data: '2026-11-10' });
    expect(o.enviar.visivel).toBe(false);
    expect(o.motivo_so_orcamento).toBe('Cadastro incompleto: falta CEP.');
    expect(o.orcamento).toEqual({ visivel: true, subtitulo: 'Válido até 10/11.' });
  });
  it('RN-VEN-10/16: subtítulo segue a alçada; FOB sem transportadora desabilita o envio com a mensagem', () => {
    const base = { cliente: ok, frete_erro: null, validade_data: '2026-11-10' };
    expect(opcoesDoSalvar({ ...base, calculo: { nivel: null } }).enviar).toEqual({ visivel: true, habilitado: true, subtitulo: 'Vai direto ao ERP.', erro: null });
    expect(opcoesDoSalvar({ ...base, calculo: { nivel: 'supervisor' } }).enviar.subtitulo).toBe('Vai para o supervisor.');
    expect(opcoesDoSalvar({ ...base, calculo: { nivel: 'gerente' } }).enviar.subtitulo).toBe('Vai para o gerente.');
    expect(opcoesDoSalvar({ ...base, calculo: { nivel: 'analista' } }).enviar.subtitulo).toBe('Vai para o analista.');
    const fob = opcoesDoSalvar({ ...base, calculo: { nivel: null }, frete_erro: 'Informe a transportadora do frete FOB.' });
    expect(fob.enviar).toMatchObject({ visivel: true, habilitado: false, erro: 'Informe a transportadora do frete FOB.' });
  });
});

describe('RN-VEN-18: reconferir o orçamento ao transformar (offline, dados de hoje)', () => {
  const orc: OrcamentoParaReconferir = {
    itens: [
      { product_id: 'agu', unidade: 'FD', quantity: 3, ajuste: desc(5), tabela_cents: 1790 },
      { product_id: 'caf', unidade: 'UN', quantity: 12, ajuste: descR(100), tabela_cents: 1890 },
      { product_id: 'bis', unidade: 'CX', quantity: 1, ajuste: null, tabela_cents: 11780 },
    ],
    ajuste_pedido: desc(1),
    alcada_nivel: null,
  };
  const dado = (tabela: number, o: Partial<DadosAtuais['itens'][string]> = {}): DadosAtuais['itens'][string] => ({ tabela_cents: tabela, medida_ativa: true, estoque_base: 1000, fator: 1, minimo_base_cents: null, ...o });
  const hoje = (o: Partial<DadosAtuais> = {}): DadosAtuais => ({
    cliente: { ativo: true, bloqueado: false, cadastro_incompleto: false, campos_faltantes: [] },
    itens: { agu: dado(1790, { fator: 12 }), caf: dado(1890), bis: dado(11780, { fator: 20 }) },
    policy: politicaDosParametros({ 'alcada.vendedor_pct': 5 }),
    estoque_bloqueia: false,
    ...o,
  });
  it('RN-VEN-18: nada mudou — mesmo total (37979), sem mudanças, vai direto ao ERP', () => {
    const r = reconferirOrcamento(orc, hoje());
    expect(r.mudancas).toEqual([]);
    expect(r.calculo.totais.total_cents).toBe(37979);
    expect(r.calculo.nivel).toBeNull();
    expect(r.pode_enviar).toBe(true);
    expect(r.bloqueio).toBeNull();
  });
  it('RN-VEN-18 (T-0134): preço congelado — a tabela de hoje subiu (café 18,90 → 19,50) e o Transformar mantém 18,90, sem mudança de preço', () => {
    const r = reconferirOrcamento(orc, hoje({ itens: { ...hoje().itens, caf: dado(1950) } }));
    expect(r.mudancas).toEqual([]);
    expect(r.rascunho.itens.find((i) => i.product_id === 'caf')!.tabela_cents).toBe(1890);
    expect(r.calculo.totais.total_cents).toBe(37979);
    expect(r.pode_enviar).toBe(true);
  });
  it('RN-VEN-18 (T-0134): preço congelado vale mesmo sem preço na tabela de hoje (só produto fora do catálogo sai)', () => {
    const r = reconferirOrcamento(orc, hoje({ itens: { ...hoje().itens, bis: { ...dado(0), tabela_cents: null } } }));
    expect(r.rascunho.itens.map((i) => i.product_id)).toEqual(['agu', 'caf', 'bis']);
    expect(r.mudancas).toEqual([]);
  });
  it('RN-VEN-10: a alçada recalculada aparece como mudança', () => {
    const r = reconferirOrcamento({ ...orc, ajuste_pedido: desc(4) }, hoje());
    expect(r.calculo.nivel).toBe('supervisor');
    expect(r.mudancas).toContainEqual({ tipo: 'alcada', de: null, para: 'supervisor' });
  });
  it('RN-CAT-06: produto que saiu do catálogo do aparelho sai do pedido', () => {
    const { bis: _bis, ...resto } = hoje().itens;
    void _bis;
    const r = reconferirOrcamento(orc, hoje({ itens: resto }));
    expect(r.mudancas).toContainEqual({ tipo: 'sem_preco', produto_id: 'bis' });
    expect(r.rascunho.itens.map((i) => i.product_id)).toEqual(['agu', 'caf']);
  });
  it('RN-VEN-15: medida inativa sai do pedido', () => {
    const r = reconferirOrcamento(orc, hoje({ itens: { ...hoje().itens, bis: dado(11780, { fator: 20, medida_ativa: false }) } }));
    expect(r.mudancas).toContainEqual({ tipo: 'medida_inativa', produto_id: 'bis', unidade: 'CX' });
    expect(r.rascunho.itens).toHaveLength(2);
  });
  it('RN-VEN-11 (T-0134): o mínimo subiu — avisa o item, não troca preço nem desconto sozinho e não envia', () => {
    // mínimo base 1850 → café (R$ 18,90 − R$ 1,00 = 17,90) fica abaixo do mínimo
    const r = reconferirOrcamento(orc, hoje({ itens: { ...hoje().itens, caf: dado(1890, { minimo_base_cents: 1850 }) } }));
    expect(r.mudancas).toContainEqual({ tipo: 'abaixo_minimo', produto_id: 'caf', unidade: 'UN' });
    expect(r.rascunho.itens[1]!.ajuste).toEqual(descR(100));
    expect(r.rascunho.itens[1]!.tabela_cents).toBe(1890);
    expect(r.pode_enviar).toBe(false);
    expect(r.bloqueio).toMatch(/mínimo/);
  });
  it('RN-VEN-20: estoque insuficiente avisa; com o parâmetro de bloqueio, não envia', () => {
    const itens = { ...hoje().itens, caf: dado(1890, { estoque_base: 5 }) };
    const aviso = reconferirOrcamento(orc, hoje({ itens }));
    expect(aviso.mudancas).toContainEqual({ tipo: 'estoque', produto_id: 'caf', pedido_base: 12, disponivel_base: 5 });
    expect(aviso.pode_enviar).toBe(true);
    const bloq = reconferirOrcamento(orc, hoje({ itens, estoque_bloqueia: true }));
    expect(bloq.pode_enviar).toBe(false);
    expect(bloq.bloqueio).toMatch(/estoque/i);
  });
  it('RN-VEN-13: cliente bloqueado ou incompleto não transforma', () => {
    const r = reconferirOrcamento(orc, hoje({ cliente: { ativo: true, bloqueado: false, cadastro_incompleto: true, campos_faltantes: ['CEP'] } }));
    expect(r.mudancas).toContainEqual({ tipo: 'cliente', motivo: 'cadastro_incompleto', campos: ['CEP'] });
    expect(r.pode_enviar).toBe(false);
    expect(r.bloqueio).toBe('Cadastro incompleto: falta CEP.');
  });
});

describe('RN-VEN-18 / RF-VEN-03: o pedido que nasce do orçamento leva tudo, menos o preço', () => {
  const ORIGEM = {
    id: '00000000-0000-4000-8000-000000000001',
    cliente_id: 'c1',
    desconto_pct: 0,
    desconto_valor_cents: 384,
    ajuste_em: 'valor' as const,
    condicao_pagamento_id: 'cp1',
    observacao: 'entregar sexta',
    visita_id: 'vis1',
    frete: { modalidade: 'FOB' as const, transportadora_id: 'tr1' },
    endereco_entrega_id: 'end1',
    itens: [
      { product_id: 'agu', quantity: 3, unidade: 'FD', desconto_pct: 5, ajuste_em: 'pct' as const },
      { product_id: 'caf', quantity: 12, unidade: 'UN', desconto_unitario_cents: 100, ajuste_em: 'valor' as const },
      { product_id: 'bis', quantity: 1, unidade: 'CX' },
    ],
  };
  it('RF-VEN-03: copia medida, ajustes do item e do pedido, frete, endereço, condição, observação e visita; origem = orçamento', () => {
    const p = pedidoDoOrcamento(ORIGEM, 'novo', '2026-11-04T10:00:00.000Z');
    expect(p).toMatchObject({
      id: 'novo',
      tipo: 'pedido',
      orcamento_origem_id: ORIGEM.id,
      customer_id: 'c1',
      desconto_valor_cents: 384,
      ajuste_em: 'valor',
      condicao_pagamento_id: 'cp1',
      observacao: 'entregar sexta',
      visita_id: 'vis1',
      frete: { modalidade: 'FOB', transportadora_id: 'tr1' },
      endereco_entrega_id: 'end1',
      created_offline_at: '2026-11-04T10:00:00.000Z',
    });
    expect(p.items).toEqual([
      { product_id: 'agu', quantity: 3, unidade: 'FD', desconto_pct: 5, ajuste_em: 'pct' },
      { product_id: 'caf', quantity: 12, unidade: 'UN', desconto_unitario_cents: 100, ajuste_em: 'valor' },
      { product_id: 'bis', quantity: 1, unidade: 'CX' },
    ]);
  });
  it('RF-VEN-03: o preço não é copiado (nenhum campo de preço no pedido nem nos itens)', () => {
    const p = pedidoDoOrcamento({ ...ORIGEM, itens: ORIGEM.itens.map((i) => ({ ...i, preco_unitario_cents: 999, total_cents: 999 })) } as never, 'novo', 'agora');
    expect(JSON.stringify(p)).not.toMatch(/preco|total_cents|unit_price/);
  });
  it('RF-VEN-03: duplicar copia o mesmo conteúdo como rascunho novo, sem origem', () => {
    const d = duplicarDocumento(ORIGEM, 'dup', '2026-11-12T10:00:00.000Z');
    expect(d).toMatchObject({ id: 'dup', tipo: 'pedido', desconto_valor_cents: 384, endereco_entrega_id: 'end1', frete: { modalidade: 'FOB', transportadora_id: 'tr1' } });
    expect(d).not.toHaveProperty('orcamento_origem_id');
    expect(d.items[1]).toEqual({ product_id: 'caf', quantity: 12, unidade: 'UN', desconto_unitario_cents: 100, ajuste_em: 'valor' });
  });
});

describe('RN-VEN-18 / RN-VEN-02: a cópia leva só o modo gravado (ajuste_em), como a linha chega do pull', () => {
  // o servidor grava SEMPRE os dois (R$ e % equivalente); copiar os dois daria 422 ajuste_invalido
  const DO_PULL = {
    id: '00000000-0000-4000-8000-000000000002',
    cliente_id: 'c1',
    desconto_pct: 1,
    desconto_valor_cents: 384,
    acrescimo_pct: 0,
    acrescimo_valor_cents: 0,
    ajuste_em: 'valor' as const,
    condicao_pagamento_id: null,
    observacao: null,
    visita_id: null,
    itens: [
      { product_id: 'caf', quantity: 12, unidade: 'UN', desconto_pct: 5.3, desconto_unitario_cents: 100, acrescimo_unitario_cents: 0, ajuste_em: 'valor' as const },
      { product_id: 'agu', quantity: 3, unidade: 'FD', desconto_pct: 5, desconto_unitario_cents: 89, ajuste_em: 'pct' as const },
    ],
  };
  const aceita = (p: Pick<ReturnType<typeof pedidoDoOrcamento>, 'discount_pct' | 'items'>) =>
    revalidarPedido({
      perfil: 'vendedor',
      vendedor_id: 'v1',
      cliente_id: 'c1',
      carteira: ['c1'],
      desconto_pct: p.discount_pct,
      acrescimo_pct: (p as { acrescimo_pct?: number }).acrescimo_pct,
      desconto_valor_cents: (p as { desconto_valor_cents?: number }).desconto_valor_cents,
      acrescimo_valor_cents: (p as { acrescimo_valor_cents?: number }).acrescimo_valor_cents,
      itens: p.items.map((i) => ({ ...(i as object), sku: i.product_id })) as never,
      precos: { caf: 1890, agu: 1790 },
      policy: { seller_pct: 5, supervisor_pct: 10, manager_pct: 15, above_manager: 'director', exceptions: {} },
    });
  it('RN-VEN-18: Transformar com R$ no item e R$ no pedido leva só o valor e passa no receber', () => {
    const p = pedidoDoOrcamento(DO_PULL, 'novo', 'agora');
    expect(p.items[0]).toEqual({ product_id: 'caf', quantity: 12, unidade: 'UN', desconto_unitario_cents: 100, ajuste_em: 'valor' });
    expect(p.items[1]).toEqual({ product_id: 'agu', quantity: 3, unidade: 'FD', desconto_pct: 5, ajuste_em: 'pct' });
    expect(p.discount_pct).toBe(0);
    expect(p).toMatchObject({ desconto_valor_cents: 384, ajuste_em: 'valor' });
    expect(aceita(p)).toMatchObject({ ok: true });
  });
  it('RN-VEN-02: Duplicar com R$ no item e % no pedido leva só o %', () => {
    const d = duplicarDocumento({ ...DO_PULL, desconto_pct: 1, ajuste_em: 'pct' }, 'dup', 'agora');
    expect(d.discount_pct).toBe(1);
    expect(d).not.toHaveProperty('desconto_valor_cents');
    expect(d).not.toHaveProperty('acrescimo_valor_cents');
    expect(aceita(d)).toMatchObject({ ok: true });
  });
  it('RN-VEN-02: acréscimo do pedido em % (legado, sem ajuste_em) copia só o %', () => {
    const p = pedidoDoOrcamento({ ...DO_PULL, desconto_pct: 0, desconto_valor_cents: 0, acrescimo_pct: 2, ajuste_em: undefined }, 'novo', 'agora');
    expect(p).toMatchObject({ discount_pct: 0, acrescimo_pct: 2 });
    expect(p).not.toHaveProperty('desconto_valor_cents');
  });
});

describe('RN-VEN-18 (T-0134): preço congelado no orçamento', () => {
  it('RN-VEN-18: precosCongelados devolve o preço de tabela por UNIDADE do que foi salvo (CX c/ 12 de R$ 21,48 = R$ 1,79 a unidade)', () => {
    expect(precosCongelados([{ product_id: 'agu', preco_tabela_cents: 2148, fator: 12 }, { product_id: 'caf', preco_tabela_cents: 1890, fator: 1 }])).toEqual({ agu: 179, caf: 1890 });
    expect(precosCongelados([{ product_id: 'x', preco_tabela_cents: 0, fator: 1 }])).toEqual({});
  });
  it('RN-VEN-18: editar não reprecifica item salvo (a tabela de hoje e as faixas de hoje são ignoradas)', () => {
    const r = precoDoItemNaEdicao({ congelado_cents: 1890, hoje_cents: 1950, faixas_hoje: ['faixa'] });
    expect(r).toEqual({ preco_unidade_cents: 1890, faixas: undefined, congelado: true });
  });
  it('RN-VEN-18: o item NOVO da edição entra pelo preço de hoje (com as faixas de hoje)', () => {
    expect(precoDoItemNaEdicao({ hoje_cents: 1950, faixas_hoje: ['faixa'] })).toEqual({ preco_unidade_cents: 1950, faixas: ['faixa'], congelado: false });
    expect(precoDoItemNaEdicao({ congelado_cents: null, hoje_cents: null })).toMatchObject({ preco_unidade_cents: null, congelado: false });
  });
});
