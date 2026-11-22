import { describe, expect, it } from 'vitest';
import { montarArvore, type NoCatalogo, type VinculoProdutoNo } from '../../domain/arvore';
import { chipsDaGrade, classificacaoDaGrade, emLinhas, escolherCategoria, escolherFamilia, escolherLinha, escolherSistema, filtroDoNo, GRUPOS_DA_GRADE, SEM_FILTRO, produtosDoFiltro, linhaDaMarca, precoDoCartao, reaproveitarItens, rotuloAcessivelDoCartao, tagDeEstoque } from './grade';
import { MENSAGEM_SEM_PRECO_CATALOGO } from '../../domain/vitrine';
import { rotuloDoNivel } from '../../domain/hierarquia';
import { contarChipsFiltrar } from '../../domain/veiculo-filtro';

const no = (id: string, pai: string | null, nivel: number, nome: string): NoCatalogo => ({ id, pai_id: pai, nivel, codigo: id, nome, ordem: 0, ativo: true });
const arvore = montarArvore([no('S1', null, 1, 'Mercearia'), no('S2', null, 1, 'Bebidas'), no('C1', 'S1', 2, 'Açúcar'), no('C2', 'S1', 2, 'Café'), no('G1', 'C1', 3, 'Refinado'), no('K1', 'G1', 4, 'Cristal')]);
const vinculos: VinculoProdutoNo[] = [
  { produto_id: 'p1', no_id: 'G1' },
  { produto_id: 'p2', no_id: 'C2' },
  { produto_id: 'p3', no_id: 'S2' },
  { produto_id: 'p4', no_id: 'K1' },
];
const disp = (band: 'disponivel' | 'baixo' | 'sem_estoque', quantity: number | null, filiais = 1) => ({
  price_stock_visible: true,
  availability: { product_id: 'p', band, quantity, by_branch: Array.from({ length: filiais }, (_, i) => ({ branch_id: `f${i}`, branch_name: 'F', band, quantity })), updated_at: null, stale: false },
});

describe('Catálogo em grade (T-0173)', () => {
  it('T-0173: sistemas são o 1º nível e cada grupo seguinte só aparece depois de escolher o de cima', () => {
    expect(chipsDaGrade(arvore, SEM_FILTRO).familias).toEqual([]);
    expect(chipsDaGrade(arvore, { ...SEM_FILTRO, sistemaId: 'S1' }).familias.map((n) => n.nome)).toEqual(['Açúcar', 'Café']);
    expect(chipsDaGrade(arvore, SEM_FILTRO).sistemas).toHaveLength(2);
    expect(chipsDaGrade(arvore, { ...SEM_FILTRO, sistemaId: 'S1' }).linhas).toEqual([]);
    expect(chipsDaGrade(arvore, { ...SEM_FILTRO, sistemaId: 'S1', familiaId: 'C1' }).linhas.map((n) => n.nome)).toEqual(['Refinado']);
    expect(chipsDaGrade(arvore, { ...SEM_FILTRO, sistemaId: 'S1', familiaId: 'C1', linhaId: 'G1' }).categorias.map((n) => n.nome)).toEqual(['Cristal']);
  });

  it('RN-CAT-22: os quatro grupos seguem a ordem Sistema · Família · Linha · Categoria, com os nomes do cadastro (rotuloDoNivel)', () => {
    expect(GRUPOS_DA_GRADE.map((g) => g.grupo)).toEqual(['sistema', 'familia', 'linha', 'categoria']);
    expect(GRUPOS_DA_GRADE.map((g) => g.rotulo)).toEqual([rotuloDoNivel(1), rotuloDoNivel(2), rotuloDoNivel(3), 'Categoria']);
  });

  it('T-0173: trocar de grupo de cima volta os de baixo para Todos; o mesmo valor mantém', () => {
    const cheio = { sistemaId: 'S1', familiaId: 'C1', linhaId: 'G1', categoriaId: 'K1' };
    expect(escolherSistema(cheio, 'S2')).toEqual({ ...SEM_FILTRO, sistemaId: 'S2' });
    expect(escolherSistema(cheio, 'S1')).toEqual(cheio);
    expect(escolherFamilia(cheio, 'C2')).toEqual({ sistemaId: 'S1', familiaId: 'C2', linhaId: null, categoriaId: null });
    expect(escolherLinha(cheio, 'G2')).toEqual({ ...cheio, linhaId: 'G2', categoriaId: null });
    expect(escolherCategoria(cheio, 'K2')).toEqual({ ...cheio, categoriaId: 'K2' });
    expect(escolherFamilia(cheio, null)).toEqual({ ...SEM_FILTRO, sistemaId: 'S1' });
  });

  it('T-0173: o nível mais fundo escolhido manda na lista; sem filtro não restringe', () => {
    expect([...produtosDoFiltro(arvore, vinculos, { ...SEM_FILTRO, sistemaId: 'S1', familiaId: 'C1' })!].sort()).toEqual(['p1', 'p4']);
    expect([...produtosDoFiltro(arvore, vinculos, { ...SEM_FILTRO, sistemaId: 'S1' })!].sort()).toEqual(['p1', 'p2', 'p4']);
    expect(produtosDoFiltro(arvore, vinculos, SEM_FILTRO)).toBeUndefined();
  });

  it('T-0173: abrir com filtro (?no=) marca o caminho até o nó; nó desconhecido abre sem filtro', () => {
    expect(filtroDoNo(arvore, 'G1')).toEqual({ sistemaId: 'S1', familiaId: 'C1', linhaId: 'G1', categoriaId: null });
    expect(filtroDoNo(arvore, 'S2')).toEqual({ ...SEM_FILTRO, sistemaId: 'S2' });
    expect(filtroDoNo(arvore, 'x')).toEqual(SEM_FILTRO);
  });

  it('RN-CAT-22 (D1): a classificação dos quatro grupos conta a lista de agora; grupo vazio ou de uma opção só some', () => {
    const base = ['p1', 'p2', 'p3', 'p4'];
    const dois = contarChipsFiltrar(base, classificacaoDaGrade(arvore, vinculos, SEM_FILTRO), {}, { cruzar: false });
    expect(dois.map((g) => g.grupo)).toEqual(['sistema']);
    expect(dois[0]!.chips.map((c) => [c.nome, c.contagem])).toEqual([['Bebidas', 1], ['Mercearia', 3]]);
    const f = { ...SEM_FILTRO, sistemaId: 'S1' };
    const comS1 = contarChipsFiltrar(base, classificacaoDaGrade(arvore, vinculos, f), { sistema: 'S1' }, { cruzar: false });
    expect(comS1.map((g) => [g.grupo, g.rotulo])).toEqual([['sistema', 'Sistema'], ['familia', 'Grupo']]);
    expect(comS1[1]!.chips.map((c) => [c.nome, c.contagem])).toEqual([['Açúcar', 2], ['Café', 1]]);
    // Açúcar escolhido: só a Linha "Refinado" (uma opção) = o grupo some
    const g = { ...f, familiaId: 'C1' };
    expect(contarChipsFiltrar(base, classificacaoDaGrade(arvore, vinculos, g), { sistema: 'S1', familia: 'C1' }, { cruzar: false }).map((x) => x.grupo)).toEqual(['sistema', 'familia']);
  });

  it('spec §3 (catálogo v2): "Estoque: N" em duas cores, verde acima de 0 e vermelho em 0; sem saldo recebido = 0', () => {
    expect(tagDeEstoque(disp('disponivel', 84))).toEqual({ texto: 'Estoque: 84', tom: 'sucesso', leitura: 'Estoque 84' });
    expect(tagDeEstoque(disp('baixo', 6))).toEqual({ texto: 'Estoque: 6', tom: 'sucesso', leitura: 'Estoque 6' });
    expect(tagDeEstoque(disp('sem_estoque', 0))).toEqual({ texto: 'Estoque: 0', tom: 'erro', leitura: 'Estoque 0' });
    expect(tagDeEstoque(disp('disponivel', 1500))).toEqual({ texto: 'Estoque: 999+', tom: 'sucesso', leitura: 'Estoque 999+' });
  });

  it('spec §3: tenant que não mostra a quantidade vê Em estoque ou Sem estoque', () => {
    expect(tagDeEstoque(disp('disponivel', null))).toEqual({ texto: 'Em estoque', tom: 'sucesso', leitura: 'Em estoque' });
    expect(tagDeEstoque(disp('sem_estoque', null))).toEqual({ texto: 'Sem estoque', tom: 'erro', leitura: 'Sem estoque' });
  });

  it('spec §3: o promotor que não vê preço continua vendo o estoque', () => {
    expect(tagDeEstoque(disp('disponivel', 12))).toEqual({ texto: 'Estoque: 12', tom: 'sucesso', leitura: 'Estoque 12' });
  });

  it('RN-CORE-39: sem filial de venda (estoque nulo) não há tag', () => {
    expect(tagDeEstoque({ availability: null })).toBeNull();
  });

  it('T-0173: grade em 2 colunas e TalkBack sem vazios', () => {
    expect(emLinhas([1, 2, 3])).toEqual([[1, 2], [3]]);
    expect(rotuloAcessivelDoCartao(['Açúcar', null, 'R$ 4,95', ' '])).toBe('Açúcar, R$ 4,95');
  });

  it('RN-CAT-09 (RD-0246): com equivalência a linha da marca diz "Equivale a <marca> <código>"; sem ela, a marca', () => {
    expect(linhaDaMarca({ brand: 'Doce Vale', equivale_a: null })).toBe('Doce Vale');
    expect(linhaDaMarca({ brand: 'Fras-le', equivale_a: { marca_nome: 'Freiomax', codigo: 'CB 3401' } as never })).toBe('Equivale a Freiomax CB 3401');
  });

  it('RN-CAT-05 (RD-0246): preço do cartão: o valor quando vendável; senão a mensagem única do domain; sem preço visível, nada', () => {
    expect(precoDoCartao(null)).toBeNull();
    expect(precoDoCartao({ texto: 'R$ 4,95', riscado: null, vendavel: true })).toBe('R$ 4,95');
    expect(precoDoCartao({ texto: 'Fora da tabela do cliente', riscado: null, vendavel: false })).toBe(MENSAGEM_SEM_PRECO_CATALOGO);
  });
});

describe('RN-CAT-21: Mostrar mais reaproveita o item que não mudou', () => {
  const item = (id: string, cents: number) => ({ id, price: { price_cents: cents } }) as never;
  it('RN-CAT-21: mesmo conteúdo mantém o objeto antigo e o que mudou vem novo', () => {
    const a = [item('1', 100), item('2', 200)];
    const r = reaproveitarItens(a, [item('1', 100), item('2', 250), item('3', 300)]);
    expect(r[0]).toBe(a[0]);
    expect(r[1]).not.toBe(a[1]);
    expect(r).toHaveLength(3);
  });
});
