import { describe, expect, it } from 'vitest';

import type { Product } from '@macuxi/catalogo/contracts';
import { politicaApi } from './pull';
import {
  alternarUnidade,
  calcularPedido,
  embalagensDaConsulta,
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

describe('embalagens[] do catalogo.precos_cliente@1 (RN-VEN-15 / RN-CAT-06)', () => {
  it('RN-VEN-15: a caixa usa o preço próprio da embalagem quando a consulta traz; a UN continua pelo preço da unidade', () => {
    // CX de 12 a R$ 100,00 (preço próprio) em vez de 12 × R$ 10,00 = R$ 120,00
    const c = calcularPedido(entrada({ lines: { 'a@CX': 2, b: 1 }, embalagens: { a: { CX: 10_000 } } }));
    expect(c.linhas.find((l) => l.chave === 'a@CX')!.total_cents).toBe(20_000);
    expect(c.linhas.find((l) => l.chave === 'b')!.total_cents).toBe(5000);
  });
  it('RN-VEN-15: sem embalagens[] na consulta, a caixa é unidade × fator (como antes)', () => {
    const c = calcularPedido(entrada({ lines: { 'a@CX': 2 } }));
    expect(c.linhas[0]!.total_cents).toBe(24_000);
  });
  it('RN-VEN-15: embalagensDaConsulta indexa por produto e unidade e ignora item sem embalagens', () => {
    expect(
      embalagensDaConsulta([
        { produto_id: 'a', embalagens: [{ unidade: 'CX', preco_cents: 10_000 }] },
        { produto_id: 'b' },
        { produto_id: 'c', embalagens: [] },
      ]),
    ).toEqual({ a: { CX: 10_000 } });
  });
});
