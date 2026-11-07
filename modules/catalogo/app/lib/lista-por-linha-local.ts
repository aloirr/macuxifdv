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
import type { CatalogoNoSync, ProdutoConteudoSync, ProdutoNoSync, ProdutoReferenciaSync, ProdutoRelacaoSync } from '../../contracts';
import { descendentesDe, montarArvore, trilhaDe, type Arvore, type NoCatalogo, type VinculoProdutoNo } from '../../domain/arvore';
import { itemDaVitrine, type ProdutoCatalogo } from '../../domain/vitrine';
import { contextoLocal, type EntradaLocal, type LeitorLocal } from './local';
import { agruparPorLinha, coletar, contarSistemas, montarExtras, montarItemLista, NO_SEM_LINHA, ordenarPorNome, rotuloDoNivel, SEM_EXTRAS, type ExtrasProduto, type GrupoLista, type ItemLista, type ProdutoLista } from './lista-por-linha';

/** Itens por tela: o resto fica na busca e nos níveis abaixo (a lista não cresce sem limite). */
export const MAXIMO_ITENS_LISTA = 100;
/** A partir deste nível (linha) a tela mostra os itens, mesmo que ainda haja níveis abaixo. */
const NIVEL_DA_LINHA = 3;
/** Nós de nível memorizados por leitor (LRU): abrir os 440 nós da árvore não retém tudo na memória. */
export const MAXIMO_NOS_MEMORIZADOS = 40;

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
  /** Itens que ainda não vieram na tela ("Mostrar mais" traz mais `MAXIMO_ITENS_LISTA`). */
  restantes: number;
  /** O nó pedido não existe (mais) na árvore do aparelho: o nível vem vazio e a tela oferece a volta (`voltarPara`). */
  noInexistente: boolean;
  /** Com `noInexistente`: o ancestral mais próximo que ainda existe (`null` = raiz). Nos demais casos, `null`. */
  voltarPara: string | null;
  /** Nível sem filhos e sem itens. */
  vazio: boolean;
}

interface Registro<T> {
  chave: string;
  valor: T;
}
const PREFIXO_NO = 'lista-no:';
const memorias = new WeakMap<object, Map<string, Registro<unknown>>>();

/** Memoriza pelo `versaoLinhas` das entidades (versão lida ANTES das linhas); sem `versaoLinhas`, não memoriza. */
async function lembrar<T>(leitor: LeitorLocal, nome: string, entidades: readonly string[], calcular: () => Promise<T>): Promise<T> {
  if (!leitor.versaoLinhas) return calcular();
  const chave = entidades.map((e) => leitor.versaoLinhas!(e)).join('|');
  let m = memorias.get(leitor);
  if (!m) memorias.set(leitor, (m = new Map()));
  const guardado = m.get(nome) as Registro<T> | undefined;
  if (guardado && guardado.chave === chave) {
    m.delete(nome); // reinsere: o mais recente fica no fim (LRU)
    m.set(nome, guardado);
    return guardado.valor;
  }
  const valor = await calcular();
  m.delete(nome);
  m.set(nome, { chave, valor });
  if (nome.startsWith(PREFIXO_NO)) {
    const nos = [...m.keys()].filter((k) => k.startsWith(PREFIXO_NO));
    for (const k of nos.slice(0, Math.max(0, nos.length - MAXIMO_NOS_MEMORIZADOS))) m.delete(k);
  }
  return valor;
}

const vivas = <L extends LinhaSync>(l: L[]) => l.filter((x) => !x.deleted_at);
type LinhaProduto = ProdutoSync & LinhaSync;

function doCatalogo(p: LinhaProduto): ProdutoCatalogo {
  return { id: p.id, sku: p.sku, ean: p.ean, nome: p.nome, marca: p.marca ?? '', categoria: p.categoria ?? '', unidade: p.unidade, ativo: p.ativo, atributos: [], thumbnail_url: null, campanha: false, vendas: 0 };
}
function paraLista(p: LinhaProduto): ProdutoLista {
  return { id: p.id, sku: p.sku, nome: p.nome, unidade: p.unidade, embalagem_medida: p.embalagem_medida, embalagem_quantidade: p.embalagem_quantidade, extras: SEM_EXTRAS };
}
const ativos = (l: LinhaProduto[]) => vivas(l).filter((p) => p.ativo);

async function produtosPorIds(leitor: LeitorLocal, ids: readonly string[]): Promise<LinhaProduto[]> {
  if (ids.length === 0) return [];
  if (leitor.linhasPorIds) return ativos(await leitor.linhasPorIds<LinhaProduto>('produto', ids));
  const pedidos = new Set(ids);
  return ativos(await leitor.linhas<LinhaProduto>('produto')).filter((p) => pedidos.has(p.id));
}

/** Linhas de uma entidade do pull por `produto_id` (só dos produtos pedidos). Sem `linhasPorCampo` (leitor dos testes), lê tudo e filtra. */
async function doProduto<L extends LinhaSync & { produto_id: string }>(leitor: LeitorLocal, entidade: string, ids: readonly string[]): Promise<L[]> {
  if (ids.length === 0) return [];
  const pedidos = new Set(ids);
  const linhas = leitor.linhasPorCampo ? await leitor.linhasPorCampo<L>(entidade, 'produto_id', ids) : await leitor.linhas<L>(entidade);
  return vivas(linhas).filter((l) => pedidos.has(l.produto_id));
}

/** Aplicação, referências, oferece junto e etiquetas dos produtos que vão para a tela (conteúdo, referência e relação do pull). */
async function extrasDosProdutos(leitor: LeitorLocal, ids: readonly string[]): Promise<Map<string, ExtrasProduto>> {
  const [conteudos, referencias, relacoes] = await Promise.all([
    doProduto<ProdutoConteudoSync & LinhaSync>(leitor, 'produto_conteudo', ids),
    doProduto<ProdutoReferenciaSync & LinhaSync>(leitor, 'produto_referencia', ids),
    doProduto<ProdutoRelacaoSync & LinhaSync>(leitor, 'produto_relacao', ids),
  ]);
  const por = <T extends { produto_id: string }>(l: T[]) => l.reduce((m, x) => m.set(x.produto_id, [...(m.get(x.produto_id) ?? []), x]), new Map<string, T[]>());
  const refs = por(referencias);
  const rels = por(relacoes);
  const cont = new Map(conteudos.map((c) => [c.produto_id, c]));
  return new Map(ids.map((id) => [id, montarExtras(cont.get(id), refs.get(id) ?? [], rels.get(id) ?? [])]));
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

/**
 * Raiz: só as contagens dos sistemas, o total e os ids sem linha, lidos uma vez por sync. Não cria itens da lista, não
 * ordena e não guarda produtos (os sem linha são lidos por id quando o grupo "Sem linha" é aberto).
 */
function raiz(leitor: LeitorLocal, arvore: Arvore) {
  return lembrar(leitor, 'lista-raiz', ['catalogo_no', 'produto_no', 'produto'], async () => {
    const vinculos = vivas(await leitor.linhas<ProdutoNoSync & LinhaSync>('produto_no'));
    const ativosIds = new Set(ativos(await leitor.linhas<LinhaProduto>('produto')).map((p) => p.id));
    return contarSistemas(arvore, vinculos, ativosIds);
  });
}

interface NivelLido {
  grupo: GrupoLista | null;
  porId: Map<string, LinhaProduto>;
}

/** Um sistema/grupo/linha: lê só os vínculos e os produtos da subárvore; memorizado por nó até o próximo sync. */
function lerNivel(leitor: LeitorLocal, arvore: Arvore, noId: string): Promise<NivelLido> {
  return lembrar(leitor, `${PREFIXO_NO}${noId}`, ['catalogo_no', 'produto_no', 'produto'], async () => {
    const vinculos = await vinculosDosNos(leitor, descendentesDe(arvore, noId));
    const ids = [...new Set(vinculos.map((v) => v.produto_id))];
    const produtos = await produtosPorIds(leitor, ids);
    return { grupo: acharGrupo(agruparPorLinha(arvore, vinculos, produtos.map(paraLista), false).sistemas, noId), porId: new Map(produtos.map((p) => [p.id, p])) };
  });
}

/**
 * Um nível da lista por linha. `noId` nulo = raiz (sistemas); `NO_SEM_LINHA` = produtos fora da árvore. Cliente em
 * contexto = preço da tabela dele (RN-CAT-06); sem permissão para preço e estoque o item sai sem os dois (RN-CAT-05).
 */
export async function listaPorLinhaLocal(leitor: LeitorLocal, e: EntradaLocal & { noId: string | null; fuso: string; ultimaTrilha?: readonly string[]; limite?: number }): Promise<NivelLista> {
  const arvore = await arvoreDoAparelho(leitor);
  const noValido = e.noId === null || e.noId === NO_SEM_LINHA || arvore.nos.has(e.noId);
  const noId = e.noId;
  if (!noValido) {
    const voltarPara = await ancestralVivo(leitor, arvore, e.noId!, e.ultimaTrilha ?? []);
    return finalizar(leitor, e, { trilha: [], rotuloNivel: null, filhos: [], candidatos: [], porId: new Map(), total: 0, noInexistente: true, voltarPara });
  }

  let grupo: GrupoLista | null = null;
  let filhos: GrupoLista[] = [];
  let candidatos: ProdutoLista[] = [];
  let porId = new Map<string, LinhaProduto>();
  let total = 0;
  let trilha: NoCatalogo[] = [];
  let rotuloNivel: string | null = null;

  if (noId === null || noId === NO_SEM_LINHA) {
    const r = await raiz(leitor, arvore);
    if (noId === null) {
      filhos = r.sistemas.map((n) => ({ no: n.no, rotuloNivel: n.rotuloNivel, total: n.total, produtos: [], filhos: [] }));
      total = r.total;
      if (r.semLinhaIds.length > 0) {
        return finalizar(leitor, e, { trilha: [], rotuloNivel: null, filhos: [...filhos.map(filho), semLinha(r.semLinhaIds.length)], candidatos: [], porId, total, noInexistente: false, voltarPara: null });
      }
    } else {
      const soltos = await produtosPorIds(leitor, r.semLinhaIds);
      porId = new Map(soltos.map((p) => [p.id, p]));
      candidatos = soltos.map(paraLista);
      total = candidatos.length;
      rotuloNivel = 'Sem linha';
    }
  } else {
    const lido = await lerNivel(leitor, arvore, noId);
    porId = lido.porId;
    grupo = lido.grupo;
    trilha = trilhaDe(arvore, noId);
    rotuloNivel = grupo?.rotuloNivel ?? rotuloDoNivel(trilha.length);
    filhos = grupo?.filhos ?? [];
    total = grupo?.total ?? 0;
    // linha (nível 3 em diante) ou nível sem filhos: os itens de tudo abaixo; acima disso, só os ligados direto
    candidatos = !grupo ? [] : grupo.filhos.length === 0 || grupo.no!.nivel >= NIVEL_DA_LINHA ? [...coletar(grupo)].map((id) => paraLista(porId.get(id)!)) : grupo.produtos;
  }
  return finalizar(leitor, e, { trilha, rotuloNivel, filhos: filhos.map(filho), candidatos, porId, total, noInexistente: false, voltarPara: null });
}

/**
 * Nó removido no sync: o ancestral mais próximo que ainda está na árvore. Sobe pelo `pai_id` das linhas (a remoção
 * lógica ainda as traz); se a linha sumiu do aparelho, usa a última trilha conhecida (ids, do sistema ao nível), do
 * fim para o começo. Nenhum vivo = `null` (raiz).
 */
async function ancestralVivo(leitor: LeitorLocal, arvore: Arvore, noId: string, ultimaTrilha: readonly string[]): Promise<string | null> {
  const porId = new Map((await leitor.linhas<CatalogoNoSync & LinhaSync>('catalogo_no')).map((n) => [n.id, n]));
  const candidatos: string[] = [];
  const vistos = new Set<string>([noId]);
  let pai = porId.get(noId)?.pai_id ?? null;
  while (pai && !vistos.has(pai)) {
    vistos.add(pai);
    candidatos.push(pai);
    pai = porId.get(pai)?.pai_id ?? null;
  }
  return [...candidatos, ...[...ultimaTrilha].reverse()].find((id) => id !== noId && arvore.nos.has(id)) ?? null;
}

const filho = (g: GrupoLista): FilhoLista => ({ id: g.no!.id, codigo: g.no!.codigo, nome: g.no!.nome, rotuloNivel: g.rotuloNivel, total: g.total });
const semLinha = (total: number): FilhoLista => ({ id: NO_SEM_LINHA, codigo: NO_SEM_LINHA, nome: 'Sem linha', rotuloNivel: 'Sem linha', total });

async function finalizar(
  leitor: LeitorLocal,
  e: EntradaLocal & { fuso: string; limite?: number },
  base: { trilha: NoCatalogo[]; rotuloNivel: string | null; filhos: FilhoLista[]; candidatos: ProdutoLista[]; porId: Map<string, LinhaProduto>; total: number; noInexistente: boolean; voltarPara: string | null },
): Promise<NivelLista> {
  const todos = ordenarPorNome(base.candidatos);
  const ordenados = todos.slice(0, Math.max(MAXIMO_ITENS_LISTA, e.limite ?? MAXIMO_ITENS_LISTA));
  const extras = await extrasDosProdutos(leitor, ordenados.map((p) => p.id));
  const mostrados = ordenados.map((p) => ({ ...p, extras: extras.get(p.id) ?? SEM_EXTRAS }));
  const linhas = mostrados.map((p) => base.porId.get(p.id)!);
  // "oferece junto": nomes dos produtos citados que não estão na tela (só os que o aparelho tem)
  const nomes = new Map(linhas.map((p) => [p.id, p.nome]));
  const faltam = [...new Set(mostrados.flatMap((p) => p.extras.oferece_junto))].filter((id) => !nomes.has(id));
  for (const p of await produtosPorIds(leitor, faltam)) nomes.set(p.id, p.nome);
  // preço e estoque só dos itens da tela; sem permissão o contexto vem vazio e o item sai sem os dois (RN-CAT-05)
  const contexto = await contextoLocal(leitor, e, linhas.map(doCatalogo));
  const itens = mostrados.map((p, i) => montarItemLista(p, itemDaVitrine(doCatalogo(linhas[i]!), contexto), { agora: e.agora, fuso: e.fuso, nomesPorId: nomes }));
  return { trilha: base.trilha, rotuloNivel: base.rotuloNivel, filhos: base.filhos, itens, total: base.total, restantes: todos.length - itens.length, noInexistente: base.noInexistente, voltarPara: base.voltarPara, vazio: base.filhos.length === 0 && itens.length === 0 };
}
