import { describe, expect, it } from 'vitest';
import { montarArvore, type NoCatalogo, type VinculoProdutoNo } from '../../domain/arvore';
import { chipsDaGrade, emLinhas, escolherCategoria, escolherSistema, filtroDoNo, produtosDoFiltro, rotuloAcessivelDoCartao, subtituloDaGrade, tagDeEstoque } from './grade';

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

  it('RN-CAT-07: tag única, verde com 10 ou mais, laranja de 1 a 9, vermelha em 0, cinza sem saldo recebido', () => {
    expect(tagDeEstoque(disp('disponivel', 84))).toEqual({ texto: '84 em estoque', tom: 'sucesso' });
    expect(tagDeEstoque(disp('baixo', 6))).toEqual({ texto: '6 em estoque', tom: 'aviso' });
    expect(tagDeEstoque(disp('sem_estoque', 0))).toEqual({ texto: 'Sem estoque', tom: 'erro' });
    expect(tagDeEstoque(disp('disponivel', 5, 0))).toEqual({ texto: 'Estoque sem informação', tom: 'neutro' });
  });

  it('RN-CAT-07: tenant que não mostra a quantidade vê Em estoque e Pouco estoque', () => {
    expect(tagDeEstoque(disp('disponivel', null))?.texto).toBe('Em estoque');
    expect(tagDeEstoque(disp('baixo', null))).toEqual({ texto: 'Pouco estoque', tom: 'aviso' });
  });

  it('RN-CORE-39: com cliente e sem saldo na filial dele é Sem estoque, não "sem informação"', () => {
    expect(tagDeEstoque(disp('sem_estoque', 0, 0), { filialDoCliente: true })).toEqual({ texto: 'Sem estoque', tom: 'erro' });
  });

  it('RN-CAT-05: o perfil que não vê estoque não recebe tag', () => {
    expect(tagDeEstoque({ price_stock_visible: false, availability: null })).toBeNull();
  });

  it('T-0173: subtítulo no singular e no plural, grade em 2 colunas e TalkBack sem vazios', () => {
    expect(subtituloDaGrade(1)).toBe('1 produto');
    expect(subtituloDaGrade(40)).toBe('40 produtos');
    expect(emLinhas([1, 2, 3])).toEqual([[1, 2], [3]]);
    expect(rotuloAcessivelDoCartao(['Açúcar', null, 'R$ 4,95', ' '])).toBe('Açúcar, R$ 4,95');
  });
});
