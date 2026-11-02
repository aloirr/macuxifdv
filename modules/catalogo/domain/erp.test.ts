import { describe, expect, it } from 'vitest';
import { planejarEstoqueDoErp, planejarNoDoErp, planejarPrecoDoErp, planejarProdutoNoDoErp } from './erp';

const preco = (extra: Record<string, unknown> = {}) => ({
  external_id: 'PR-1',
  acao: 'criado' as const,
  registro: { tabela_external_id: 'T1', tabela_nome: 'Atacado', vigencia_inicio: '2026-11-01', vigencia_fim: null, produto_external_id: 'P-1', preco_cents: 1500, ...extra },
});
const estoque = (extra: Record<string, unknown> = {}) => ({
  external_id: 'ES-1',
  acao: 'atualizado' as const,
  registro: { deposito_external_id: 'D1', deposito_nome: 'Matriz', produto_external_id: 'P-1', saldo: 12.5, ...extra },
});

describe('RN-INT-02: preço do ERP vira item de tabela do Catálogo', () => {
  it('RN-INT-02: preço válido vira upsert com tabela, produto, vigência e centavos', () => {
    expect(planejarPrecoDoErp(preco())).toEqual({
      tipo: 'upsert',
      linha: { external_id: 'PR-1', tabela_external_id: 'T1', tabela_nome: 'Atacado', produto_external_id: 'P-1', preco_cents: 1500, vigencia_inicio: '2026-11-01', vigencia_fim: null },
    });
  });
  it('RN-INT-02: ação inativado, registro inativo ou preço zerado inativam o item (nunca apagam)', () => {
    expect(planejarPrecoDoErp({ external_id: 'PR-1', acao: 'inativado' })).toEqual({ tipo: 'inativar', external_id: 'PR-1' });
    expect(planejarPrecoDoErp(preco({ ativo: false }))).toEqual({ tipo: 'inativar', external_id: 'PR-1' });
    expect(planejarPrecoDoErp(preco({ preco_cents: 0 }))).toEqual({ tipo: 'inativar', external_id: 'PR-1' });
  });
  it('RN-INT-02: evento sem registro e sem ser inativação é ignorado', () => {
    expect(planejarPrecoDoErp({ external_id: 'PR-1', acao: 'atualizado' })).toEqual({ tipo: 'ignorar' });
  });
  it('RN-INT-02: nome da tabela vazio usa o código da tabela', () => {
    const p = planejarPrecoDoErp(preco({ tabela_nome: '  ' }));
    expect(p.tipo === 'upsert' && p.linha.tabela_nome).toBe('T1');
  });
});

describe('RN-INT-02 / RF-CAT-03: saldo de estoque do ERP', () => {
  it('RF-CAT-03: saldo vira upsert por depósito e produto; nome do depósito ausente usa o código', () => {
    expect(planejarEstoqueDoErp(estoque({ deposito_nome: null }))).toEqual({
      tipo: 'upsert',
      linha: { external_id: 'ES-1', deposito_external_id: 'D1', deposito_nome: 'D1', produto_external_id: 'P-1', saldo: 12.5 },
    });
  });
  it('RN-INT-02: inativado ou registro inativo zera/inativa o saldo; sem registro é ignorado', () => {
    expect(planejarEstoqueDoErp({ external_id: 'ES-1', acao: 'inativado' })).toEqual({ tipo: 'inativar', external_id: 'ES-1' });
    expect(planejarEstoqueDoErp(estoque({ ativo: false }))).toEqual({ tipo: 'inativar', external_id: 'ES-1' });
    expect(planejarEstoqueDoErp({ external_id: 'ES-1', acao: 'criado' })).toEqual({ tipo: 'ignorar' });
  });
});

describe('RF-CAT-04: árvore do catálogo vinda do ERP (integracao.catalogo_no.atualizado@1)', () => {
  const no = (extra: Record<string, unknown> = {}) => ({
    external_id: 'N-2',
    acao: 'criado' as const,
    registro: { codigo: ' REF ', nome: ' Refrigerantes ', pai_external_id: 'N-1', nivel: 2, ordem: 3, ...extra },
  });
  it('RF-CAT-04: nó válido vira upsert com código e nome aparados e o pai pelo external_id', () => {
    expect(planejarNoDoErp(no())).toEqual({ tipo: 'upsert', linha: { external_id: 'N-2', codigo: 'REF', nome: 'Refrigerantes', pai_external_id: 'N-1', nivel: 2, ordem: 3 } });
  });
  it('RF-CAT-04: sem pai é raiz de nível 1', () => {
    expect(planejarNoDoErp(no({ pai_external_id: null, nivel: 1 }))).toMatchObject({ tipo: 'upsert', linha: { pai_external_id: null, nivel: 1 } });
  });
  it('RF-CAT-04: raiz com nível diferente de 1, ou filho no nível 1, é ignorado (o banco recusaria; o dado do ERP não trava a fila)', () => {
    expect(planejarNoDoErp(no({ pai_external_id: null, nivel: 2 }))).toEqual({ tipo: 'ignorar' });
    expect(planejarNoDoErp(no({ nivel: 1 }))).toEqual({ tipo: 'ignorar' });
  });
  it('RF-CAT-04: nó inativado pelo ERP some da árvore (soft delete), nunca é apagado', () => {
    expect(planejarNoDoErp({ external_id: 'N-2', acao: 'inativado' })).toEqual({ tipo: 'inativar', external_id: 'N-2' });
    expect(planejarNoDoErp(no({ ativo: false }))).toEqual({ tipo: 'inativar', external_id: 'N-2' });
  });
  it('RF-CAT-04: evento sem registro e sem ser inativação é ignorado; nome vazio também', () => {
    expect(planejarNoDoErp({ external_id: 'N-2', acao: 'atualizado' })).toEqual({ tipo: 'ignorar' });
    expect(planejarNoDoErp(no({ nome: '  ' }))).toEqual({ tipo: 'ignorar' });
  });
});

describe('RF-CAT-04: vínculo produto → nó (campo catalogo_no_external_id de integracao.produto.atualizado@1)', () => {
  it('RF-CAT-04: produto com nó vira vínculo; o external_id do vínculo é determinístico (reentrega não duplica)', () => {
    expect(planejarProdutoNoDoErp({ external_id: 'P-1', acao: 'atualizado', registro: { catalogo_no_external_id: 'N-2' } })).toEqual({ tipo: 'vincular', produto_external_id: 'P-1', no_external_id: 'N-2', external_id: 'P-1' });
  });
  it('RF-CAT-04: produto sem nó, ou inativado, solta o vínculo', () => {
    expect(planejarProdutoNoDoErp({ external_id: 'P-1', acao: 'atualizado', registro: { catalogo_no_external_id: null } })).toEqual({ tipo: 'desvincular', produto_external_id: 'P-1' });
    expect(planejarProdutoNoDoErp({ external_id: 'P-1', acao: 'inativado' })).toEqual({ tipo: 'desvincular', produto_external_id: 'P-1' });
  });
  it('RF-CAT-04: evento sem registro e sem ser inativação é ignorado', () => {
    expect(planejarProdutoNoDoErp({ external_id: 'P-1', acao: 'atualizado' })).toEqual({ tipo: 'ignorar' });
  });
});
