/**
 * Catálogo em grade (T-0173, docs/design/catalogo-grade.md): chips de sistema, família, linha e categoria sobre a árvore do ERP e a tag de
 * estoque do cartão. Puro, testável em Node; a decisão de preço e de faixa é do domain.
 */
import type { TomEstado } from '@macuxi/ui/mobile/puro';
import type { GrupoFiltro, ItemVitrine } from '../../contracts';
import { chipDoEstoque } from '../../domain/estoque-campo';
import { MENSAGEM_SEM_PRECO_CATALOGO } from '../../domain/vitrine';
import { textoEquivaleA, type RotuloPreco } from './apresentacao';
import { filhosDe, produtosDoNo, trilhaDe, type Arvore, type NoCatalogo, type VinculoProdutoNo } from '../../domain/arvore';
import { rotuloDoNivel } from '../../domain/hierarquia';
import type { GrupoDeClassificacao } from '../../domain/veiculo-filtro';

/** Os quatro grupos da folha Filtrar, do 1º ao 4º nível da árvore do ERP (RN-CAT-22, D1): sistema, família, linha e categoria. */
export type GrupoDaGrade = GrupoFiltro;
export interface FiltroDaGrade {
  sistemaId: string | null;
  familiaId: string | null;
  linhaId: string | null;
  categoriaId: string | null;
}
export const SEM_FILTRO: FiltroDaGrade = { sistemaId: null, familiaId: null, linhaId: null, categoriaId: null };

/** Ordem da folha e campo de cada grupo; o nome vem do cadastro (`rotuloDoNivel`: Sistema, Grupo, Linha; do 4º nível em diante, Categoria). */
export const GRUPOS_DA_GRADE: readonly { grupo: GrupoDaGrade; rotulo: string; campo: keyof FiltroDaGrade }[] = [
  { grupo: 'sistema', rotulo: rotuloDoNivel(1), campo: 'sistemaId' },
  { grupo: 'familia', rotulo: rotuloDoNivel(2), campo: 'familiaId' },
  { grupo: 'linha', rotulo: rotuloDoNivel(3), campo: 'linhaId' },
  { grupo: 'categoria', rotulo: 'Categoria', campo: 'categoriaId' },
];

/** Cada grupo mostra os filhos do que está escolhido no grupo de cima; o 1º mostra os nós da raiz. Nível acima sem escolha = grupo vazio. */
export function chipsDaGrade(a: Arvore, f: FiltroDaGrade): { sistemas: readonly NoCatalogo[]; familias: readonly NoCatalogo[]; linhas: readonly NoCatalogo[]; categorias: readonly NoCatalogo[] } {
  return {
    sistemas: filhosDe(a, null),
    familias: f.sistemaId ? filhosDe(a, f.sistemaId) : [],
    linhas: f.familiaId ? filhosDe(a, f.familiaId) : [],
    categorias: f.linhaId ? filhosDe(a, f.linhaId) : [],
  };
}

/** Abertura com `?no=`: marca o caminho da raiz até o nó (até o 4º nível). Nó que não existe = sem filtro. */
export function filtroDoNo(a: Arvore, noId: string | null): FiltroDaGrade {
  if (!noId || !a.nos.has(noId)) return SEM_FILTRO;
  const trilha = trilhaDe(a, noId);
  return { sistemaId: trilha[0]?.id ?? null, familiaId: trilha[1]?.id ?? null, linhaId: trilha[2]?.id ?? null, categoriaId: trilha[3]?.id ?? null };
}

export const escolherSistema = (f: FiltroDaGrade, id: string | null): FiltroDaGrade => (id === f.sistemaId ? f : { ...SEM_FILTRO, sistemaId: id });
export const escolherFamilia = (f: FiltroDaGrade, id: string | null): FiltroDaGrade => (id === f.familiaId ? f : { ...f, familiaId: id, linhaId: null, categoriaId: null });
export const escolherLinha = (f: FiltroDaGrade, id: string | null): FiltroDaGrade => (id === f.linhaId ? f : { ...f, linhaId: id, categoriaId: null });
export const escolherCategoria = (f: FiltroDaGrade, id: string | null): FiltroDaGrade => ({ ...f, categoriaId: id });

/** O nó mais fundo escolhido (o que manda na lista); `null` = sem filtro. */
export const noDoFiltro = (f: FiltroDaGrade): string | null => f.categoriaId ?? f.linhaId ?? f.familiaId ?? f.sistemaId;

/** Produtos que a grade pode mostrar; `undefined` = sem restrição por árvore. */
export function produtosDoFiltro(a: Arvore, vinculos: readonly VinculoProdutoNo[], f: FiltroDaGrade): Set<string> | undefined {
  const no = noDoFiltro(f);
  return no ? produtosDoNo(a, vinculos, no) : undefined;
}

/** RN-CAT-22 (D1): os quatro grupos com as opções e os produtos de cada uma, para `contarChipsFiltrar` (as opções vêm do grupo de cima escolhido). */
export function classificacaoDaGrade(a: Arvore, vinculos: readonly VinculoProdutoNo[], f: FiltroDaGrade): GrupoDeClassificacao[] {
  const c = chipsDaGrade(a, f);
  const nos = [c.sistemas, c.familias, c.linhas, c.categorias];
  return GRUPOS_DA_GRADE.map((g, i) => ({ grupo: g.grupo, rotulo: g.rotulo, opcoes: nos[i]!.map((n) => ({ id: n.id, nome: n.nome, produtos: produtosDoNo(a, vinculos, n.id) })) }));
}

export interface TagEstoque {
  texto: string;
  tom: TomEstado;
  /** Frase do leitor de tela (`chipDoEstoque`). */
  leitura: string;
}

/**
 * spec §3 (catálogo v2): chip `Estoque: N` do cartão (N = a soma das filiais do contexto; "999+" acima de 999), verde acima de 0 e
 * vermelho em 0 ou menos. Todo perfil vê o estoque (o promotor também); `null` só sem filial de venda (estoque nulo, RN-CORE-39).
 */
export function tagDeEstoque(item: Pick<ItemVitrine, 'availability'>): TagEstoque | null {
  return item.availability ? chipDoEstoque(item.availability, true) : null;
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

/** Preço do cartão: o valor quando vendável; senão a mensagem única do domain (RN-CAT-05); `null` = o perfil não vê preço. */
export function precoDoCartao(preco: RotuloPreco | null): string | null {
  if (!preco) return null;
  return preco.vendavel ? preco.texto : MENSAGEM_SEM_PRECO_CATALOGO;
}

/** TalkBack do cartão: "Açúcar cristal 1 kg, Doce Vale, R$ 4,95, 6 em estoque". */
export function rotuloAcessivelDoCartao(partes: readonly (string | null | undefined)[]): string {
  return partes.filter((p): p is string => Boolean(p && p.trim())).join(', ');
}

/** Igualdade por conteúdo de dados simples (JSON); o item e a miniatura da lista são só isso. */
export const mesmoValor = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/** "Mostrar mais": cada rodada monta objetos novos; o item cujo conteúdo não mudou mantém o objeto antigo, e o cartão memorizado (`CartaoDaLista`) não redesenha. */
export function reaproveitarItens<T extends ItemVitrine>(antes: readonly T[], depois: readonly T[]): T[] {
  const porId = new Map(antes.map((i) => [i.id, i] as const));
  return depois.map((i) => {
    const velho = porId.get(i.id);
    return velho && mesmoValor(velho, i) ? velho : i;
  });
}
