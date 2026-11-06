/**
 * Lista por linha da aba Catálogo (RF-CAT-09, T-0085 fatia D): sistema › grupo › linha. Funções puras (sem React Native,
 * sem motor de sync): agrupam os produtos na árvore do catálogo que já existe (`domain/arvore`, RF-CAT-04) e montam o
 * item da lista (código, medida e embalagem, descrição, aplicação, "Equivale a", oferece junto, etiquetas, foto, preço e
 * estoque). Preço e estoque vêm do `ItemVitrine` que o domain já filtrou pelo perfil (RN-CAT-05): quem não vê, nem
 * recebe o texto. A leitura do aparelho está em `lista-por-linha-local.ts`.
 */
import type { ItemVitrine } from '../../contracts';
import { montarArvore, type Arvore, type NoCatalogo, type VinculoProdutoNo } from '../../domain/arvore';
import { rotuloEstoque, rotuloPreco, type RotuloEstoque, type RotuloPreco } from './apresentacao';

/** RN-CAT-09: no máximo 3 referências cruzadas por produto. */
export const MAXIMO_REFERENCIAS = 3;
/** RN-CAT-09: no máximo 5 produtos em "oferece junto". */
export const MAXIMO_OFERECE_JUNTO = 5;
/** Etiquetas curtas no item (as demais ficam na ficha). */
export const MAXIMO_ETIQUETAS = 3;
const TAMANHO_ETIQUETA = 24;
/** Id do grupo virtual dos produtos fora da árvore. */
export const NO_SEM_LINHA = 'sem-linha';

/** Nome do nível (RF-CAT-09): 1 sistema, 2 grupo, 3 linha; abaixo disso a árvore do ERP segue com "Nível n". */
export function rotuloDoNivel(nivel: number): string {
  return nivel === 1 ? 'Sistema' : nivel === 2 ? 'Grupo' : nivel === 3 ? 'Linha' : `Nível ${nivel}`;
}

// T-0085: ligar quando a fatia B/T-0084 chegar ao contrato (tipos derivados dos schemas Zod do produto)
export interface ReferenciaEntrada {
  marca_id?: string | null;
  marca?: string | null;
  codigo: string;
}

// T-0085: ligar quando a fatia B/T-0084 chegar ao contrato (hoje lidos de forma tolerante da linha do pull)
export interface ExtrasProduto {
  aplicacao: string | null;
  referencias: ReferenciaEntrada[];
  oferece_junto: string[];
  etiquetas: string[];
  foto_url: string | null;
}
export const SEM_EXTRAS: ExtrasProduto = { aplicacao: null, referencias: [], oferece_junto: [], etiquetas: [], foto_url: null };

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** Lê os campos novos de uma linha do pull sem exigir que existam: campo ausente ou fora do formato vira vazio (nunca lança). */
export function extrasDaLinha(linha: unknown): ExtrasProduto {
  if (typeof linha !== 'object' || linha === null) return SEM_EXTRAS;
  const l = linha as Record<string, unknown>;
  const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const referencias = lista(l.referencias).flatMap((r): ReferenciaEntrada[] => {
    if (typeof r !== 'object' || r === null) return [];
    const x = r as Record<string, unknown>;
    const codigo = texto(x.codigo);
    return codigo ? [{ marca_id: texto(x.marca_id), marca: texto(x.marca), codigo }] : [];
  });
  return {
    aplicacao: texto(l.aplicacao),
    referencias,
    oferece_junto: lista(l.oferece_junto).flatMap((v) => (texto(v) ? [texto(v)!] : [])),
    etiquetas: lista(l.etiquetas).flatMap((v) => (texto(v) ? [texto(v)!] : [])),
    foto_url: texto(l.foto_url) ?? texto(l.thumbnail_url),
  };
}

/** O que a lista precisa de cada produto (cadastro do Core + campos do Catálogo). */
export interface ProdutoLista {
  id: string;
  sku: string;
  nome: string;
  unidade: string;
  embalagem_medida?: string | null | undefined;
  embalagem_quantidade?: number | null | undefined;
  extras: ExtrasProduto;
}

export interface GrupoLista {
  /** `null` = grupo virtual "Sem linha". */
  no: NoCatalogo | null;
  /** "Sistema", "Grupo", "Linha"... */
  rotuloNivel: string;
  /** Produtos distintos deste nível e de tudo abaixo dele. */
  total: number;
  /** Produtos ligados direto a este nível. */
  produtos: ProdutoLista[];
  filhos: GrupoLista[];
}

export interface ListaAgrupada {
  /** Sistemas na ordem da árvore (`ordem`, depois nome). */
  sistemas: GrupoLista[];
  /** Produtos sem nó vivo na árvore: aparecem num grupo à parte, nunca somem. */
  semHierarquia: ProdutoLista[];
}

const emPtBr = new Intl.Collator('pt-BR');
/** Ordem estável dos produtos: nome, depois código, depois id. */
export const porNome = (a: ProdutoLista, b: ProdutoLista) => emPtBr.compare(a.nome, b.nome) || emPtBr.compare(a.sku, b.sku) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * RF-CAT-09: agrupa os produtos em sistema › grupo › linha com a contagem de cada nível. Reaproveita a árvore do
 * RF-CAT-04 (nó inativo, removido ou sem caminho até a raiz some e leva os filhos). Produto sem vínculo vivo, inativo
 * fica de fora; produto ligado a mais de um nó aparece em cada um e conta uma vez no nível acima.
 */
export function agruparPorLinha(arvoreOuNos: Arvore | readonly NoCatalogo[], vinculos: readonly VinculoProdutoNo[], produtos: readonly ProdutoLista[]): ListaAgrupada {
  const arvore = Array.isArray(arvoreOuNos) ? montarArvore(arvoreOuNos as readonly NoCatalogo[]) : (arvoreOuNos as Arvore);
  const porId = new Map(produtos.map((p) => [p.id, p]));
  const doNo = new Map<string, Set<string>>();
  const vinculados = new Set<string>();
  for (const v of vinculos) {
    if (v.deleted_at || !arvore.nos.has(v.no_id) || !porId.has(v.produto_id)) continue;
    doNo.set(v.no_id, (doNo.get(v.no_id) ?? new Set()).add(v.produto_id));
    vinculados.add(v.produto_id);
  }
  const montar = (no: NoCatalogo): GrupoLista => {
    const filhos = (arvore.filhos.get(no.id) ?? []).map(montar);
    const diretos = [...(doNo.get(no.id) ?? [])].map((id) => porId.get(id)!).sort(porNome);
    const todos = new Set<string>(diretos.map((p) => p.id));
    for (const f of filhos) for (const p of coletar(f)) todos.add(p);
    return { no, rotuloNivel: rotuloDoNivel(no.nivel), total: todos.size, produtos: diretos, filhos };
  };
  return {
    sistemas: (arvore.filhos.get(null) ?? []).map(montar),
    semHierarquia: produtos.filter((p) => !vinculados.has(p.id)).sort(porNome),
  };
}

/** Ids de todos os produtos de um grupo e dos níveis abaixo. */
export function coletar(g: GrupoLista): Set<string> {
  const r = new Set(g.produtos.map((p) => p.id));
  for (const f of g.filhos) for (const id of coletar(f)) r.add(id);
  return r;
}

/** "UN" ou "UN · CX com 12": medida e embalagem do cadastro (RN-CORE-19). */
export function medidaEmbalagem(p: Pick<ProdutoLista, 'unidade' | 'embalagem_medida' | 'embalagem_quantidade'>): string {
  const emb = p.embalagem_medida ? `${p.embalagem_medida}${p.embalagem_quantidade ? ` com ${p.embalagem_quantidade.toLocaleString('pt-BR')}` : ''}` : null;
  return [p.unidade, emb].filter(Boolean).join(' · ');
}

export interface ReferenciaItem {
  marca: string;
  codigo: string;
}

/** RN-CAT-09: até 3 referências, com a marca pelo nome ou, na falta, pelo id (`marcasPorId`); código vazio é descartado. */
export function referenciasDoItem(refs: readonly ReferenciaEntrada[], marcasPorId: ReadonlyMap<string, string> = new Map()): ReferenciaItem[] {
  return refs
    .filter((r) => r.codigo.trim() !== '')
    .slice(0, MAXIMO_REFERENCIAS)
    .map((r) => ({ marca: r.marca?.trim() || (r.marca_id ? marcasPorId.get(r.marca_id) : undefined) || '', codigo: r.codigo.trim() }));
}

/** "Equivale a: CB 3401" ou, com várias, "Equivale a: Bosch CB 3401 · NGK X9"; sem referência = `null` (a linha some). */
export function textoEquivale(refs: readonly ReferenciaItem[]): string | null {
  if (refs.length === 0) return null;
  return `Equivale a: ${refs.map((r) => [r.marca, r.codigo].filter(Boolean).join(' ')).join(' · ')}`;
}

export interface OfereceJuntoItem {
  id: string;
  rotulo: string;
}

/**
 * RN-CAT-09: até 5 produtos. Tira repetido, o próprio produto e o que não está no aparelho (sem nome para mostrar),
 * mantendo a ordem do cadastro; o corte em 5 vem depois da limpeza.
 */
export function ofereceJuntoDoItem(ids: readonly string[], produtoId: string, nomes: ReadonlyMap<string, string>): OfereceJuntoItem[] {
  const vistos = new Set<string>([produtoId]);
  const r: OfereceJuntoItem[] = [];
  for (const id of ids) {
    const nome = nomes.get(id);
    if (vistos.has(id) || !nome) continue;
    vistos.add(id);
    r.push({ id, rotulo: nome });
    if (r.length === MAXIMO_OFERECE_JUNTO) break;
  }
  return r;
}

/** Etiquetas curtas: sem repetição (ignora maiúsculas), até 3, e só as de até 24 caracteres. */
export function etiquetasDoItem(etiquetas: readonly string[]): string[] {
  const vistas = new Set<string>();
  const r: string[] = [];
  for (const e of etiquetas) {
    const t = e.trim();
    if (!t || t.length > TAMANHO_ETIQUETA || vistas.has(t.toLowerCase())) continue;
    vistas.add(t.toLowerCase());
    r.push(t);
    if (r.length === MAXIMO_ETIQUETAS) break;
  }
  return r;
}

export interface ItemLista {
  id: string;
  codigo: string;
  descricao: string;
  medidaEmbalagem: string;
  aplicacao: string | null;
  equivale: string | null;
  ofereceJunto: OfereceJuntoItem[];
  etiquetas: string[];
  fotoUrl: string | null;
  /** `null` = o perfil não vê preço (RN-CAT-05): nem "sem preço" aparece. */
  preco: RotuloPreco | null;
  /** `null` = o perfil não vê estoque (RN-CAT-05). */
  estoque: RotuloEstoque | null;
}

export interface ContextoItemLista {
  agora: string;
  fuso: string;
  nomesPorId: ReadonlyMap<string, string>;
  marcasPorId?: ReadonlyMap<string, string>;
}

/**
 * Item da lista. `vitrine` é o cartão que o domain montou para o perfil (RN-CAT-05, RN-CAT-06): se o perfil não vê
 * preço e estoque, ele vem sem os dois e o item sai sem preço nem estoque. Sem `vitrine` (nada lido), também.
 */
export function montarItemLista(p: ProdutoLista, vitrine: ItemVitrine | null, c: ContextoItemLista): ItemLista {
  return {
    id: p.id,
    codigo: p.sku,
    descricao: p.nome,
    medidaEmbalagem: medidaEmbalagem(p),
    aplicacao: p.extras.aplicacao,
    equivale: textoEquivale(referenciasDoItem(p.extras.referencias, c.marcasPorId)),
    ofereceJunto: ofereceJuntoDoItem(p.extras.oferece_junto, p.id, c.nomesPorId),
    etiquetas: etiquetasDoItem(p.extras.etiquetas),
    fotoUrl: p.extras.foto_url,
    preco: vitrine ? rotuloPreco(vitrine) : null,
    estoque: vitrine ? rotuloEstoque(vitrine, c.agora, c.fuso) : null,
  };
}
