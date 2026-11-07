import { describe, expect, it } from 'vitest';

import type { Product } from '@macuxi/catalogo/contracts';
import { politicaApi } from './pull';
import {
  alternarUnidade,
  calcularPedido,
  ajusteDoTipo,
  faixasPorProduto,
  tipoDoAjuste,
  trocarTipoDoAjuste,
  valorDoAjuste,
  chaveDaLinha,
  enderecosDoCliente,
  freteValido,
  lerChaveDaLinha,
  linhasParaPush,
  rotuloDoFrete,
  textoDoEndereco,
  transportadorasAtivas,
  unidadesDoProduto,
  type EntradaCalculo,
  type UnidadeDaTela,
} from './novo-pedido';

const P = (id: string, preco: number | null, unit = 'UN'): Product =>
  ({ id, erp_code: id.toUpperCase(), description: `Produto ${id}`, unit, price_cents: preco, stock_total: 1_000_000, stock: [], brand: '', line: '', ean: null, active: true, external_id: null, applications: '', is_campaign: false }) as Product;

const UNIDADES: UnidadeDaTela[] = [
  { produto_id: 'a', unidade: 'UN', fator: 1, padrao: true },
  { produto_id: 'a', unidade: 'CX', fator: 12, padrao: false },
];
const policy = politicaApi({});

const entrada = (o: Partial<EntradaCalculo> = {}): EntradaCalculo => ({
  lines: { a: 1, b: 1 },
  ajustes: {},
  acrescimo_pct: 0,
  desconto_pct: 0,
  catalogo: [P('a', 1000), P('b', 5000)],
  unidades: UNIDADES,
  politica: policy,
  vendedor_id: 'v1',
  ...o,
});

describe('chave da linha (produto + medida)', () => {
  it('RN-VEN-15: a unidade base usa só o id do produto (rascunhos antigos continuam válidos) e a embalagem usa id@UNIDADE', () => {
    expect(chaveDaLinha('a', null)).toBe('a');
    expect(chaveDaLinha('a', 'CX')).toBe('a@CX');
    expect(lerChaveDaLinha('a')).toEqual({ product_id: 'a', unidade: null });
    expect(lerChaveDaLinha('a@CX')).toEqual({ product_id: 'a', unidade: 'CX' });
  });
  it('RN-VEN-15: o produto oferece a unidade base primeiro e depois as embalagens ativas', () => {
    expect(unidadesDoProduto('a', UNIDADES, 'UN').map((u) => u.unidade)).toEqual(['UN', 'CX']);
    expect(unidadesDoProduto('b', UNIDADES, 'PC')).toEqual([{ produto_id: 'b', unidade: 'PC', fator: 1, padrao: true }]);
  });
  it('RN-VEN-15: trocar a medida move a quantidade da linha (até 3 toques: escolher, quantidade)', () => {
    expect(alternarUnidade({ a: 3, b: 1 }, {}, 'a', null, 'CX')).toEqual({ lines: { b: 1, 'a@CX': 3 }, ajustes: {} });
  });
});

describe('calcularPedido: desconto e acréscimo por item e por pedido (RN-VEN-02/03/10)', () => {
  it('RN-VEN-15: a CX cobra UN × fator e conta quantidade em unidades base', () => {
    const c = calcularPedido(entrada({ lines: { 'a@CX': 2 } }));
    expect(c.linhas[0]).toMatchObject({ unidade: 'CX', fator: 12, quantity: 2, quantidade_base: 24, preco_tabela_cents: 12_000, total_cents: 24_000 });
    expect(c.total_cents).toBe(24_000);
  });
  it('RN-VEN-10: 30% no item que dá 5% efetivo no pedido não vai para aprovação', () => {
    const c = calcularPedido(entrada({ ajustes: { a: { desconto_pct: 30 } } }));
    expect(c.desconto_efetivo_pct).toBe(5);
    expect(c.nivel).toBeNull();
    expect(c.total_cents).toBe(5_700);
  });
  it('RN-VEN-10: acima da alçada vai ao nível certo; acréscimo nunca', () => {
    expect(calcularPedido(entrada({ desconto_pct: 8 })).nivel).toBe('supervisor');
    expect(calcularPedido(entrada({ acrescimo_pct: 20 })).nivel).toBeNull();
  });
  it('RN-VEN-02: desconto e acréscimo no mesmo item ou no pedido geram erro de tela em português', () => {
    expect(calcularPedido(entrada({ ajustes: { a: { desconto_pct: 5, acrescimo_pct: 5 } } })).erros.join(' ')).toMatch(/excludentes/);
    expect(calcularPedido(entrada({ desconto_pct: 5, acrescimo_pct: 5 })).erros.join(' ')).toMatch(/excludentes/);
  });
  it('RN-CAT-06: produto sem preço na tabela do cliente bloqueia o envio', () => {
    const c = calcularPedido(entrada({ catalogo: [P('a', null), P('b', 5000)] }));
    expect(c.erros.join(' ')).toMatch(/sem preço/i);
  });
  it('RN-VEN-10: acima da alçada do gerente com bloqueio impede o envio', () => {
    const c = calcularPedido(entrada({ desconto_pct: 20, politica: politicaApi({ 'alcada.acima_gerente': 'bloquear' }) }));
    expect(c.bloqueado).toBe(true);
    expect(c.erros.join(' ')).toMatch(/alçada máxima/);
  });
  it('pedido sem itens não tem erro de tela (só o botão fica desligado)', () => {
    const c = calcularPedido(entrada({ lines: {} }));
    expect(c.linhas).toHaveLength(0);
    expect(c.total_cents).toBe(0);
  });
});

describe('push do pedido novo', () => {
  it('RN-VEN-15: só a embalagem leva `unidade`; desconto/acréscimo só quando existem (payload igual ao dos APKs anteriores)', () => {
    const c = calcularPedido(entrada({ lines: { a: 1, 'a@CX': 2 }, ajustes: { 'a@CX': { desconto_pct: 10 } } }));
    expect(linhasParaPush(c.linhas)).toEqual([
      { product_id: 'a', quantity: 1 },
      { product_id: 'a', quantity: 2, unidade: 'CX', desconto_pct: 10 },
    ]);
  });
});

describe('RN-VEN-16: frete CIF/FOB sem valor', () => {
  it('RN-VEN-16: CIF vale sem transportadora; FOB exige cadastrada ou digitada válida', () => {
    expect(freteValido({ modalidade: 'CIF' })).toBeNull();
    expect(freteValido({ modalidade: 'FOB' })).toMatch(/Informe a transportadora do frete FOB/);
    expect(freteValido({ modalidade: 'FOB', transportadora_id: 't1' })).toBeNull();
    expect(freteValido({ modalidade: 'FOB', transportadora_digitada: { nome: 'Fluvial', cnpj: '11222333000181' } })).toBeNull();
    expect(freteValido({ modalidade: 'FOB', transportadora_digitada: { nome: 'Fluvial', cnpj: '11222333000182' } })).toMatch(/CNPJ/);
  });
  it('RN-VEN-16: a lista de transportadoras mostra só as ativas, em ordem de nome', () => {
    const l = transportadorasAtivas([
      { id: '2', nome: 'Zeta', documento: null, telefone: null, ativo: true },
      { id: '1', nome: 'Alfa', documento: null, telefone: null, ativo: true },
      { id: '3', nome: 'Inativa', documento: null, telefone: null, ativo: false },
    ]);
    expect(l.map((t) => t.nome)).toEqual(['Alfa', 'Zeta']);
  });
  it('RN-VEN-16: rótulo curto do frete para a tela', () => {
    expect(rotuloDoFrete({ modalidade: 'CIF' }, [])).toBe('CIF · por conta da empresa');
    expect(rotuloDoFrete({ modalidade: 'FOB', transportadora_id: 't1' }, [{ id: 't1', nome: 'Rápido Norte', documento: null, telefone: null, ativo: true }])).toBe('FOB · por conta do cliente · Rápido Norte');
    expect(rotuloDoFrete({ modalidade: 'FOB' }, [])).toBe('FOB · falta a transportadora');
  });
});

describe('RN-VEN-17: endereço de entrega', () => {
  const E = [
    { id: 'e2', cliente_id: 'c1', tipo: 'entrega', logradouro: 'Av. Depósito', numero: '5', complemento: null, bairro: 'Distrito', cidade: 'Manaus', uf: 'AM', cep: null, principal: false, ativo: true, descricao: 'Depósito' },
    { id: 'e1', cliente_id: 'c1', tipo: 'principal', logradouro: 'Rua Central', numero: '10', complemento: null, bairro: 'Centro', cidade: 'Manaus', uf: 'AM', cep: null, principal: true, ativo: true, descricao: null },
    { id: 'e3', cliente_id: 'c1', tipo: 'cobranca', logradouro: 'Rua Cobrança', numero: null, complemento: null, bairro: null, cidade: 'Manaus', uf: 'AM', cep: null, principal: false, ativo: true, descricao: null },
    { id: 'x', cliente_id: 'c2', tipo: 'principal', logradouro: 'Outra', numero: null, complemento: null, bairro: null, cidade: 'Manaus', uf: 'AM', cep: null, principal: true, ativo: true, descricao: null },
  ];
  it('RN-VEN-17: o cliente oferece o principal primeiro e os de entrega; cobrança não entra', () => {
    expect(enderecosDoCliente(E, 'c1').map((e) => e.id)).toEqual(['e1', 'e2']);
  });
  it('RN-VEN-17: texto curto do endereço', () => {
    expect(textoDoEndereco(E[1]!)).toBe('Rua Central, 10 · Centro · Manaus/AM');
  });
});

describe('RN-VEN-15 e RN-VEN-23: embalagem = UN x fator e faixa escalonada no aparelho', () => {
  it('RN-VEN-15: a caixa é sempre unidade × fator, sem preço próprio de caixa', () => {
    const c = calcularPedido(entrada({ lines: { 'a@CX': 2, b: 1 } }));
    expect(c.linhas.find((l) => l.chave === 'a@CX')!.total_cents).toBe(24_000);
    expect(c.linhas.find((l) => l.chave === 'b')!.total_cents).toBe(5000);
  });
  it('RN-VEN-23: a faixa entra ao atingir a quantidade e sai ao reduzir', () => {
    const faixas = { a: [{ medida: 'CX', quantidade_minima: 10, preco_unidade_cents: 900 }] };
    // a: R$ 10,00 a unidade, CX de 12 = 12.000; na faixa, 12 x 900 = 10.800 por CX
    expect(calcularPedido(entrada({ lines: { 'a@CX': 10 }, faixas })).linhas[0]!.preco_tabela_cents).toBe(10_800);
    expect(calcularPedido(entrada({ lines: { 'a@CX': 9 }, faixas })).linhas[0]!.preco_tabela_cents).toBe(12_000);
  });
  it('RN-VEN-23: faixasPorProduto indexa por produto e ignora item sem faixa', () => {
    expect(faixasPorProduto([{ produto_id: 'a', faixas: [{ medida: 'CX', quantidade_minima: 10, preco_unidade_cents: 900 }] } as never, { produto_id: 'b' }])).toEqual({
      a: [{ medida: 'CX', quantidade_minima: 10, preco_unidade_cents: 900 }],
    });
  });
});

describe('T-0071: preço v2 no app (RN-VEN-02/03/10) com ajuste em % ou R$', () => {
  const REF = [P('agua', 1790), P('cafe', 1890), P('gas', 11780)];
  const refEntrada = (o: Partial<EntradaCalculo> = {}): EntradaCalculo =>
    entrada({
      catalogo: REF,
      unidades: [],
      lines: { agua: 3, cafe: 12, gas: 1 },
      ajustes: { agua: { desconto_pct: 5 }, cafe: { em: 'valor', desconto_cents: 100 } },
      desconto_pct: 1,
      ...o,
    });
  it('RN-VEN-02/03: referência 398,30 → 379,79 (tabela 39830, itens 38363, pedido 384, descontos 1851, exibido 4,6%)', () => {
    const c = calcularPedido(refEntrada());
    expect(c.linhas.map((l) => l.preco_unitario_cents)).toEqual([1701, 1790, 11780]);
    expect(c.total_tabela_cents).toBe(39830);
    expect(c.total_itens_cents).toBe(38363);
    expect(c.desconto_cents).toBe(384);
    expect(c.linhas.map((l) => l.total_cents)).toEqual([5052, 21265, 11662]);
    expect(c.total_cents).toBe(37979);
    expect(c.descontos_cents).toBe(1851);
    expect(c.desconto_efetivo_exibicao_pct).toBe(4.6);
    expect(c.nivel).toBeNull();
    expect(c.erros).toEqual([]);
  });
  it('RN-VEN-02: desconto do pedido em R$ 3,84 dá o mesmo total que 1%', () => {
    const c = calcularPedido(refEntrada({ desconto_pct: 0, ajuste_em: 'valor', desconto_valor_cents: 384 }));
    expect(c.total_cents).toBe(37979);
    expect(c.ajuste_pedido).toEqual({ sentido: 'desconto', cents: 384, pct_exibicao: 1 });
  });
  it('RN-VEN-02: equivalente do item ("R$ 17,90 → 17,01" e "= 5,3%") sai do cálculo', () => {
    const c = calcularPedido(refEntrada());
    expect(c.linhas[0]!.equivalente).toEqual({ sentido: 'desconto', cents: 89, pct_exibicao: 5 });
    expect(c.linhas[1]).toMatchObject({ ajuste_em: 'valor', desconto_unitario_cents: 100, preco_unitario_cents: 1790 });
    expect(c.linhas[1]!.equivalente).toEqual({ sentido: 'desconto', cents: 100, pct_exibicao: 5.3 });
    expect(c.linhas[2]!.equivalente).toBeNull();
  });
  it('RN-VEN-02: acréscimo em R$ por unidade soma ao preço da medida; acima do preço de tabela o desconto em R$ é erro de tela', () => {
    const c = calcularPedido(entrada({ lines: { a: 2 }, ajustes: { a: { em: 'valor', acrescimo_cents: 50 } } }));
    expect(c.linhas[0]).toMatchObject({ preco_unitario_cents: 1050, total_cents: 2100 });
    const e = calcularPedido(entrada({ lines: { a: 1 }, ajustes: { a: { em: 'valor', desconto_cents: 1001 } } }));
    expect(e.erros.join(' ')).toMatch(/passa do preço de tabela/);
  });
  it('RN-VEN-02: só o modo escolhido vale (R$ ignora o % que sobrou) e desconto + acréscimo em R$ são excludentes', () => {
    const c = calcularPedido(entrada({ lines: { a: 1 }, ajustes: { a: { em: 'valor', desconto_cents: 100, desconto_pct: 50 } } }));
    expect(c.linhas[0]!.total_cents).toBe(900);
    expect(calcularPedido(entrada({ lines: { a: 1 }, ajustes: { a: { em: 'valor', desconto_cents: 10, acrescimo_cents: 10 } } })).erros.join(' ')).toMatch(/excludentes/);
    expect(calcularPedido(entrada({ ajuste_em: 'valor', desconto_valor_cents: 10, acrescimo_valor_cents: 10 })).erros.join(' ')).toMatch(/excludentes/);
  });
  it('RN-VEN-02: desconto do pedido em R$ acima do total dos itens é erro de tela', () => {
    const c = calcularPedido(entrada({ ajuste_em: 'valor', desconto_valor_cents: 999_999 }));
    expect(c.erros.join(' ')).toMatch(/passa do total dos itens/);
  });
  it('RN-VEN-10: o R$ do pedido entra no efetivo da alçada pelo valor nominal', () => {
    const c = calcularPedido(refEntrada({ desconto_pct: 0, ajuste_em: 'valor', desconto_valor_cents: 384 }));
    expect(c.desconto_alcada_pct).toBe(4.65);
  });
  it('RN-VEN-02: o push leva R$ por unidade da medida (sem % junto) e a CX segue por unidade vendida', () => {
    const c = calcularPedido(entrada({ lines: { 'a@CX': 2 }, ajustes: { 'a@CX': { em: 'valor', desconto_cents: 500, desconto_pct: 7 } } }));
    expect(c.linhas[0]).toMatchObject({ preco_unitario_cents: 11_500, total_cents: 23_000 });
    expect(linhasParaPush(c.linhas)).toEqual([{ product_id: 'a', quantity: 2, unidade: 'CX', desconto_unitario_cents: 500, ajuste_em: 'valor' }]);
  });
});

describe('T-0089: tipo do ajuste do item (Desc % · Desc R$ · Acrésc % · Acrésc R$)', () => {
  it('RN-VEN-02: o tipo e o valor saem do ajuste do rascunho', () => {
    expect(tipoDoAjuste({})).toBe('desc_pct');
    expect(tipoDoAjuste({ em: 'pct', acrescimo_pct: 3 })).toBe('acresc_pct');
    expect(tipoDoAjuste({ em: 'valor', desconto_cents: 89 })).toBe('desc_reais');
    expect(valorDoAjuste({ em: 'valor', acrescimo_cents: 120 })).toBe(120);
  });
  it('RN-VEN-02: ajusteDoTipo nunca grava desconto e acréscimo juntos', () => {
    expect(ajusteDoTipo('acresc_pct', 5)).toEqual({ em: 'pct', acrescimo_pct: 5 });
    expect(ajusteDoTipo('desc_reais', 89)).toEqual({ em: 'valor', desconto_cents: 89 });
  });
  it('RN-VEN-02: trocar de desconto para acréscimo mantém o número; de % para R$ usa o equivalente da linha', () => {
    expect(trocarTipoDoAjuste({ em: 'pct', desconto_pct: 5 }, 'acresc_pct', null)).toEqual({ em: 'pct', acrescimo_pct: 5 });
    expect(trocarTipoDoAjuste({ em: 'pct', desconto_pct: 5 }, 'desc_reais', { cents: 89, pct_exibicao: 5 })).toEqual({ em: 'valor', desconto_cents: 89 });
    expect(trocarTipoDoAjuste({ em: 'valor', desconto_cents: 100 }, 'acresc_pct', { cents: 100, pct_exibicao: 5.3 })).toEqual({ em: 'pct', acrescimo_pct: 5.3 });
  });
});
