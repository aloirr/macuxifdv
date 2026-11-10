/**
 * Catálogo OFFLINE no aparelho (RF-CAT-02, T-0052): lê as linhas locais do sync (produto do Core; preço, estoque,
 * atributos, sinônimos e conteúdo do Catálogo) e roda o MESMO domain da API (vitrine, busca, ficha). Puro: recebe um
 * leitor (o motor de sync no app, um mapa nos testes); nada de React Native aqui.
 * Sem sinal a busca é textual (regras locais, sem IA) e vem com o aviso discreto `AVISO_BUSCA_OFFLINE`.
 */
import type { ConsultaTexto, DesfechoBusca, LinhaSync, Perfil, ResultadoBusca as ResultadoFts } from '@macuxi/platform-sdk';
import type { ClienteSync, FilialSync, ProdutoSync } from '@macuxi/core/contracts';
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
  ProdutoRelacaoSync,
  ProdutoReferenciaSync,
  Referencia,
  SinonimoSync,
  StockByBranch,
  TabelaPrecoItemSync,
  TabelaPrecoSync,
} from '../../contracts';
import { montarArvore, produtosDoNo, produtosVendaveisNaTabela, type Arvore, type VinculoProdutoNo } from '../../domain/arvore';
import { montarFicha, type ConteudoGuardado } from '../../domain/conteudo';
import { interpretarConsulta } from '../../domain/consulta';
import { AVISO_BUSCA_OFFLINE } from '../../domain/ia';
import { nomeMarcaDaReferencia } from '../../domain/marcas';
import { parametrosDoTenant } from '../../domain/parametros';
import { filialDoClienteLocal, filialDoPreco, type FilialLocalDoCliente } from '../../domain/preco-filial';
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
/**
 * T-0052 (R-20261105-142853): acima disto, consulta sem nenhum acerto no FTS5 (nem pelo prefixo de 4/3 letras) devolve
 * vazio sem varrer o catálogo (a varredura de 20 mil produtos levava ~93 s). Só vale quando TODAS as buscas disseram
 * `buscou: true`; qualquer `buscou: false` (módulo indisponível, erro, consulta curta) mantém a varredura.
 */
export const LIMIAR_SEM_VARREDURA = 5000;

/** O que a busca local precisa do motor de sync (`useMotorSync().motor`). */
export interface LeitorLocal {
  linhas<L extends LinhaSync>(entidade: string): Promise<L[]>;
  buscar?(indice: string, consulta: ConsultaTexto): Promise<ResultadoFts[] | null>;
  /** Separa 'buscou e não achou' de 'não consegui buscar' (SDK). Sem ele, a regra do vazio sem varredura não se aplica. */
  buscarComDesfecho?(indice: string, consulta: ConsultaTexto): Promise<DesfechoBusca>;
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
  aplicacoesLidas.clear();
  versaoAplicacoesLidas = '';
  vocabularios = new WeakMap();
}
let vocabularios = new WeakMap<readonly ProdutoCatalogo[], ReturnType<typeof vocabularioDe>>();
export const vocabularioMemorizado = (produtos: readonly ProdutoCatalogo[]) => {
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
  /** Fuso do tenant (ano civil das faixas abertas da aplicação); padrão America/Manaus. */
  fuso?: string;
}

const vivas = <L extends LinhaSync>(l: L[]) => l.filter((x) => !x.deleted_at);

/** RN-CORE-39: filial efetiva do cliente sobre as linhas locais de `cliente` e `filial` (Core, pull). Nulo = filiais ainda não sincronizadas. */
async function filialLocalDoCliente(leitor: LeitorLocal, clienteId: string): Promise<FilialLocalDoCliente | null> {
  const filiais = await leitor.linhas<FilialSync & LinhaSync>('filial');
  if (filiais.length === 0) return null;
  const [cliente] = leitor.linhasPorIds ? await leitor.linhasPorIds<ClienteSync & LinhaSync>('cliente', [clienteId]) : (await leitor.linhas<ClienteSync & LinhaSync>('cliente')).filter((c) => c.id === clienteId);
  return filialDoClienteLocal(cliente?.filial_id, filiais);
}

/** Filiais em que cada tabela de preço tem item vivo, memorizado por versão do sync (RN-CORE-39: base do fallback por tabela). */
function filiaisPorTabela(leitor: LeitorLocal): Promise<Map<string, Set<string>>> {
  return lembrar('filiaisPorTabela', leitor, ['tabela_preco_item'], async () => {
    const mapa = new Map<string, Set<string>>();
    for (const i of vivas(await leitor.linhas<TabelaPrecoItemSync & LinhaSync>('tabela_preco_item'))) {
      if (!i.filial_id) continue;
      const set = mapa.get(i.tabela_preco_id) ?? new Set<string>();
      set.add(i.filial_id);
      mapa.set(i.tabela_preco_id, set);
    }
    return mapa;
  });
}

/**
 * Marcas concorrentes (cadastro do próprio Catálogo, entidade `marca_concorrente`; RN-CAT-09, RN-CAT-13, ADR 0034): a lista é
 * única do tenant, com ou sem o Promotor. Antes lia a `concorrente` do Promotor, que a API deixou de enviar. Sem a entidade
 * (primeiro sync): sem nome de marca a referência não aparece, salvo pelo retrato `marca_nome`.
 */
export async function marcasConcorrentesLocais(leitor: LeitorLocal): Promise<Map<string, { nome: string; ativo: boolean }>> {
  try {
    return new Map(vivas(await leitor.linhas<{ nome: string; ativo: boolean } & LinhaSync>('marca_concorrente')).map((c) => [c.id, { nome: c.nome, ativo: c.ativo }]));
  } catch {
    return new Map();
  }
}

/** Produtos do Core enriquecidos com atributos, aplicação, referências cruzadas e campanha do Catálogo. */
export function produtosLocais(leitor: LeitorLocal, opcoes: { lerConcorrente?: boolean } = {}): Promise<ProdutoCatalogo[]> {
  const lerConcorrente = opcoes.lerConcorrente ?? true;
  // consulta do aparelho (C9): o contexto não lê o Promotor (lançaria Error); a marca da referência vai pelo retrato `marca_nome`
  const entidades = ['produto', 'produto_atributo', 'produto_conteudo', 'produto_referencia', ...(lerConcorrente ? ['marca_concorrente'] : [])];
  return lembrar(lerConcorrente ? 'produtos' : 'produtos-retrato', leitor, entidades, () => montarProdutosLocais(leitor, lerConcorrente));
}

async function montarProdutosLocais(leitor: LeitorLocal, lerConcorrente: boolean): Promise<ProdutoCatalogo[]> {
  const produtos = vivas(await leitor.linhas<ProdutoSync & LinhaSync>('produto'));
  const atributos = vivas(await leitor.linhas<ProdutoAtributoSync & LinhaSync>('produto_atributo'));
  const conteudos = vivas(await leitor.linhas<ProdutoConteudoSync & LinhaSync>('produto_conteudo'));
  const porProduto = new Map<string, ProdutoAtributoSync[]>();
  for (const a of atributos) porProduto.set(a.produto_id, [...(porProduto.get(a.produto_id) ?? []), a]);
  const campanha = new Set(conteudos.filter((c) => c.campanha).map((c) => c.produto_id));
  // catálogo grande com leitura por campo: a aplicação (até 2.000 caracteres × 20 mil) não fica na memória; entra só dos candidatos (`comAplicacao`)
  const sobDemanda = !!leitor.linhasPorCampo && produtos.length > LIMIAR_PRESELECAO_FTS;
  const aplicacoes = sobDemanda ? new Map<string, string>() : new Map(conteudos.filter((c) => c.aplicacao).map((c) => [c.produto_id, c.aplicacao!]));
  const marcas = lerConcorrente ? await marcasConcorrentesLocais(leitor) : new Map<string, { nome: string; ativo: boolean }>();
  const referencias = new Map<string, Referencia[]>();
  for (const x of vivas(await leitor.linhas<ProdutoReferenciaSync & LinhaSync>('produto_referencia')).sort((a, b) => a.ordem - b.ordem)) {
    // concorrente legível: manda (inativa/ausente esconde); vendedor sem o Promotor: retrato marca_nome; sem retrato, sem marca (RN-CAT-09)
    const nome = nomeMarcaDaReferencia(x.marca_id, x.marca_nome, marcas);
    if (nome === null) continue;
    referencias.set(x.produto_id, [...(referencias.get(x.produto_id) ?? []), { marca_id: x.marca_id, marca_nome: nome, codigo: x.codigo }]);
  }
  const montados = produtos.map((p) => ({
    id: p.id,
    sku: p.sku,
    ean: p.ean,
    nome: p.nome,
    marca: p.marca ?? '',
    categoria: p.categoria ?? '',
    unidade: p.unidade,
    ativo: p.ativo,
    atributos: (porProduto.get(p.id) ?? []).sort((a, b) => a.ordem - b.ordem).map((a) => ({ name: a.nome, value: a.valor })),
    aplicacao: aplicacoes.get(p.id) ?? '',
    referencias: referencias.get(p.id) ?? [],
    thumbnail_url: null,
    campanha: campanha.has(p.id),
    vendas: 0,
  }));
  if (sobDemanda) for (const m of montados) semAplicacaoCarregada.add(m);
  return montados;
}

/** Produtos montados sem a aplicação (catálogo grande); `comAplicacao` completa só os que o ranking vai ler. */
const semAplicacaoCarregada = new WeakSet<ProdutoCatalogo>();

/**
 * Aplicações já lidas dos candidatos (`produto_id` -> texto), válidas enquanto a versão de `produto_conteudo` não muda.
 * Teto de 800 com LRU (~2.000 caracteres cada, ~1,6 MB): a busca seguinte, que repete boa parte dos candidatos, não relê o SQLite.
 */
export const LIMITE_MEMO_APLICACOES_LIDAS = 800;
const aplicacoesLidas = new Map<string, string>();
let versaoAplicacoesLidas = '';

/** Completa a aplicação dos produtos dados (os candidatos da pré-seleção), lendo `produto_conteudo` por `produto_id`. */
export async function comAplicacao(leitor: LeitorLocal, produtos: readonly ProdutoCatalogo[]): Promise<ProdutoCatalogo[]> {
  const faltam = produtos.filter((p) => semAplicacaoCarregada.has(p));
  if (faltam.length === 0) return [...produtos];
  // a versão é lida ANTES das linhas (como em `memorizar`): sync durante a leitura = a próxima busca relê
  const versao = leitor.versaoLinhas ? String(leitor.versaoLinhas('produto_conteudo')) : null;
  if (versao === null || versao !== versaoAplicacoesLidas) {
    aplicacoesLidas.clear();
    versaoAplicacoesLidas = versao ?? '';
  }
  const aplicacoes = new Map<string, string>();
  const ids: string[] = [];
  for (const p of faltam) {
    const guardada = versao === null ? undefined : aplicacoesLidas.get(p.id);
    if (guardada === undefined) ids.push(p.id);
    else {
      aplicacoes.set(p.id, guardada);
      aplicacoesLidas.delete(p.id);
      aplicacoesLidas.set(p.id, guardada); // reinserção: o mais usado sai por último
    }
  }
  if (ids.length > 0) {
    const linhas =
      leitor.linhasPorCampo && ids.length <= MAXIMO_POR_CAMPO
        ? await leitor.linhasPorCampo<ProdutoConteudoSync & LinhaSync>('produto_conteudo', 'produto_id', ids)
        : await leitor.linhas<ProdutoConteudoSync & LinhaSync>('produto_conteudo');
    const lidas = new Map(vivas(linhas).filter((c) => c.aplicacao).map((c) => [c.produto_id, c.aplicacao!]));
    for (const id of ids) {
      const texto = lidas.get(id) ?? '';
      aplicacoes.set(id, texto);
      if (versao !== null) {
        aplicacoesLidas.set(id, texto);
        if (aplicacoesLidas.size > LIMITE_MEMO_APLICACOES_LIDAS) aplicacoesLidas.delete(aplicacoesLidas.keys().next().value!);
      }
    }
  }
  return produtos.map((p) => (semAplicacaoCarregada.has(p) ? { ...p, aplicacao: aplicacoes.get(p.id) ?? '' } : p));
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
  let filialDoCliente: FilialLocalDoCliente | null = null;
  let filialPreco: string | null = null;
  if (e.clienteId) {
    const vinculos = porCampo
      ? await leitor.linhasPorCampo!<ClienteTabelaPrecoSync & LinhaSync>('cliente_tabela_preco', 'cliente_id', [e.clienteId])
      : await leitor.linhas<ClienteTabelaPrecoSync & LinhaSync>('cliente_tabela_preco');
    const vinculo = vivas(vinculos).find((v) => v.cliente_id === e.clienteId);
    const tabelas = !vinculo ? [] : leitor.linhasPorIds ? await leitor.linhasPorIds<TabelaPrecoSync & LinhaSync>('tabela_preco', [vinculo.tabela_preco_id]) : await leitor.linhas<TabelaPrecoSync & LinhaSync>('tabela_preco');
    const tabela = vinculo ? vivas(tabelas).find((t) => t.id === vinculo.tabela_preco_id && t.ativo) : undefined;
    if (tabela) {
      tabelaClienteId = tabela.id;
      // RN-CORE-39: filial do preço (cliente, ou padrão por fallback de tabela); "a tabela tem item na filial?" vem de uma varredura
      // memorizada por versão do sync (derivado pequeno: filiais por tabela), sem reler os itens a cada busca
      filialDoCliente = await filialLocalDoCliente(leitor, e.clienteId);
      if (filialDoCliente) {
        const comItens = await filiaisPorTabela(leitor);
        filialPreco = filialDoPreco({ tabelaId: tabela.id, filialCliente: filialDoCliente.filialCliente, filialPadrao: filialDoCliente.filialPadrao, filiaisComItens: [...(comItens.get(tabela.id) ?? [])] }).filialId;
      }
      const ids = new Set(produtos.map((p) => p.id));
      const linhasPreco = porCampo
        ? await leitor.linhasPorCampo!<TabelaPrecoItemSync & LinhaSync>('tabela_preco_item', 'produto_id', [...ids])
        : await leitor.linhas<TabelaPrecoItemSync & LinhaSync>('tabela_preco_item');
      itensPreco = vivas(linhasPreco)
        .filter((i) => i.tabela_preco_id === tabela.id && ids.has(i.produto_id) && (filialPreco === null || i.filial_id === undefined || i.filial_id === filialPreco))
        .map((i) => ({ price_table_id: tabela.id, product_id: i.produto_id, price_cents: i.preco_cents, valid_from: i.vigencia_inicio, valid_to: i.vigencia_fim }));
    }
  }
  const depositos = await lembrar('depositos', leitor, ['deposito'], async () => new Map(vivas(await leitor.linhas<DepositoSync & LinhaSync>('deposito')).map((d) => [d.id, { nome: d.nome, filial: d.filial_id ?? null }])));
  // nome da filial no rótulo do estoque (RN-CORE-39); sem as filiais no aparelho, o do depósito
  const nomesFilial: Readonly<Record<string, string>> = filialDoCliente?.nomes ?? (await lembrar('nomesFilial', leitor, ['filial'], async () => Object.fromEntries(vivas(await leitor.linhas<FilialSync & LinhaSync>('filial')).map((f) => [f.id, f.nome]))));
  const saldos = new Map<string, StockByBranch[]>();
  const linhasSaldo = porCampo
    ? await leitor.linhasPorCampo!<EstoqueSaldoSync & LinhaSync>('estoque_saldo', 'produto_id', produtos.map((p) => p.id))
    : await leitor.linhas<EstoqueSaldoSync & LinhaSync>('estoque_saldo');
  for (const s of vivas(linhasSaldo)) {
    const l = saldos.get(s.produto_id) ?? [];
    const dep = depositos.get(s.deposito_id);
    // RN-CORE-39: o saldo é da FILIAL do depósito (o domain soma os depósitos da mesma filial); depósito sem filial (pull antigo) fica como estava
    l.push({ branch_id: dep?.filial ?? s.deposito_id, branch_name: (dep?.filial && nomesFilial[dep.filial]) || dep?.nome || 'Depósito', quantity: Math.trunc(s.quantidade), updated_at: s.atualizado_em });
    saldos.set(s.produto_id, l);
  }
  // o pull de estoque já vem filtrado pelas filiais da carteira (escopo do servidor, RN-CORE-39). Com cliente no contexto vale só a filial
  // dele (sem saldo nela = 0); sem cliente, todas as recebidas. A filial do cliente também vale sem tabela de preço.
  if (e.clienteId && !filialDoCliente) filialDoCliente = await filialLocalDoCliente(leitor, e.clienteId);
  return { ...base, tabelaClienteId, itensPreco, promocoes: [], saldos, filiais: filialDoCliente ? [filialDoCliente.filialCliente] : null };
}

export interface ResultadoLocal extends PaginaProdutos {
  /** Aviso discreto (sem sinal: a busca inteligente volta com a internet). */
  aviso: string | null;
  /** O FTS5 está sendo refeito: a busca varreu o catálogo; a aba mostra `AVISO_CATALOGO_ORGANIZANDO` (a C9 não mostra). */
  indexando?: boolean;
}

/** Tamanhos de prefixo tentados quando o termo inteiro não acha nada (erro de digitação perto do fim da palavra). */
const PREFIXOS_TOLERANTES = [4, 3] as const;

/** Resultado de uma consulta ao FTS5; `certo` = o aparelho garantiu que buscou (lista vazia = nada achado de fato). */
interface Consultado {
  lista: ResultadoFts[];
  certo: boolean;
}

/** Sinal de que o SDK respondeu `indexando` (o índice FTS5 está sendo refeito); a busca varre e a aba avisa (T-0088). */
export interface SinalIndexacao {
  indexando: boolean;
}

async function consultar(leitor: LeitorLocal, consulta: ConsultaTexto, sinal?: SinalIndexacao): Promise<Consultado> {
  if (leitor.buscarComDesfecho) {
    const d = await leitor.buscarComDesfecho(ID_INDICE_BUSCA, consulta);
    if (!d.buscou && d.motivo === 'indexando' && sinal) sinal.indexando = true;
    return d.buscou ? { lista: d.resultados, certo: true } : { lista: [], certo: false };
  }
  return { lista: (await leitor.buscar!(ID_INDICE_BUSCA, consulta)) ?? [], certo: false };
}

async function porPrefixo(leitor: LeitorLocal, grupo: readonly string[], sinal?: SinalIndexacao): Promise<Consultado> {
  let certo = true;
  for (const n of PREFIXOS_TOLERANTES) {
    const prefixos = [...new Set(grupo.filter((t) => t.length > n).map((t) => t.slice(0, n)))];
    if (prefixos.length === 0) continue;
    const r = await consultar(leitor, { grupos: [prefixos], prefixoNoUltimo: true, limite: CANDIDATOS_POR_TERMO }, sinal);
    certo &&= r.certo;
    if (r.lista.length > 0) return r;
  }
  return { lista: [], certo };
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
  sinal?: SinalIndexacao,
): Promise<Set<string> | null> {
  if (total <= LIMIAR_PRESELECAO_FTS || !(leitor.buscar || leitor.buscarComDesfecho)) return null;
  const grupos = expandirSinonimos(texto, sinonimos);
  if (codigo) grupos.push([codigo]);
  if (grupos.length === 0) return null;
  // 1º todos os termos juntos (AND, uma consulta só: ~25 ms contra ~36 ms por termo comum); só cai na união termo a termo
  // quando o AND traz menos que o necessário. Quem casa todos os termos já vem primeiro no ranking do domain.
  if (grupos.length > 1) {
    const juntos = await consultar(leitor, { grupos: grupos.slice(0, 8), prefixoNoUltimo: true, limite: MAXIMO_CANDIDATOS }, sinal);
    if (juntos.lista.length >= CANDIDATOS_POR_TERMO) return new Set(juntos.lista.slice(0, MAXIMO_CANDIDATOS).map((x) => x.chave));
  }
  const achados = new Map<string, { termos: number; melhor: number }>();
  let tudoCerto = true;
  for (const grupo of grupos.slice(0, 8)) {
    let r = await consultar(leitor, { grupos: [grupo], prefixoNoUltimo: true, limite: CANDIDATOS_POR_TERMO }, sinal);
    // sem acerto = provável erro de digitação (T-0052, caso lento): o prefixo do termo aproxima a tolerância do domain
    // sem cair na varredura de todo o catálogo
    tudoCerto &&= r.certo;
    if (r.lista.length === 0) r = await porPrefixo(leitor, grupo, sinal);
    tudoCerto &&= r.certo;
    r.lista.forEach((x, posicao) => {
      const a = achados.get(x.chave);
      if (a) {
        a.termos++;
        a.melhor = Math.min(a.melhor, posicao);
      } else achados.set(x.chave, { termos: 1, melhor: posicao });
    });
  }
  if (achados.size === 0) return tudoCerto && total > LIMIAR_SEM_VARREDURA ? new Set() : null;
  const ordem = [...achados.entries()].sort(([, x], [, y]) => y.termos - x.termos || x.melhor - y.melhor);
  return new Set(ordem.slice(0, MAXIMO_CANDIDATOS).map(([chave]) => chave));
}

/** Busca no aparelho (sem IA): regras locais + sinônimos + ranking do domain; com `offline`, devolve o aviso. */
export async function buscarLocal(leitor: LeitorLocal, e: EntradaLocal & { q: string; chips?: ChipsVitrine; limit: number; offset: number; offline: boolean }): Promise<ResultadoLocal> {
  const produtos = await produtosLocais(leitor);
  const sinonimos = await sinonimosLocais(leitor);
  const filtros = interpretarConsulta(e.q, vocabularioMemorizado(produtos));
  const sinal: SinalIndexacao = { indexando: false };
  const candidatos = await preselecionar(leitor, filtros.text, filtros.code?.value ?? null, sinonimos, produtos.length, sinal);
  const universo = await comAplicacao(leitor, candidatos ? produtos.filter((p) => candidatos.has(p.id)) : produtos);
  const contexto = await contextoLocal(leitor, e, universo);
  const pagina = buscarProdutos({ produtos: universo, contexto, filtros, chips: e.chips ?? {}, sinonimos, limit: e.limit, offset: e.offset, ...(e.fuso ? { fuso: e.fuso } : {}) });
  return { ...pagina, aviso: e.offline && e.q.trim() !== '' ? AVISO_BUSCA_OFFLINE : null, indexando: sinal.indexando };
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
  const achado = (await produtosLocais(leitor)).find((p) => p.id === e.produtoId && p.ativo);
  if (!achado) return null;
  const [produto] = await comAplicacao(leitor, [achado]);
  if (!produto) return null;
  const contexto = await contextoLocal(leitor, e, [produto]);
  const c = vivas(await leitor.linhas<ProdutoConteudoSync & LinhaSync>('produto_conteudo')).find((x) => x.produto_id === produto.id);
  const conteudo: ConteudoGuardado | null = c ? { description: c.descricao, selling_points: c.argumentos, faq: c.faq.map((f) => ({ question: f.pergunta, answer: f.resposta })), updated_at: c.updated_at } : null;
  // T-0085: "oferece junto" = relação complementar viva e ativa (até 5); etiquetas do conteúdo
  const relacoes = vivas(await leitor.linhas<ProdutoRelacaoSync & LinhaSync>('produto_relacao'))
    .filter((r) => r.produto_id === produto.id && r.tipo === 'complementar' && r.ativo)
    .sort((a, b) => a.ordem - b.ordem || a.id.localeCompare(b.id));
  const todos = await produtosLocais(leitor);
  const ofereceJunto = relacoes.flatMap((r) => {
    const o = todos.find((p) => p.id === r.relacionado_id && p.ativo);
    return o ? [{ produto_id: o.id, erp_code: o.sku, description: o.nome }] : [];
  });
  return montarFicha(produto, itemDaVitrine(produto, contexto), conteudo, [], { ofereceJunto, etiquetas: c?.etiquetas ?? [] });
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
