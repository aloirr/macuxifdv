import { describe, expect, it } from 'vitest';
import { montarArvore, type NoCatalogo, type VinculoProdutoNo } from '../../domain/arvore';
import { chipsDaGrade, emLinhas, escolherCategoria, escolherSistema, filtroDoNo, produtosDoFiltro, linhaDaMarca, precoDoCartao, rotuloAcessivelDoCartao, subtituloDaGrade, tagDeEstoque } from './grade';
import { MENSAGEM_SEM_PRECO_CATALOGO } from '../../domain/vitrine';

const no = (id: string, pai: string | null, nivel: number, nome: string): NoCatalogo => ({ id, pai_id: pai, nivel, codigo: id, nome, ordem: 0, ativo: true });
const arvore = montarArvore([no('S1', null, 1, 'Mercearia'), no('S2', null, 1, 'Bebidas'), no('C1', 'S1', 2, 'Açúcar'), no('C2', 'S1', 2, 'Café'), no('G1', 'C1', 3, 'Refinado')]);
const vinculos: VinculoProdutoNo[] = [
  { produto_id: 'p1', no_id: 'G1' },
  { produto_id: 'p2', no_id: 'C2' },
  { produto_id: 'p3', no_id: 'S2' },
];
const disp = (band: 'disponivel' | 'baixo' | 'sem_estoque', quantity: number | null, filiais = 1) => ({
  price_stock_visible: true,
  availability: { product_id: 'p', band, quantity, by_branch: Array.from({ length: filiais }, (_, i) => ({ branch_id: `f${i}`, branch_name: 'F', band, quantity })), updated_at: null, stale: false },
});

describe('Catálogo em grade (T-0173)', () => {
  it('T-0173: sistemas são o 1º nível e as categorias só aparecem depois de escolher o sistema', () => {
    expect(chipsDaGrade(arvore, { sistemaId: null, categoriaId: null }).categorias).toEqual([]);
    expect(chipsDaGrade(arvore, { sistemaId: 'S1', categoriaId: null }).categorias.map((n) => n.nome)).toEqual(['Açúcar', 'Café']);
    expect(chipsDaGrade(arvore, { sistemaId: null, categoriaId: null }).sistemas).toHaveLength(2);
  });

  it('T-0173: trocar de sistema volta a categoria para Todas; o mesmo sistema mantém', () => {
    expect(escolherSistema({ sistemaId: 'S1', categoriaId: 'C1' }, 'S2')).toEqual({ sistemaId: 'S2', categoriaId: null });
    expect(escolherSistema({ sistemaId: 'S1', categoriaId: 'C1' }, 'S1').categoriaId).toBe('C1');
    expect(escolherCategoria({ sistemaId: 'S1', categoriaId: null }, 'C2')).toEqual({ sistemaId: 'S1', categoriaId: 'C2' });
  });

  it('T-0173: nível abaixo da categoria entra na grade da categoria; sem filtro não restringe', () => {
    expect([...produtosDoFiltro(arvore, vinculos, { sistemaId: 'S1', categoriaId: 'C1' })!]).toEqual(['p1']);
    expect([...produtosDoFiltro(arvore, vinculos, { sistemaId: 'S1', categoriaId: null })!].sort()).toEqual(['p1', 'p2']);
    expect(produtosDoFiltro(arvore, vinculos, { sistemaId: null, categoriaId: null })).toBeUndefined();
  });

  it('T-0173: abrir com filtro (?no=) marca sistema e categoria; nó desconhecido abre sem filtro', () => {
    expect(filtroDoNo(arvore, 'G1')).toEqual({ sistemaId: 'S1', categoriaId: 'C1' });
    expect(filtroDoNo(arvore, 'S2')).toEqual({ sistemaId: 'S2', categoriaId: null });
    expect(filtroDoNo(arvore, 'x')).toEqual({ sistemaId: null, categoriaId: null });
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

  it('T-0173: subtítulo no singular e no plural, grade em 2 colunas e TalkBack sem vazios', () => {
    expect(subtituloDaGrade(1)).toBe('1 produto');
    expect(subtituloDaGrade(40)).toBe('40 produtos');
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
