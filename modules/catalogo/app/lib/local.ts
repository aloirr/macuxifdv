/**
 * Catálogo OFFLINE no aparelho (RF-CAT-02, T-0052): lê as linhas locais do sync (produto do Core; preço, estoque,
 * atributos, sinônimos e conteúdo do Catálogo) e roda o MESMO domain da API (vitrine, busca, ficha). Puro: recebe um
 * leitor (o motor de sync no app, um mapa nos testes); nada de React Native aqui.
 * Sem sinal a busca é textual (regras locais, sem IA) e vem com o aviso discreto `AVISO_BUSCA_OFFLINE`.
 */
import type { ConsultaTexto, LinhaSync, Perfil, ResultadoBusca as ResultadoFts } from '@macuxi/platform-sdk';
import type { ProdutoSync } from '@macuxi/core/contracts';
import type {
  CatalogoNoSync,
  ClienteTabelaPrecoSync,
  DepositoSync,
  EstoqueSaldoSync,
  FichaProduto,
  ItemTabelaPreco,
  ProdutoAtributoSync,
  ProdutoConteudoSync,
  ProdutoNoSync,
  SinonimoSync,
  StockByBranch,
  TabelaPrecoItemSync,
  TabelaPrecoSync,
} from '../../contracts';
import { montarArvore, produtosDoNo, produtosVendaveisNaTabela, type Arvore, type VinculoProdutoNo } from '../../domain/arvore';
import { montarFicha, type ConteudoGuardado } from '../../domain/conteudo';
import { interpretarConsulta } from '../../domain/consulta';
import { AVISO_BUSCA_OFFLINE } from '../../domain/ia';
import { parametrosDoTenant } from '../../domain/parametros';
import { expandirSinonimos, type SinonimoDoTenant } from '../../domain/texto';
import { podeVerPrecoEstoque } from '../../domain/visibilidade';
import { buscarProdutos, itemDaVitrine, listarVitrine, vocabularioDe, type ChipsVitrine, type ContextoVitrine, type PaginaProdutos, type ProdutoCatalogo } from '../../domain/vitrine';

/** Id do índice FTS5 do Catálogo no aparelho (`app/indice.ts`). */
export const ID_INDICE_BUSCA = 'catalogo.produto';
/**
 * Acima disto a busca local pré-seleciona candidatos pelo FTS5 antes do ranking (abaixo, o ranking varre tudo).
 * T-0052-B4: o ranking do domain custa ~0,3 a 1 ms por produto no aparelho; com 500 produtos a varredura cabe no orçamento.
 */
export const LIMIAR_PRESELECAO_FTS = 500;
/** Candidatos que cada termo (com sinônimos) pede ao FTS5, em ordem de relevância (`bm25`). */
export const CANDIDATOS_POR_TERMO = 150;
/** Teto de candidatos que chegam ao ranking do domain. */
export const MAXIMO_CANDIDATOS = 400;

/** O que a busca local precisa do motor de sync (`useMotorSync().motor`). */
export interface LeitorLocal {
  linhas<L extends LinhaSync>(entidade: string): Promise<L[]>;
  buscar?(indice: string, consulta: ConsultaTexto): Promise<ResultadoFts[] | null>;
  /**
   * Leituras do motor de sync (T-0052-B4, opcionais: sem elas — leitor de mapa dos testes — cai em `linhas`). Com as três
   * últimas o custo de ler o catálogo inteiro cai para uma vez por sync, e preço/estoque só dos candidatos.
   */
  linhasPorIds?<L extends LinhaSync>(entidade: string, ids: readonly string[]): Promise<L[]>;
  linhasPorCampo?<L extends LinhaSync>(entidade: string, campo: string, valores: readonly string[]): Promise<L[]>;
  contarLinhas?(entidade: string): Promise<number>;
  versaoLinhas?(entidade: string): number;
}

/**
 * Memória de uma posição, chaveada pela versão das linhas (`versaoLinhas`, única no processo: outro motor ou outro
 * usuário = outra versão). Guarda só o derivado (o SDK não guarda linhas; ADR 0003). Sem `versaoLinhas`, não memoriza.
 */
function memorizar<T>(posicao: Map<string, { chave: string; valor: T }>, nome: string, leitor: LeitorLocal, entidades: readonly string[]) {
  return async (calcular: () => Promise<T>): Promise<T> => {
    if (!leitor.versaoLinhas) return calcular();
    // a versão é lida ANTES das linhas: se o sync gravar durante a leitura, a próxima busca relê
    const chave = entidades.map((e) => leitor.versaoLinhas!(e)).join('|');
    const guardado = posicao.get(nome);
    if (guardado && guardado.chave === chave) return guardado.valor;
    const valor = await calcular();
    posicao.set(nome, { chave, valor });
    return valor;
  };
}
const memoria = new Map<string, { chave: string; valor: unknown }>();
const lembrar = <T>(nome: string, leitor: LeitorLocal, entidades: readonly string[], calcular: () => Promise<T>) =>
  memorizar(memoria as Map<string, { chave: string; valor: T }>, nome, leitor, entidades)(calcular);
/** Só para testes: esquece o que foi memorizado. */
export function esquecerMemoriaLocal(): void {
  memoria.clear();
  vocabularios = new WeakMap();
}
let vocabularios = new WeakMap<readonly ProdutoCatalogo[], ReturnType<typeof vocabularioDe>>();
const vocabularioMemorizado = (produtos: readonly ProdutoCatalogo[]) => {
  let v = vocabularios.get(produtos);
  if (!v) {
    v = vocabularioDe(produtos);
    vocabularios.set(produtos, v);
  }
  return v;
};

export interface EntradaLocal {
  perfil: Perfil | null;
  /** Parâmetros crus do Catálogo (`useParametros('catalogo')`). */
  parametros: Readonly<Record<string, unknown>>;
  agora: string;
  clienteId: string | null;
}

const vivas = <L extends LinhaSync>(l: L[]) => l.filter((x) => !x.deleted_at);

/** Produtos do Core enriquecidos com atributos e campanha do Catálogo. */
export function produtosLocais(leitor: LeitorLocal): Promise<ProdutoCatalogo[]> {
  return lembrar('produtos', leitor, ['produto', 'produto_atributo', 'produto_conteudo'], () => montarProdutosLocais(leitor));
}

async function montarProdutosLocais(leitor: LeitorLocal): Promise<ProdutoCatalogo[]> {
  const produtos = vivas(await leitor.linhas<ProdutoSync & LinhaSync>('produto'));
  const atributos = vivas(await leitor.linhas<ProdutoAtributoSync & LinhaSync>('produto_atributo'));
  const conteudos = vivas(await leitor.linhas<ProdutoConteudoSync & LinhaSync>('produto_conteudo'));
  const porProduto = new Map<string, ProdutoAtributoSync[]>();
  for (const a of atributos) porProduto.set(a.produto_id, [...(porProduto.get(a.produto_id) ?? []), a]);
  const campanha = new Set(conteudos.filter((c) => c.campanha).map((c) => c.produto_id));
  return produtos.map((p) => ({
    id: p.id,
    sku: p.sku,
    ean: p.ean,
    nome: p.nome,
    marca: p.marca ?? '',
    categoria: p.categoria ?? '',
    unidade: p.unidade,
    ativo: p.ativo,
    atributos: (porProduto.get(p.id) ?? []).sort((a, b) => a.ordem - b.ordem).map((a) => ({ name: a.nome, value: a.valor })),
    thumbnail_url: null,
    campanha: campanha.has(p.id),
    vendas: 0,
  }));
}

export function sinonimosLocais(leitor: LeitorLocal): Promise<SinonimoDoTenant[]> {
  return lembrar('sinonimos', leitor, ['sinonimo'], async () =>
    vivas(await leitor.linhas<SinonimoSync & LinhaSync>('sinonimo')).map((s) => ({ term: s.termo, synonyms: s.sinonimos, active: s.ativo })),
  );
}

/** Acima disto (ex.: a vitrine inteira) ler tudo é mais barato que pedir por campo. */
const MAXIMO_POR_CAMPO = 1000;

/**
 * Preço e estoque locais do usuário. RN-CAT-05: o aparelho do promotor nem recebe preço (o pull devolve vazio); mesmo
 * assim, sem a permissão nada é lido. RN-CAT-06: tabela = a viva e ativa do cliente, sem cair em outra.
 */
export async function contextoLocal(leitor: LeitorLocal, e: EntradaLocal, produtos: readonly ProdutoCatalogo[]): Promise<ContextoVitrine> {
  const parametros = parametrosDoTenant(e.parametros);
  // sem usuário logado não há perfil para liberar preço (falha fechada): trata como promotor
  const perfil: Perfil = e.perfil ?? 'promotor';
  const base = { perfil, parametros, agora: e.agora, clienteId: e.clienteId };
  if (e.perfil === null || !podeVerPrecoEstoque(perfil, parametros)) return { ...base, tabelaClienteId: null, itensPreco: [], promocoes: [], saldos: new Map(), filiais: [] };

  // só os candidatos (busca com FTS5) leem por campo; a vitrine inteira lê tudo (T-0052-B4)
  const porCampo = !!leitor.linhasPorCampo && produtos.length <= MAXIMO_POR_CAMPO;
  let tabelaClienteId: string | null = null;
  let itensPreco: ItemTabelaPreco[] = [];
  if (e.clienteId) {
    const vinculos = porCampo
      ? await leitor.linhasPorCampo!<ClienteTabelaPrecoSync & LinhaSync>('cliente_tabela_preco', 'cliente_id', [e.clienteId])
      : await leitor.linhas<ClienteTabelaPrecoSync & LinhaSync>('cliente_tabela_preco');
    const vinculo = vivas(vinculos).find((v) => v.cliente_id === e.clienteId);
    const tabelas = !vinculo ? [] : leitor.linhasPorIds ? await leitor.linhasPorIds<TabelaPrecoSync & LinhaSync>('tabela_preco', [vinculo.tabela_preco_id]) : await leitor.linhas<TabelaPrecoSync & LinhaSync>('tabela_preco');
    const tabela = vinculo ? vivas(tabelas).find((t) => t.id === vinculo.tabela_preco_id && t.ativo) : undefined;
    if (tabela) {
      tabelaClienteId = tabela.id;
      const ids = new Set(produtos.map((p) => p.id));
      const linhasPreco = porCampo
        ? await leitor.linhasPorCampo!<TabelaPrecoItemSync & LinhaSync>('tabela_preco_item', 'produto_id', [...ids])
        : await leitor.linhas<TabelaPrecoItemSync & LinhaSync>('tabela_preco_item');
      itensPreco = vivas(linhasPreco)
        .filter((i) => i.tabela_preco_id === tabela.id && ids.has(i.produto_id))
        .map((i) => ({ price_table_id: tabela.id, product_id: i.produto_id, price_cents: i.preco_cents, valid_from: i.vigencia_inicio, valid_to: i.vigencia_fim }));
    }
  }
  const depositos = await lembrar('depositos', leitor, ['deposito'], async () => new Map(vivas(await leitor.linhas<DepositoSync & LinhaSync>('deposito')).map((d) => [d.id, d.nome])));
  const saldos = new Map<string, StockByBranch[]>();
  const linhasSaldo = porCampo
    ? await leitor.linhasPorCampo!<EstoqueSaldoSync & LinhaSync>('estoque_saldo', 'produto_id', produtos.map((p) => p.id))
    : await leitor.linhas<EstoqueSaldoSync & LinhaSync>('estoque_saldo');
  for (const s of vivas(linhasSaldo)) {
    const l = saldos.get(s.produto_id) ?? [];
    l.push({ branch_id: s.deposito_id, branch_name: depositos.get(s.deposito_id) ?? 'Depósito', quantity: Math.trunc(s.quantidade), updated_at: s.atualizado_em });
    saldos.set(s.produto_id, l);
  }
  // o pull de estoque já vem filtrado pelas filiais do usuário (escopo do servidor): no aparelho, todas as recebidas
  return { ...base, tabelaClienteId, itensPreco, promocoes: [], saldos, filiais: null };
}

export interface ResultadoLocal extends PaginaProdutos {
  /** Aviso discreto (sem sinal: a busca inteligente volta com a internet). */
  aviso: string | null;
}

/** Tamanhos de prefixo tentados quando o termo inteiro não acha nada (erro de digitação perto do fim da palavra). */
const PREFIXOS_TOLERANTES = [4, 3] as const;

async function porPrefixo(leitor: LeitorLocal, grupo: readonly string[]): Promise<ResultadoFts[]> {
  for (const n of PREFIXOS_TOLERANTES) {
    const prefixos = [...new Set(grupo.filter((t) => t.length > n).map((t) => t.slice(0, n)))];
    if (prefixos.length === 0) continue;
    const r = await leitor.buscar!(ID_INDICE_BUSCA, { grupos: [prefixos], prefixoNoUltimo: true, limite: CANDIDATOS_POR_TERMO });
    if (r && r.length > 0) return r;
  }
  return [];
}

/**
 * Candidatos pelo FTS5 quando o catálogo é grande; `null` = varrer todos (catálogo pequeno, sem índice ou FTS5 sem
 * nenhum acerto). Mesma semântica do domain em qualquer tamanho (T-0052-B2): o domain pontua quem casa QUALQUER termo
 * e o ranking decide; por isso cada termo (com seus sinônimos) vira uma consulta própria e o conjunto é a união, com
 * quem casa mais termos primeiro e o `bm25` desempatando. O ranking só roda sobre esses candidatos (T-0052-B4).
 */
export async function preselecionar(
  leitor: LeitorLocal,
  texto: string,
  codigo: string | null,
  sinonimos: readonly SinonimoDoTenant[],
  total: number,
): Promise<Set<string> | null> {
  if (total <= LIMIAR_PRESELECAO_FTS || !leitor.buscar) return null;
  const grupos = expandirSinonimos(texto, sinonimos);
  if (codigo) grupos.push([codigo]);
  if (grupos.length === 0) return null;
  const achados = new Map<string, { termos: number; melhor: number }>();
  for (const grupo of grupos.slice(0, 8)) {
    let r = await leitor.buscar(ID_INDICE_BUSCA, { grupos: [grupo], prefixoNoUltimo: true, limite: CANDIDATOS_POR_TERMO });
    // sem acerto = provável erro de digitação (T-0052, caso lento): o prefixo do termo aproxima a tolerância do domain
    // sem cair na varredura de todo o catálogo
    if (r && r.length === 0) r = await porPrefixo(leitor, grupo);
    (r ?? []).forEach((x, posicao) => {
      const a = achados.get(x.chave);
      if (a) {
        a.termos++;
        a.melhor = Math.min(a.melhor, posicao);
      } else achados.set(x.chave, { termos: 1, melhor: posicao });
    });
  }
  if (achados.size === 0) return null;
  const ordem = [...achados.entries()].sort(([, x], [, y]) => y.termos - x.termos || x.melhor - y.melhor);
  return new Set(ordem.slice(0, MAXIMO_CANDIDATOS).map(([chave]) => chave));
}

/** Busca no aparelho (sem IA): regras locais + sinônimos + ranking do domain; com `offline`, devolve o aviso. */
export async function buscarLocal(leitor: LeitorLocal, e: EntradaLocal & { q: string; chips?: ChipsVitrine; limit: number; offset: number; offline: boolean }): Promise<ResultadoLocal> {
  const produtos = await produtosLocais(leitor);
  const sinonimos = await sinonimosLocais(leitor);
  const filtros = interpretarConsulta(e.q, vocabularioMemorizado(produtos));
  const candidatos = await preselecionar(leitor, filtros.text, filtros.code?.value ?? null, sinonimos, produtos.length);
  const universo = candidatos ? produtos.filter((p) => candidatos.has(p.id)) : produtos;
  const contexto = await contextoLocal(leitor, e, universo);
  const pagina = buscarProdutos({ produtos: universo, contexto, filtros, chips: e.chips ?? {}, sinonimos, limit: e.limit, offset: e.offset });
  return { ...pagina, aviso: e.offline && e.q.trim() !== '' ? AVISO_BUSCA_OFFLINE : null };
}

/** Vitrine no aparelho (sem texto). */
export async function vitrineLocal(leitor: LeitorLocal, e: EntradaLocal & { chips?: ChipsVitrine; limit: number; offset: number }): Promise<PaginaProdutos> {
  const produtos = await produtosLocais(leitor);
  const contexto = await contextoLocal(leitor, e, produtos);
  return listarVitrine({ produtos, contexto, chips: e.chips ?? {}, sinonimos: [], limit: e.limit, offset: e.offset });
}

/** Marcas e categorias locais (chips). */
export async function filtrosLocais(leitor: LeitorLocal): Promise<{ marcas: string[]; linhas: string[] }> {
  const v = vocabularioMemorizado(await produtosLocais(leitor));
  return { marcas: [...v.marcas], linhas: [...v.linhas] };
}

/** Ficha no aparelho (RF-CAT-03): o produto inativo ou que não está no aparelho = `null` ("produto não encontrado"). */
export async function fichaLocal(leitor: LeitorLocal, e: EntradaLocal & { produtoId: string }): Promise<FichaProduto | null> {
  const produto = (await produtosLocais(leitor)).find((p) => p.id === e.produtoId && p.ativo);
  if (!produto) return null;
  const contexto = await contextoLocal(leitor, e, [produto]);
  const c = vivas(await leitor.linhas<ProdutoConteudoSync & LinhaSync>('produto_conteudo')).find((x) => x.produto_id === produto.id);
  const conteudo: ConteudoGuardado | null = c ? { description: c.descricao, selling_points: c.argumentos, faq: c.faq.map((f) => ({ question: f.pergunta, answer: f.resposta })), updated_at: c.updated_at } : null;
  return montarFicha(produto, itemDaVitrine(produto, contexto), conteudo, []);
}

/** Árvore do catálogo no aparelho (RF-CAT-04): nós e vínculos do sync; sem sinal navega igual. */
export async function arvoreLocal(leitor: LeitorLocal): Promise<{ arvore: Arvore; vinculos: VinculoProdutoNo[] }> {
  const nos = await leitor.linhas<CatalogoNoSync & LinhaSync>('catalogo_no');
  const vinculos = vivas(await leitor.linhas<ProdutoNoSync & LinhaSync>('produto_no'));
  return { arvore: montarArvore(nos), vinculos };
}

/**
 * Produtos que a navegação pode mostrar (RF-CAT-04). `noId` limita ao nó e aos níveis abaixo (`null` = toda a árvore, ou
 * sem filtro de nó se o tenant não tem árvore). Dentro do pedido (`soDaTabelaDoCliente`), só os com preço vigente na tabela
 * do cliente (RN-CAT-06). `undefined` = sem restrição por esta via.
 */
export async function produtosDaNavegacao(leitor: LeitorLocal, e: EntradaLocal & { noId: string | null; soDaTabelaDoCliente: boolean }): Promise<ReadonlySet<string> | undefined> {
  const { arvore, vinculos } = await arvoreLocal(leitor);
  let ids: Set<string> | undefined = e.noId === null ? undefined : produtosDoNo(arvore, vinculos, e.noId);
  if (e.soDaTabelaDoCliente) {
    const produtos = await produtosLocais(leitor);
    const ctx = await contextoLocal(leitor, e, produtos);
    const vendaveis = produtosVendaveisNaTabela(ctx.itensPreco, ctx.tabelaClienteId, e.agora);
    ids = ids ? new Set([...ids].filter((p) => vendaveis.has(p))) : vendaveis;
  }
  return ids;
}
