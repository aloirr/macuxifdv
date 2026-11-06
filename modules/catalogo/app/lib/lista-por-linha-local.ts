/**
 * Leitura da lista por linha no aparelho (RF-CAT-09, T-0085 fatia D). OFFLINE-FIRST: tudo vem do pull no SQLite via
 * motor de sync, sem rede. Para não reler a entidade inteira a cada toque:
 * - `versaoLinhas` memoriza o que vale para a árvore toda (nós, vínculos e produtos da raiz) até o próximo sync;
 * - dentro de um sistema/grupo/linha, `linhasPorCampo('produto_no', 'no_id', ...)` lê só os vínculos do nível atual e
 *   `linhasPorIds('produto', ...)` só os produtos dele; preço e estoque (RN-CAT-06) só dos itens que vão para a tela.
 * Preço e estoque saem do domain (`itemDaVitrine`, RN-CAT-05): o promotor recebe o item sem os dois.
 */
import type { LinhaSync } from '@macuxi/platform-sdk';
import type { ProdutoSync } from '@macuxi/core/contracts';
import type { CatalogoNoSync, ProdutoNoSync } from '../../contracts';
import { descendentesDe, montarArvore, trilhaDe, type Arvore, type NoCatalogo, type VinculoProdutoNo } from '../../domain/arvore';
import { itemDaVitrine, type ProdutoCatalogo } from '../../domain/vitrine';
import { contextoLocal, type EntradaLocal, type LeitorLocal } from './local';
import { agruparPorLinha, coletar, extrasDaLinha, montarItemLista, NO_SEM_LINHA, porNome, rotuloDoNivel, type GrupoLista, type ItemLista, type ProdutoLista } from './lista-por-linha';

/** Itens por tela: o resto fica na busca e nos níveis abaixo (a lista não cresce sem limite). */
export const MAXIMO_ITENS_LISTA = 100;
/** A partir deste nível (linha) a tela mostra os itens, mesmo que ainda haja níveis abaixo. */
const NIVEL_DA_LINHA = 3;

export interface FilhoLista {
  id: string;
  codigo: string;
  nome: string;
  rotuloNivel: string;
  total: number;
}

export interface NivelLista {
  /** Do sistema até o nível atual; vazio na raiz. */
  trilha: NoCatalogo[];
  /** Nome do nível atual ("Sistema", "Grupo", "Linha") ou `null` na raiz. */
  rotuloNivel: string | null;
  filhos: FilhoLista[];
  itens: ItemLista[];
  /** Quantos produtos o nível atual tem (os itens podem ser só os primeiros). */
  total: number;
  /** O nó pedido não existe (mais) na árvore do aparelho: a tela volta à raiz. */
  noInexistente: boolean;
  /** Nível sem filhos e sem itens. */
  vazio: boolean;
}

interface Registro<T> {
  chave: string;
  valor: T;
}
const memorias = new WeakMap<object, Map<string, Registro<unknown>>>();

/** Memoriza pelo `versaoLinhas` das entidades (versão lida ANTES das linhas); sem `versaoLinhas`, não memoriza. */
async function lembrar<T>(leitor: LeitorLocal, nome: string, entidades: readonly string[], calcular: () => Promise<T>): Promise<T> {
  if (!leitor.versaoLinhas) return calcular();
  const chave = entidades.map((e) => leitor.versaoLinhas!(e)).join('|');
  let m = memorias.get(leitor);
  if (!m) memorias.set(leitor, (m = new Map()));
  const guardado = m.get(nome) as Registro<T> | undefined;
  if (guardado && guardado.chave === chave) return guardado.valor;
  const valor = await calcular();
  m.set(nome, { chave, valor });
  return valor;
}

const vivas = <L extends LinhaSync>(l: L[]) => l.filter((x) => !x.deleted_at);
type LinhaProduto = ProdutoSync & LinhaSync;

function doCatalogo(p: LinhaProduto): ProdutoCatalogo {
  return { id: p.id, sku: p.sku, ean: p.ean, nome: p.nome, marca: p.marca ?? '', categoria: p.categoria ?? '', unidade: p.unidade, ativo: p.ativo, atributos: [], thumbnail_url: extrasDaLinha(p).foto_url, campanha: false, vendas: 0 };
}
function paraLista(p: LinhaProduto): ProdutoLista {
  return { id: p.id, sku: p.sku, nome: p.nome, unidade: p.unidade, embalagem_medida: p.embalagem_medida, embalagem_quantidade: p.embalagem_quantidade, extras: extrasDaLinha(p) };
}
const ativos = (l: LinhaProduto[]) => vivas(l).filter((p) => p.ativo);

async function produtosPorIds(leitor: LeitorLocal, ids: readonly string[]): Promise<LinhaProduto[]> {
  if (ids.length === 0) return [];
  if (leitor.linhasPorIds) return ativos(await leitor.linhasPorIds<LinhaProduto>('produto', ids));
  const pedidos = new Set(ids);
  return ativos(await leitor.linhas<LinhaProduto>('produto')).filter((p) => pedidos.has(p.id));
}

/** Vínculos dos níveis `nosIds` (e só deles). Sem `linhasPorCampo` (leitor dos testes), lê tudo e filtra. */
async function vinculosDosNos(leitor: LeitorLocal, nosIds: ReadonlySet<string>): Promise<VinculoProdutoNo[]> {
  const linhas = leitor.linhasPorCampo ? await leitor.linhasPorCampo<ProdutoNoSync & LinhaSync>('produto_no', 'no_id', [...nosIds]) : await leitor.linhas<ProdutoNoSync & LinhaSync>('produto_no');
  return vivas(linhas).filter((v) => nosIds.has(v.no_id));
}

function acharGrupo(sistemas: readonly GrupoLista[], noId: string): GrupoLista | null {
  for (const g of sistemas) {
    if (g.no?.id === noId) return g;
    const f = acharGrupo(g.filhos, noId);
    if (f) return f;
  }
  return null;
}

const arvoreDoAparelho = (leitor: LeitorLocal) => lembrar<Arvore>(leitor, 'lista-arvore', ['catalogo_no'], async () => montarArvore(await leitor.linhas<CatalogoNoSync & LinhaSync>('catalogo_no')));

/** Tudo da raiz (sistemas, contagens e produtos sem linha): lido uma vez por sync. */
function raiz(leitor: LeitorLocal, arvore: Arvore) {
  return lembrar(leitor, 'lista-raiz', ['catalogo_no', 'produto_no', 'produto'], async () => {
    const vinculos = vivas(await leitor.linhas<ProdutoNoSync & LinhaSync>('produto_no'));
    const produtos = ativos(await leitor.linhas<LinhaProduto>('produto'));
    return { agrupado: agruparPorLinha(arvore, vinculos, produtos.map(paraLista)), porId: new Map(produtos.map((p) => [p.id, p])) };
  });
}

/**
 * Um nível da lista por linha. `noId` nulo = raiz (sistemas); `NO_SEM_LINHA` = produtos fora da árvore. Cliente em
 * contexto = preço da tabela dele (RN-CAT-06); sem permissão para preço e estoque o item sai sem os dois (RN-CAT-05).
 */
export async function listaPorLinhaLocal(leitor: LeitorLocal, e: EntradaLocal & { noId: string | null; fuso: string }): Promise<NivelLista> {
  const arvore = await arvoreDoAparelho(leitor);
  const noValido = e.noId === null || e.noId === NO_SEM_LINHA || arvore.nos.has(e.noId);
  const noId = noValido ? e.noId : null;

  let grupo: GrupoLista | null = null;
  let filhos: GrupoLista[] = [];
  let candidatos: ProdutoLista[] = [];
  let porId = new Map<string, LinhaProduto>();
  let total = 0;
  let trilha: NoCatalogo[] = [];
  let rotuloNivel: string | null = null;

  if (noId === null || noId === NO_SEM_LINHA) {
    const r = await raiz(leitor, arvore);
    porId = r.porId;
    if (noId === null) {
      filhos = r.agrupado.sistemas;
      total = new Set(r.agrupado.sistemas.flatMap((g) => [...coletar(g)])).size + r.agrupado.semHierarquia.length;
      if (r.agrupado.semHierarquia.length > 0) {
        return finalizar(leitor, e, { trilha: [], rotuloNivel: null, filhos: [...filhos.map(filho), semLinha(r.agrupado.semHierarquia.length)], candidatos: [], porId, total, noInexistente: !noValido });
      }
    } else {
      candidatos = r.agrupado.semHierarquia;
      total = candidatos.length;
      rotuloNivel = 'Sem linha';
    }
  } else {
    const nos = descendentesDe(arvore, noId);
    const vinculos = await vinculosDosNos(leitor, nos);
    const ids = [...new Set(vinculos.map((v) => v.produto_id))];
    const produtos = await produtosPorIds(leitor, ids);
    porId = new Map(produtos.map((p) => [p.id, p]));
    grupo = acharGrupo(agruparPorLinha(arvore, vinculos, produtos.map(paraLista)).sistemas, noId);
    trilha = trilhaDe(arvore, noId);
    rotuloNivel = grupo?.rotuloNivel ?? rotuloDoNivel(trilha.length);
    filhos = grupo?.filhos ?? [];
    total = grupo?.total ?? 0;
    // linha (nível 3 em diante) ou nível sem filhos: os itens de tudo abaixo; acima disso, só os ligados direto
    candidatos = !grupo ? [] : grupo.filhos.length === 0 || grupo.no!.nivel >= NIVEL_DA_LINHA ? [...coletar(grupo)].map((id) => paraLista(porId.get(id)!)) : grupo.produtos;
  }
  return finalizar(leitor, e, { trilha, rotuloNivel, filhos: filhos.map(filho), candidatos, porId, total, noInexistente: !noValido });
}

const filho = (g: GrupoLista): FilhoLista => ({ id: g.no!.id, codigo: g.no!.codigo, nome: g.no!.nome, rotuloNivel: g.rotuloNivel, total: g.total });
const semLinha = (total: number): FilhoLista => ({ id: NO_SEM_LINHA, codigo: NO_SEM_LINHA, nome: 'Sem linha', rotuloNivel: 'Sem linha', total });

async function finalizar(
  leitor: LeitorLocal,
  e: EntradaLocal & { fuso: string },
  base: { trilha: NoCatalogo[]; rotuloNivel: string | null; filhos: FilhoLista[]; candidatos: ProdutoLista[]; porId: Map<string, LinhaProduto>; total: number; noInexistente: boolean },
): Promise<NivelLista> {
  const mostrados = [...base.candidatos].sort(porNome).slice(0, MAXIMO_ITENS_LISTA);
  const linhas = mostrados.map((p) => base.porId.get(p.id)!);
  // "oferece junto": nomes dos produtos citados que não estão na tela (só os que o aparelho tem)
  const nomes = new Map(linhas.map((p) => [p.id, p.nome]));
  const faltam = [...new Set(mostrados.flatMap((p) => p.extras.oferece_junto))].filter((id) => !nomes.has(id));
  for (const p of await produtosPorIds(leitor, faltam)) nomes.set(p.id, p.nome);
  // preço e estoque só dos itens da tela; sem permissão o contexto vem vazio e o item sai sem os dois (RN-CAT-05)
  const contexto = await contextoLocal(leitor, e, linhas.map(doCatalogo));
  const itens = mostrados.map((p, i) => montarItemLista(p, itemDaVitrine(doCatalogo(linhas[i]!), contexto), { agora: e.agora, fuso: e.fuso, nomesPorId: nomes }));
  return { trilha: base.trilha, rotuloNivel: base.rotuloNivel, filhos: base.filhos, itens, total: base.total, noInexistente: base.noInexistente, vazio: base.filhos.length === 0 && itens.length === 0 };
}
