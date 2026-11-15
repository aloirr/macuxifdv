/**
 * Catálogo em grade (T-0173, docs/design/catalogo-grade.md): chips de sistema e de categoria sobre a árvore do ERP e a tag de
 * estoque do cartão. Puro, testável em Node; a decisão de preço e de faixa é do domain.
 */
import type { TomEstado } from '@macuxi/ui/mobile/puro';
import type { ItemVitrine } from '../../contracts';
import { MENSAGEM_SEM_PRECO_CATALOGO } from '../../domain/vitrine';
import { textoEquivaleA, type RotuloPreco } from './apresentacao';
import { filhosDe, produtosDoNo, trilhaDe, type Arvore, type NoCatalogo, type VinculoProdutoNo } from '../../domain/arvore';

export interface FiltroDaGrade {
  sistemaId: string | null;
  categoriaId: string | null;
}
export const SEM_FILTRO: FiltroDaGrade = { sistemaId: null, categoriaId: null };

/** Sistema = 1º nível da árvore; categoria = filhos dele. Nível abaixo da categoria não vira chip (spec §1). */
export function chipsDaGrade(a: Arvore, f: FiltroDaGrade): { sistemas: readonly NoCatalogo[]; categorias: readonly NoCatalogo[] } {
  return { sistemas: filhosDe(a, null), categorias: f.sistemaId ? filhosDe(a, f.sistemaId) : [] };
}

/** Abertura com `?no=`: nó de 1º nível = sistema; mais fundo = a categoria (nível 2) e o sistema dela. Nó que não existe = sem filtro. */
export function filtroDoNo(a: Arvore, noId: string | null): FiltroDaGrade {
  if (!noId || !a.nos.has(noId)) return SEM_FILTRO;
  const trilha = trilhaDe(a, noId);
  return { sistemaId: trilha[0]?.id ?? null, categoriaId: trilha[1]?.id ?? null };
}

export const escolherSistema = (f: FiltroDaGrade, id: string | null): FiltroDaGrade => (id === f.sistemaId ? f : { sistemaId: id, categoriaId: null });
export const escolherCategoria = (f: FiltroDaGrade, id: string | null): FiltroDaGrade => ({ ...f, categoriaId: id });

/** Produtos que a grade pode mostrar; `undefined` = sem restrição por árvore. */
export function produtosDoFiltro(a: Arvore, vinculos: readonly VinculoProdutoNo[], f: FiltroDaGrade): Set<string> | undefined {
  const no = f.categoriaId ?? f.sistemaId;
  return no ? produtosDoNo(a, vinculos, no) : undefined;
}

export interface TagEstoque {
  texto: string;
  tom: TomEstado;
}

/** Tag única de estoque do cartão (spec §4); `null` = o perfil não vê estoque (RN-CAT-05). */
export function tagDeEstoque(item: Pick<ItemVitrine, 'availability' | 'price_stock_visible'>, opcoes: { filialDoCliente?: boolean } = {}): TagEstoque | null {
  const a = item.availability;
  if (!item.price_stock_visible || !a) return null;
  if (a.by_branch.length === 0) return opcoes.filialDoCliente ? { texto: 'Sem estoque', tom: 'erro' } : { texto: 'Estoque sem informação', tom: 'neutro' };
  if (a.band === 'sem_estoque') return { texto: 'Sem estoque', tom: 'erro' };
  const baixo = a.band === 'baixo';
  if (a.quantity === null) return { texto: baixo ? 'Pouco estoque' : 'Em estoque', tom: baixo ? 'aviso' : 'sucesso' };
  return { texto: `${a.quantity.toLocaleString('pt-BR')} em estoque`, tom: baixo ? 'aviso' : 'sucesso' };
}

/** Contagem do cabeçalho: "40 produtos", "1 produto". */
export function subtituloDaGrade(total: number): string {
  return `${total.toLocaleString('pt-BR')} ${total === 1 ? 'produto' : 'produtos'}`;
}

/** Duas colunas: [[a, b], [c, d], [e]]. */
export function emLinhas<T>(itens: readonly T[], colunas = 2): T[][] {
  const r: T[][] = [];
  for (let i = 0; i < itens.length; i += colunas) r.push(itens.slice(i, i + colunas));
  return r;
}

/** Linha da marca do cartão (spec §2, RN-CAT-09): "Equivale a Freiomax CB 3401" quando há equivalência; senão a marca. */
export function linhaDaMarca(item: Pick<ItemVitrine, 'brand' | 'equivale_a'>): string {
  const equivale = textoEquivaleA(item);
  return equivale ? `Equivale a ${equivale}` : item.brand ?? '';
}

/**
 * Códigos do cartão em duas linhas (catalogo-grade §2): em cima a marca (ou "Equivale a ..."), embaixo o código do produto com o
 * copiar. O copiar leva SÓ o código do produto (`erp_code`), sem marca (R-20261115-084500).
 */
export function codigosDoCartao(item: Pick<ItemVitrine, 'brand' | 'equivale_a' | 'erp_code'>): { marca: string; produto: string; copiar: string } {
  return { marca: linhaDaMarca(item), produto: item.erp_code, copiar: item.erp_code };
}

/** Preço do cartão: o valor quando vendável; senão a mensagem única do domain (RN-CAT-05); `null` = o perfil não vê preço. */
export function precoDoCartao(preco: RotuloPreco | null): string | null {
  if (!preco) return null;
  return preco.vendavel ? preco.texto : MENSAGEM_SEM_PRECO_CATALOGO;
}

/** TalkBack do cartão: "Açúcar cristal 1 kg, Doce Vale, R$ 4,95, 6 em estoque". */
export function rotuloAcessivelDoCartao(partes: readonly (string | null | undefined)[]): string {
  return partes.filter((p): p is string => Boolean(p && p.trim())).join(', ');
}
