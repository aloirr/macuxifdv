import { describe, expect, it } from 'vitest';
import { contarPorNo, descendentesDe, filhosDe, montarArvore, produtosDoNo, produtosVendaveisNaTabela, trilhaDe, type NoCatalogo } from './arvore';

const no = (id: string, pai: string | null, nivel: number, nome: string, ordem = 0, extra: Partial<NoCatalogo> = {}): NoCatalogo => ({ id, pai_id: pai, nivel, codigo: id.toUpperCase(), nome, ordem, ativo: true, ...extra });

// Bebidas > Refrigerantes > Cola 2L ; Bebidas > Sucos ; Mercearia
const nos = [
  no('mercearia', null, 1, 'Mercearia', 2),
  no('bebidas', null, 1, 'Bebidas', 1),
  no('refri', 'bebidas', 2, 'Refrigerantes', 1),
  no('sucos', 'bebidas', 2, 'Sucos', 2),
  no('cola', 'refri', 3, 'Cola 2L', 1),
];
const vinculos = [
  { produto_id: 'p1', no_id: 'cola' },
  { produto_id: 'p2', no_id: 'sucos' },
  { produto_id: 'p3', no_id: 'mercearia' },
  { produto_id: 'p4', no_id: 'refri' },
];

describe('RF-CAT-04: árvore do catálogo do tenant', () => {
  const arvore = montarArvore(nos);

  it('RF-CAT-04: a raiz vem ordenada por ordem e depois por nome, com os níveis do ERP', () => {
    expect(filhosDe(arvore, null).map((n) => n.nome)).toEqual(['Bebidas', 'Mercearia']);
    expect(filhosDe(arvore, 'bebidas').map((n) => n.nome)).toEqual(['Refrigerantes', 'Sucos']);
  });

  it('RF-CAT-04: empate de ordem desempata pelo nome (pt-BR)', () => {
    const a = montarArvore([no('b', null, 1, 'Zebra'), no('a', null, 1, 'Água'), no('c', null, 1, 'Bala')]);
    expect(filhosDe(a, null).map((n) => n.nome)).toEqual(['Água', 'Bala', 'Zebra']);
  });

  it('RF-CAT-04: trilha clicável vai da raiz até o nó escolhido', () => {
    expect(trilhaDe(arvore, 'cola').map((n) => n.nome)).toEqual(['Bebidas', 'Refrigerantes', 'Cola 2L']);
    expect(trilhaDe(arvore, null)).toEqual([]);
    expect(trilhaDe(arvore, 'nao-existe')).toEqual([]);
  });

  it('RF-CAT-04: nó inativo ou removido some, e leva os filhos junto (nada fica órfão na tela)', () => {
    const a = montarArvore([...nos.slice(0, 2), no('refri', 'bebidas', 2, 'Refrigerantes', 1, { ativo: false }), no('cola', 'refri', 3, 'Cola 2L'), no('sucos', 'bebidas', 2, 'Sucos', 2, { deleted_at: '2026-11-01T00:00:00Z' })]);
    expect(filhosDe(a, 'bebidas')).toEqual([]);
    expect(trilhaDe(a, 'cola')).toEqual([]);
  });

  it('RF-CAT-04: nó cujo pai não existe não entra (dado inconsistente do ERP não derruba a tela)', () => {
    const a = montarArvore([...nos, no('x', 'fantasma', 2, 'Solto')]);
    expect(filhosDe(a, 'fantasma')).toEqual([]);
    expect(trilhaDe(a, 'x')).toEqual([]);
  });

  it('RF-CAT-04: ciclo no pai não trava (nó ignorado)', () => {
    const a = montarArvore([no('a', 'b', 2, 'A'), no('b', 'a', 2, 'B')]);
    expect(filhosDe(a, null)).toEqual([]);
  });

  it('RF-CAT-04: descendentes incluem o próprio nó', () => {
    expect([...descendentesDe(arvore, 'bebidas')].sort()).toEqual(['bebidas', 'cola', 'refri', 'sucos']);
    expect([...descendentesDe(arvore, 'cola')]).toEqual(['cola']);
  });

  it('RF-CAT-04: produtos do nó = os dele e os de todos os níveis abaixo', () => {
    expect([...produtosDoNo(arvore, vinculos, 'bebidas')].sort()).toEqual(['p1', 'p2', 'p4']);
    expect([...produtosDoNo(arvore, vinculos, 'refri')].sort()).toEqual(['p1', 'p4']);
    expect([...produtosDoNo(arvore, vinculos, null)].sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('RF-CAT-04: vínculo removido não conta', () => {
    expect([...produtosDoNo(arvore, [...vinculos, { produto_id: 'p9', no_id: 'cola', deleted_at: '2026-11-01T00:00:00Z' }], 'cola')]).toEqual(['p1']);
  });

  it('RF-CAT-04: contagem por filho respeita o conjunto permitido (ex.: só a tabela do cliente, só com estoque)', () => {
    expect(Object.fromEntries(contarPorNo(arvore, vinculos, null))).toEqual({ bebidas: 3, mercearia: 1 });
    expect(Object.fromEntries(contarPorNo(arvore, vinculos, 'bebidas', new Set(['p1', 'p2'])))).toEqual({ refri: 1, sucos: 1 });
  });

});

describe('RF-CAT-04 / RN-CAT-06: dentro do pedido só os produtos da tabela de preço do cliente', () => {
  const item = (produto: string, tabela: string, extra: Record<string, unknown> = {}) => ({ price_table_id: tabela, product_id: produto, price_cents: 1000, valid_from: '2026-10-01T00:00:00Z', valid_to: null, ...extra });
  const agora = '2026-11-02T12:00:00Z';

  it('RN-CAT-06: só entram produtos com preço vigente na tabela do cliente; o resto da tabela padrão ou de outra tabela fica fora', () => {
    const itens = [item('p1', 'T1'), item('p2', 'T2'), item('p3', 'T1', { valid_to: '2026-10-15T00:00:00Z' }), item('p4', 'T1', { valid_from: '2026-12-01T00:00:00Z' })];
    expect([...produtosVendaveisNaTabela(itens, 'T1', agora)]).toEqual(['p1']);
  });

  it('RN-CAT-06: cliente sem tabela não tem nenhum produto vendável', () => {
    expect(produtosVendaveisNaTabela([item('p1', 'T1')], null, agora).size).toBe(0);
  });
});
