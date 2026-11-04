/**
 * T-0071 (desenho §1): orçamento v2 — validade por data civil (RN-VEN-18), ações por situação, reconferir ao transformar,
 * opções do Salvar (RN-VEN-13) e cópia COMPLETA ao transformar ou duplicar. Funções puras; o "agora" é sempre argumento.
 */
import { describe, expect, it } from 'vitest';

import { politicaDosParametros } from './aprovacao';
import {
  acoesDoOrcamento,
  duplicarDocumento,
  opcoesDoSalvar,
  pedidoDoOrcamento,
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
  it('RN-VEN-18: preço alterado (café 18,90 → 19,50) mantém o R$ 1,00 e registra a mudança', () => {
    const r = reconferirOrcamento(orc, hoje({ itens: { ...hoje().itens, caf: dado(1950) } }));
    expect(r.mudancas).toEqual([{ tipo: 'preco', produto_id: 'caf', de_cents: 1890, para_cents: 1950 }]);
    expect(r.calculo.totais.total_cents).toBe(38692);
    expect(r.calculo.totais.desconto_efetivo_exibicao_pct).toBe(4.6);
    expect(r.calculo.nivel).toBeNull();
  });
  it('RN-VEN-10: a alçada recalculada aparece como mudança', () => {
    const r = reconferirOrcamento({ ...orc, ajuste_pedido: desc(4) }, hoje());
    expect(r.calculo.nivel).toBe('supervisor');
    expect(r.mudancas).toContainEqual({ tipo: 'alcada', de: null, para: 'supervisor' });
  });
  it('RN-CAT-06: produto sem preço hoje sai do pedido', () => {
    const r = reconferirOrcamento(orc, hoje({ itens: { ...hoje().itens, bis: { ...dado(0), tabela_cents: null } } }));
    expect(r.mudancas).toContainEqual({ tipo: 'sem_preco', produto_id: 'bis' });
    expect(r.rascunho.itens.map((i) => i.product_id)).toEqual(['agu', 'caf']);
  });
  it('RN-VEN-15: medida inativa sai do pedido', () => {
    const r = reconferirOrcamento(orc, hoje({ itens: { ...hoje().itens, bis: dado(11780, { fator: 20, medida_ativa: false }) } }));
    expect(r.mudancas).toContainEqual({ tipo: 'medida_inativa', produto_id: 'bis', unidade: 'CX' });
    expect(r.rascunho.itens).toHaveLength(2);
  });
  it('RN-VEN-11: o mínimo subiu — o ajuste do item é reduzido ao teto', () => {
    // mínimo base 1850 → café não pode ficar abaixo de 1850: R$ 1,00 → R$ 0,40
    const r = reconferirOrcamento(orc, hoje({ itens: { ...hoje().itens, caf: dado(1890, { minimo_base_cents: 1850 }) } }));
    expect(r.mudancas).toContainEqual({ tipo: 'ajuste_travado', produto_id: 'caf', de: descR(100), para: descR(40) });
    expect(r.rascunho.itens[1]!.ajuste).toEqual(descR(40));
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
