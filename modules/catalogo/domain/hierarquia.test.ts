import { describe, expect, it } from 'vitest';
import { montarArvore, type NoCatalogo, type VinculoProdutoNo } from './arvore';
import { idsAtivos, navegarHierarquia, NO_SEM_LINHA, type NavegacaoHierarquia } from './hierarquia';

const no = (id: string, pai: string | null, nivel: number, nome = id, ordem = 0): NoCatalogo => ({ id, pai_id: pai, nivel, codigo: id.toUpperCase(), nome, ordem, ativo: true });
const v = (produto_id: string, no_id: string, extra: Partial<VinculoProdutoNo> = {}): VinculoProdutoNo => ({ produto_id, no_id, ...extra });
const ids = (...p: string[]) => new Set(p);
const niveisDe = (r: NavegacaoHierarquia) => (r.tipo === 'niveis' ? r.niveis.map((n) => [n.nome, n.total]) : null);
const caminhoDe = (r: NavegacaoHierarquia) => r.caminho.map((c) => (c.tocavel ? c.nome : `(${c.nome})`));

// Alimentos (Mercearia > Café ; Laticínios > Leites) ; Automotivo (Freios > Pastilhas ; Filtros > Filtros de óleo)
const nos = [
  no('ali', null, 1, 'Alimentos', 1),
  no('mer', 'ali', 2, 'Mercearia', 1),
  no('caf', 'mer', 3, 'Café', 1),
  no('lat', 'ali', 2, 'Laticínios', 2),
  no('lei', 'lat', 3, 'Leites', 1),
  no('aut', null, 1, 'Automotivo', 2),
  no('fre', 'aut', 2, 'Freios', 1),
  no('pas', 'fre', 3, 'Pastilhas', 1),
  no('fil', 'aut', 2, 'Filtros', 2),
  no('ole', 'fil', 3, 'Filtros de óleo', 1),
];
const vinculos = [v('p1', 'caf'), v('p2', 'caf'), v('p3', 'lei'), v('p4', 'pas'), v('p5', 'ole')];
const arvore = montarArvore(nos);
const todos = ids('p1', 'p2', 'p3', 'p4', 'p5');

describe('RF-CAT-09: navegação pela hierarquia (do maior agrupamento para o menor)', () => {
  it('RF-CAT-09: começa pelo nível mais alto que existir, com a contagem de produtos ativos de cada item', () => {
    const r = navegarHierarquia(arvore, vinculos, todos, null);
    expect(r.caminho).toEqual([]);
    expect(r.raizTocavel).toBe(false);
    expect(r.tipo === 'niveis' && [r.rotuloPlural, r.total]).toEqual(['Sistemas', 5]);
    expect(niveisDe(r)).toEqual([['Alimentos', 3], ['Automotivo', 2]]);
  });

  it('RF-CAT-09: desce nível a nível até os produtos, com a trilha do caminho', () => {
    const grupos = navegarHierarquia(arvore, vinculos, todos, 'ali');
    expect(niveisDe(grupos)).toEqual([['Mercearia', 2], ['Laticínios', 1]]);
    expect(grupos.tipo === 'niveis' && [grupos.rotuloPlural, grupos.total]).toEqual(['Grupos', 3]);
    expect(caminhoDe(grupos)).toEqual(['(Alimentos)']);
    expect(grupos.raizTocavel).toBe(true);
    // Mercearia tem uma linha só (Café): pula para os produtos
    const prod = navegarHierarquia(arvore, vinculos, todos, 'mer');
    expect(prod.tipo).toBe('produtos');
    expect(prod.tipo === 'produtos' && prod.produtoIds.sort()).toEqual(['p1', 'p2']);
  });

  it('RF-CAT-09: nível vazio é pulado (ERP sem sistema: o grupo vira o começo) e item sem produto ativo não aparece', () => {
    const semSistema = montarArvore([no('fre', null, 1, 'Freios', 1), no('pas', 'fre', 2, 'Pastilhas'), no('dis', 'fre', 2, 'Discos', 2), no('fil', null, 1, 'Filtros', 2)]);
    const r = navegarHierarquia(semSistema, [v('p4', 'pas'), v('p6', 'dis'), v('p5', 'fil')], ids('p4', 'p5', 'p6'), null);
    expect(niveisDe(r)).toEqual([['Freios', 2], ['Filtros', 1]]);
    const vazio = navegarHierarquia(semSistema, [v('p4', 'pas'), v('p5', 'fil')], ids('p4'), null);
    expect(vazio).toMatchObject({ tipo: 'produtos', produtoIds: ['p4'] });
  });

  it('RF-CAT-09: nível com um item só pula direto para o de baixo (e a trilha não guarda o nível pulado)', () => {
    const so = montarArvore([no('aut', null, 1, 'Automotivo'), no('fre', 'aut', 2, 'Freios', 1), no('fil', 'aut', 2, 'Filtros', 2), no('pas', 'fre', 3, 'Pastilhas'), no('dis', 'fre', 3, 'Discos', 2), no('ole', 'fil', 3, 'Óleo')]);
    const vs = [v('p1', 'pas'), v('p2', 'dis'), v('p3', 'ole')];
    const todosP = ids('p1', 'p2', 'p3');
    const raiz = navegarHierarquia(so, vs, todosP, null);
    expect(niveisDe(raiz)).toEqual([['Freios', 2], ['Filtros', 1]]);
    // o sistema único não vira trilha tocável: "Catálogo" e "Automotivo" levam à mesma tela
    expect(caminhoDe(raiz)).toEqual(['(Automotivo)']);
    expect(raiz.raizTocavel).toBe(false);
    // pedir o sistema único cai no mesmo lugar (a volta nunca prende o usuário num nível que se pula sozinho)
    expect(navegarHierarquia(so, vs, todosP, 'aut')).toEqual(raiz);
    // Filtros → Óleo (único) → produtos; a trilha termina em Filtros
    const prod = navegarHierarquia(so, vs, todosP, 'fil');
    expect(prod).toMatchObject({ tipo: 'produtos', produtoIds: ['p3'] });
    // Filtros leva a Óleo (único): o nível pulado aparece na trilha, sem toque; só "Catálogo" volta
    expect(caminhoDe(prod)).toEqual(['Automotivo', '(Filtros)', '(Óleo)']);
    expect(prod.raizTocavel).toBe(true);
  });

  it('RF-CAT-09: sem hierarquia nenhuma, lista de produtos com a busca', () => {
    const r = navegarHierarquia(montarArvore([]), [], ids('p1', 'p2'), null);
    expect(r).toEqual({ tipo: 'produtos', caminho: [], raizTocavel: false, noId: null, semHierarquia: true, produtoIds: ['p1', 'p2'] });
    // árvore existe mas nenhum produto ativo ligado a ela: o mesmo
    const sem = navegarHierarquia(arvore, [v('p9', 'caf')], ids('p1'), null);
    expect(sem).toMatchObject({ tipo: 'produtos', semHierarquia: true });
  });

  it('RF-CAT-09: contagem de produtos ativos: ativos, não excluídos, sem filtro de estoque, distintos', () => {
    const produtos = [{ id: 'p1', ativo: true }, { id: 'p2', ativo: true }, { id: 'p3', ativo: false }, { id: 'p4', ativo: true, deleted_at: '2026-11-01T00:00:00Z' }, { id: 'p5', ativo: true }];
    const ativos = idsAtivos(produtos);
    expect([...ativos]).toEqual(['p1', 'p2', 'p5']);
    // p2 também ligado a Leites (conta uma vez em Alimentos); vínculo apagado não conta
    const vs = [...vinculos, v('p2', 'lei'), v('p1', 'lei', { deleted_at: '2026-11-02T00:00:00Z' })];
    const r = navegarHierarquia(arvore, vs, ativos, null);
    expect(niveisDe(r)).toEqual([['Alimentos', 2], ['Automotivo', 1]]);
    // valor × regra: o total de cada item é exatamente o conjunto de produtos que a descida até ele devolve
    const folhas = (alvo: string | null): Set<string> => {
      const x = navegarHierarquia(arvore, vs, ativos, alvo);
      if (x.tipo === 'produtos') return new Set(x.produtoIds);
      const soma = new Set<string>();
      for (const n of x.niveis) for (const p of folhas(n.id)) soma.add(p);
      return soma;
    };
    for (const item of r.tipo === 'niveis' ? r.niveis : []) expect(folhas(item.id).size).toBe(item.total);
  });

  it('RF-CAT-09: produto ativo fora da árvore aparece em "Sem classificação" na raiz (nunca some)', () => {
    const r = navegarHierarquia(arvore, vinculos, ids('p1', 'p2', 'p3', 'p4', 'p5', 'p8'), null);
    expect(r.tipo === 'niveis' && r.niveis.map((n) => [n.id, n.total])).toEqual([['ali', 3], ['aut', 2], [NO_SEM_LINHA, 1]]);
    expect(r.tipo === 'niveis' && r.total).toBe(6);
    const sem = navegarHierarquia(arvore, vinculos, ids('p1', 'p8'), NO_SEM_LINHA);
    expect(sem).toMatchObject({ tipo: 'produtos', noId: NO_SEM_LINHA, produtoIds: ['p8'] });
    expect(caminhoDe(sem)).toEqual(['(Sem classificação)']);
    expect(sem.raizTocavel).toBe(true);
  });

  it('RF-CAT-09: nó pedido que não existe mais volta para a raiz', () => {
    expect(navegarHierarquia(arvore, vinculos, todos, 'fantasma')).toEqual(navegarHierarquia(arvore, vinculos, todos, null));
  });

  it('RF-CAT-09: produto ligado direto a um nível que também tem filhos vai para "Outros produtos" daquele nível', () => {
    const vs = [...vinculos, v('p7', 'ali')];
    const r = navegarHierarquia(arvore, vs, ids('p1', 'p2', 'p3', 'p7'), 'ali');
    expect(niveisDe(r)).toEqual([['Mercearia', 2], ['Laticínios', 1], ['Outros produtos', 1]]);
    expect(r.tipo === 'niveis' && r.total).toBe(4);
    const outros = navegarHierarquia(arvore, vs, ids('p1', 'p2', 'p3', 'p7'), 'outros:ali');
    expect(outros).toMatchObject({ tipo: 'produtos', noId: 'outros:ali', produtoIds: ['p7'] });
    expect(caminhoDe(outros)).toEqual(['Alimentos', '(Outros produtos)']);
  });
});
