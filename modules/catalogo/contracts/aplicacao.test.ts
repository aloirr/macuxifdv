/** Contratos aditivos da aplicação e da referência cruzada (T-0084 C3-C9, T-0085 K4-K9; RN-CAT-09, RN-CAT-11, RN-CAT-12). */
import { describe, expect, it } from 'vitest';
import { EquivaleA, ParametrosCatalogo, Referencia, TrechoBusca } from './busca';
import { BuscaProdutosEntradaSchema, BuscaProdutosSaidaSchema, TextosProdutoEntradaSchema, TextosProdutoSaidaSchema } from './consultas';
import { ConteudoProduto, FichaProduto, SalvarCadastroCatalogo } from './rotas';
import { ProdutoConteudoSyncSchema, ProdutoReferenciaSyncSchema } from './sync-conteudo';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('RN-CAT-11 / RN-CAT-12: parâmetros e conteúdo', () => {
  it('RN-CAT-12: peso_aplicacao padrão 0,5 e entre 0 e 1', () => {
    expect(ParametrosCatalogo.parse({}).peso_aplicacao).toBe(0.5);
    expect(ParametrosCatalogo.safeParse({ peso_aplicacao: 1.1 }).success).toBe(false);
  });

  it('RN-CAT-11: aplicacao_max_cadastro padrão 2000, de 100 a 2000', () => {
    expect(ParametrosCatalogo.parse({}).aplicacao_max_cadastro).toBe(2000);
    expect(ParametrosCatalogo.safeParse({ aplicacao_max_cadastro: 99 }).success).toBe(false);
    expect(ParametrosCatalogo.safeParse({ aplicacao_max_cadastro: 2001 }).success).toBe(false);
  });

  it('RN-CAT-11: o pull do conteúdo aceita aplicacao (até 2000) e etiquetas (até 4 de 20), ambas opcionais', () => {
    const base = { id: U(1), updated_at: '2026-11-05T10:00:00.000000Z', deleted_at: null, external_id: null, produto_id: U(2), descricao: null };
    expect(ProdutoConteudoSyncSchema.safeParse(base).success).toBe(true);
    expect(ProdutoConteudoSyncSchema.safeParse({ ...base, aplicacao: 'x'.repeat(2000), etiquetas: ['Novo'] }).success).toBe(true);
    expect(ProdutoConteudoSyncSchema.safeParse({ ...base, aplicacao: 'x'.repeat(2001) }).success).toBe(false);
    expect(ProdutoConteudoSyncSchema.safeParse({ ...base, etiquetas: ['a', 'b', 'c', 'd', 'e'] }).success).toBe(false);
  });

  it('RN-CAT-11: a aplicação do conteúdo é opcional (ausente = não altera) e recusa acima de 2000', () => {
    expect(ConteudoProduto.parse({}).aplicacao).toBeUndefined();
    expect(ConteudoProduto.parse({ aplicacao: null }).aplicacao).toBeNull();
    expect(ConteudoProduto.safeParse({ aplicacao: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('RN-CAT-12: o trecho "Serve em" tem até 90 caracteres e 20 marcas', () => {
    expect(TrechoBusca.safeParse({ texto: 'Fiat Uno 2010–2014', marcas: [[9, 18]], inclui_ano: 2012 }).success).toBe(true);
    expect(TrechoBusca.safeParse({ texto: 'x'.repeat(91), marcas: [], inclui_ano: null }).success).toBe(false);
    expect(TrechoBusca.safeParse({ texto: 'a', marcas: Array.from({ length: 21 }, () => [0, 1]), inclui_ano: null }).success).toBe(false);
    expect(TrechoBusca.safeParse({ texto: 'a', marcas: [], inclui_ano: 1800 }).success).toBe(false);
  });
});

describe('RN-CAT-09: referência cruzada', () => {
  it('RN-CAT-09: referência tem marca e código de até 30 caracteres', () => {
    expect(Referencia.safeParse({ marca_id: U(3), marca_nome: 'Freiomax', codigo: 'CB 3401' }).success).toBe(true);
    expect(Referencia.safeParse({ marca_id: U(3), marca_nome: 'Freiomax', codigo: 'x'.repeat(31) }).success).toBe(false);
    expect(EquivaleA.safeParse({ marca_id: U(3), marca_nome: 'Freiomax', codigo: 'CB 3401', marcas: [[9, 16]] }).success).toBe(true);
  });

  it('RN-CAT-09: o pull de produto_referencia tem ordem de 1 a 3 e código de 1 a 30', () => {
    const ok = { id: U(1), updated_at: '2026-11-05T10:00:00.000000Z', deleted_at: null, external_id: null, produto_id: U(2), marca_id: U(3), codigo: 'CB 3401', ordem: 1 };
    expect(ProdutoReferenciaSyncSchema.safeParse(ok).success).toBe(true);
    expect(ProdutoReferenciaSyncSchema.safeParse({ ...ok, ordem: 4 }).success).toBe(false);
    expect(ProdutoReferenciaSyncSchema.safeParse({ ...ok, codigo: '' }).success).toBe(false);
  });

  it('RN-CAT-09: a ficha aceita a seção Catálogo com até 3 referências e 5 oferece junto', () => {
    const catalogo = { aplicacao: null, referencias: [], oferece_junto: [], etiquetas: [] };
    const ficha = FichaProduto.shape.catalogo.unwrap();
    expect(ficha.safeParse(catalogo).success).toBe(true);
    expect(ficha.safeParse({ ...catalogo, referencias: Array.from({ length: 4 }, () => ({ marca_id: U(3), marca_nome: 'M', codigo: 'A1' })) }).success).toBe(false);
    expect(ficha.safeParse({ ...catalogo, oferece_junto: Array.from({ length: 6 }, (_, i) => ({ produto_id: U(10 + i), erp_code: 'X', description: 'Y' })) }).success).toBe(false);
  });

  it('RN-CAT-09: o corpo de cadastro-catalogo traz os quatro campos', () => {
    expect(SalvarCadastroCatalogo.safeParse({ aplicacao: null, oferece_junto: [], referencias: [{ marca_id: U(3), codigo: 'CB 3401' }], etiquetas: [] }).success).toBe(true);
    expect(SalvarCadastroCatalogo.safeParse({ aplicacao: null }).success).toBe(false);
  });
});

describe('consultas catalogo.textos_produto@1 e catalogo.busca_produtos@1', () => {
  it('T-0084 C8: textos_produto aceita de 1 a 500 ids e é strict', () => {
    expect(TextosProdutoEntradaSchema.safeParse({ produto_ids: [U(1)] }).success).toBe(true);
    expect(TextosProdutoEntradaSchema.safeParse({ produto_ids: [] }).success).toBe(false);
    expect(TextosProdutoEntradaSchema.safeParse({ produto_ids: Array.from({ length: 501 }, (_, i) => U(i + 1)) }).success).toBe(false);
    expect(TextosProdutoEntradaSchema.safeParse({ produto_ids: [U(1)], extra: 1 }).success).toBe(false);
    expect(TextosProdutoSaidaSchema.safeParse({ itens: [{ produto_id: U(1), aplicacao: null, referencias: [] }] }).success).toBe(true);
  });

  it('T-0084 C9: busca_produtos tem q de 1 a 200, limite padrão 100 e até 5000 ids', () => {
    expect(BuscaProdutosEntradaSchema.parse({ q: 'pastilha uno 2012' }).limite).toBe(100);
    expect(BuscaProdutosEntradaSchema.safeParse({ q: '' }).success).toBe(false);
    expect(BuscaProdutosEntradaSchema.safeParse({ q: 'a'.repeat(201) }).success).toBe(false);
    expect(BuscaProdutosEntradaSchema.safeParse({ q: 'a', limite: 201 }).success).toBe(false);
    expect(BuscaProdutosSaidaSchema.safeParse({ itens: [{ produto_id: U(1), nota: 0.9, so_aplicacao: false, serve_em: null, equivale_a: null }] }).success).toBe(true);
  });
});
