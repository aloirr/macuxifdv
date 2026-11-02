/**
 * Catálogo OFFLINE no aparelho (RF-CAT-02, T-0052): lê as linhas locais do sync (produto do Core; preço, estoque,
 * atributos, sinônimos e conteúdo do Catálogo) e roda o MESMO domain da API (vitrine, busca, ficha). Puro: recebe um
 * leitor (o motor de sync no app, um mapa nos testes); nada de React Native aqui.
 * Sem sinal a busca é textual (regras locais, sem IA) e vem com o aviso discreto `AVISO_BUSCA_OFFLINE`.
 */
import type { ConsultaTexto, LinhaSync, Perfil, ResultadoBusca as ResultadoFts } from '@macuxi/platform-sdk';
import type { ProdutoSync } from '@macuxi/core/contracts';
import type {
  ClienteTabelaPrecoSync,
  DepositoSync,
  EstoqueSaldoSync,
  FichaProduto,
  ItemTabelaPreco,
  ProdutoAtributoSync,
  ProdutoConteudoSync,
  SinonimoSync,
  StockByBranch,
  TabelaPrecoItemSync,
  TabelaPrecoSync,
} from '../../contracts';
import { montarFicha, type ConteudoGuardado } from '../../domain/conteudo';
import { interpretarConsulta } from '../../domain/consulta';
import { AVISO_BUSCA_OFFLINE } from '../../domain/ia';
import { parametrosDoTenant } from '../../domain/parametros';
import { expandirSinonimos, type SinonimoDoTenant } from '../../domain/texto';
import { podeVerPrecoEstoque } from '../../domain/visibilidade';
import { buscarProdutos, itemDaVitrine, listarVitrine, vocabularioDe, type ChipsVitrine, type ContextoVitrine, type PaginaProdutos, type ProdutoCatalogo } from '../../domain/vitrine';

/** Id do índice FTS5 do Catálogo no aparelho (`app/indice.ts`). */
export const ID_INDICE_BUSCA = 'catalogo.produto';
/** Acima disto a busca local pré-seleciona candidatos pelo FTS5 antes do ranking (abaixo, o ranking varre tudo). */
export const LIMIAR_PRESELECAO_FTS = 2000;

/** O que a busca local precisa do motor de sync (`useMotorSync().motor`). */
export interface LeitorLocal {
  linhas<L extends LinhaSync>(entidade: string): Promise<L[]>;
  buscar?(indice: string, consulta: ConsultaTexto): Promise<ResultadoFts[] | null>;
}

export interface EntradaLocal {
  perfil: Perfil | null;
  /** Parâmetros crus do Catálogo (`useParametros('catalogo')`). */
  parametros: Readonly<Record<string, unknown>>;
  agora: string;
  clienteId: string | null;
}

const vivas = <L extends LinhaSync>(l: L[]) => l.filter((x) => !x.deleted_at);

/** Produtos do Core enriquecidos com atributos e campanha do Catálogo. */
export async function produtosLocais(leitor: LeitorLocal): Promise<ProdutoCatalogo[]> {
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

export async function sinonimosLocais(leitor: LeitorLocal): Promise<SinonimoDoTenant[]> {
  return vivas(await leitor.linhas<SinonimoSync & LinhaSync>('sinonimo')).map((s) => ({ term: s.termo, synonyms: s.sinonimos, active: s.ativo }));
}

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

  let tabelaClienteId: string | null = null;
  let itensPreco: ItemTabelaPreco[] = [];
  if (e.clienteId) {
    const vinculo = vivas(await leitor.linhas<ClienteTabelaPrecoSync & LinhaSync>('cliente_tabela_preco')).find((v) => v.cliente_id === e.clienteId);
    const tabela = vinculo ? vivas(await leitor.linhas<TabelaPrecoSync & LinhaSync>('tabela_preco')).find((t) => t.id === vinculo.tabela_preco_id && t.ativo) : undefined;
    if (tabela) {
      tabelaClienteId = tabela.id;
      const ids = new Set(produtos.map((p) => p.id));
      itensPreco = vivas(await leitor.linhas<TabelaPrecoItemSync & LinhaSync>('tabela_preco_item'))
        .filter((i) => i.tabela_preco_id === tabela.id && ids.has(i.produto_id))
        .map((i) => ({ price_table_id: tabela.id, product_id: i.produto_id, price_cents: i.preco_cents, valid_from: i.vigencia_inicio, valid_to: i.vigencia_fim }));
    }
  }
  const depositos = new Map(vivas(await leitor.linhas<DepositoSync & LinhaSync>('deposito')).map((d) => [d.id, d.nome]));
  const saldos = new Map<string, StockByBranch[]>();
  for (const s of vivas(await leitor.linhas<EstoqueSaldoSync & LinhaSync>('estoque_saldo'))) {
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

/** Candidatos pelo FTS5 quando o catálogo é grande; `null` = varrer todos (catálogo pequeno ou sem índice). */
async function preselecionar(leitor: LeitorLocal, texto: string, sinonimos: readonly SinonimoDoTenant[], total: number): Promise<Set<string> | null> {
  if (total <= LIMIAR_PRESELECAO_FTS || !leitor.buscar || !texto) return null;
  const grupos = expandirSinonimos(texto, sinonimos);
  if (grupos.length === 0) return null;
  const r = await leitor.buscar(ID_INDICE_BUSCA, { grupos, prefixoNoUltimo: true, limite: 500 });
  return r && r.length > 0 ? new Set(r.map((x) => x.chave)) : null;
}

/** Busca no aparelho (sem IA): regras locais + sinônimos + ranking do domain; com `offline`, devolve o aviso. */
export async function buscarLocal(leitor: LeitorLocal, e: EntradaLocal & { q: string; chips?: ChipsVitrine; limit: number; offset: number; offline: boolean }): Promise<ResultadoLocal> {
  const produtos = await produtosLocais(leitor);
  const sinonimos = await sinonimosLocais(leitor);
  const filtros = interpretarConsulta(e.q, vocabularioDe(produtos));
  const candidatos = await preselecionar(leitor, filtros.text, sinonimos, produtos.length);
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
  const v = vocabularioDe(await produtosLocais(leitor));
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
