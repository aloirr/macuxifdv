/**
 * Rotas do Catálogo (`/v1/catalogo`, T-0052). O `createApp` confere antes de cada rota: licença do módulo
 * (403 MODULO_INATIVO), ação do manifesto por perfil (403 PERFIL_SEM_ACESSO, RN-CAT-04) e a entrada (Zod, 400). O cliente
 * em contexto é opcional: o escopo de carteira (RN-CORE-04) é conferido aqui (`filtrar_no_dominio`). Regra de negócio só
 * no domain; aqui entram I/O, IA e log (sem o texto da busca nem dado pessoal).
 *
 * GET  busca                      produto.consultar   busca inteligente (LLM) com contingência textual e aviso (RF-CAT-01/02, RN-CAT-03)
 * GET  produtos                   produto.consultar   vitrine paginada com chips (RF-CAT-01)
 * GET  produtos/:id               produto.consultar   ficha rica (RF-CAT-03)
 * GET  filtros                    produto.consultar   marcas e categorias do tenant (chips)
 * GET  tabelas-preco, tabelas-preco/:id/precos, escalonada; PUT/DELETE escalonada/:id   tabela_preco.gerenciar  (T-0089, RN-VEN-23)
 * GET  sinonimos                  sinonimo.gerenciar  (RF-CAT-07)
 * PUT  sinonimos/:id              sinonimo.gerenciar  idempotente pelo id
 * DELETE sinonimos/:id            sinonimo.gerenciar
 * PUT  produtos/:id/destaque      destaque.gerenciar
 * PUT  produtos/:id/conteudo      produto.enriquecer
 * PUT  produtos/:id/foto-principal produto.enriquecer  registra o arquivo e define a foto principal; os bytes vão por PUT /v1/arquivos/:id (T-0097)
 * GET  marcas-concorrentes        produto.enriquecer  marcas ativas do Catálogo para o seletor da referência cruzada
 * GET  marcas                     produto.consultar   cadastro de marcas com a contagem de referências (RN-CAT-13, ADR 0034)
 * POST marcas, PUT marcas/:id     marca.gerenciar     cria/edita/inativa/reativa; evento catalogo.marca_concorrente.alterada@1
 * PUT  produtos/:id/cadastro-catalogo produto.enriquecer  aplicação, referências, oferece junto e etiquetas (RN-CAT-09, RN-CAT-11)
 * GET  hierarquia               produto.consultar    nível atual da hierarquia sistema › grupo › linha com a contagem de produtos ativos (RF-CAT-09, T-0142)
 * GET  exportacao               produto.enriquecer  cadastro do catálogo para PDF/Excel do BKO, página única até 20 mil (RF-CAT-09)
 * GET  termos-sem-resultado       busca.ver_sem_resultado
 */
import { CODIGOS_FILIAL_USUARIO, MENSAGEM_USUARIO_SEM_FILIAL } from '@macuxi/core/contracts';
import {
  ErroHttpModulo,
  ErroNaoEncontrado,
  ErroRegraNegocio,
  verificarCarteira,
  type ClienteBanco,
  type ContextoBase,
  type ContextoRota,
  type RotaModulo,
  type TransacaoTenant,
} from '@macuxi/platform-sdk';
import {
  ConsultaBuscaQuery,
  ConsultaFichaQuery,
  ConsultaHierarquiaQuery,
  ConsultaTermosQuery,
  ConsultaVitrineQuery,
  ParamsProduto,
  ParamsMarca,
  MarcaAlterarSchema,
  MarcaCriarSchema,
  MarcaListaQuerySchema,
  EVENTO_MARCA_CONCORRENTE_ALTERADA,
  type MarcaAlterar,
  type MarcaCriar,
  type MarcaListaQuery,
  type MarcaListaSaida,
  ParamsSinonimo,
  ROTAS_CATALOGO,
  SalvarCadastroCatalogo,
  SalvarConteudo,
  ConsultaEscalonadaQuery,
  ConsultaPrecosTabelaQuery,
  ConsultaTabelasPrecoQuery,
  ParamsFaixa,
  ParamsTabelaPreco,
  SalvarDestaque,
  SalvarFotoPrincipal,
  SalvarFaixa,
  SalvarSinonimo,
  type FaixaCadastrada,
  type ListaTabelasPreco,
  type PaginaEscalonada,
  type PaginaPrecosTabela,
  type FichaProduto,
  type FiltrosCatalogo,
  type FiltrosInterpretados,
  type ListaMarcasConcorrentes,
  type ListaSinonimos,
  type ListaTermosSemResultado,
  type PaginaVitrine,
  type RespostaBusca,
  type RespostaEscrita,
  type RespostaExportacao,
  type RespostaHierarquia,
} from '../contracts';
import { validarCadastroCatalogo } from '../domain/cadastro-catalogo';
import { fatoDaEscritaMarca, filtrarMarcas, nomeMarcaIgual, validarNomeMarca } from '../domain/marcas-cadastro';
import { resolverCodigosOfereceJunto, validarMarcasDaReferencia } from '../domain/marcas';
import { montarExportacao } from '../domain/exportacao';
import { montarArvore, produtosDoNo } from '../domain/arvore';
import { idsAtivos, navegarHierarquia } from '../domain/hierarquia';
import { filialDaTelaDePreco } from '../domain/preco-filial';
import { textoPareceCodigo } from '../domain/codigo-busca';
import { conflitoDeFaixa, dataCivilNoFuso, faixaMaisCaraQueATabela, faixaVigente, validarFaixa } from '../domain/escalonada';
import { conflitoDeSinonimo, montarFicha, normalizarSinonimo, termoDeBusca } from '../domain/conteudo';
import { interpretarConsulta, type VocabularioTenant } from '../domain/consulta';
import { AVISO_BUSCA_FALHOU, type PortaInterpretacaoLlm } from '../domain/ia';
import { diaDoTenant, verificarConsultaIa } from '../domain/limite-ia';
import { parametrosDoTenant, timeoutIaDoTenant, type ParametrosCatalogo } from '../domain/parametros';
import { chaveDeTermo, type SinonimoDoTenant } from '../domain/texto';
import { filiaisDaFolha, filiaisDoEstoque, type FiltroFilial } from '../domain/estoque-campo';
import { podeVerPrecoEstoque } from '../domain/visibilidade';
import { candidatosDaBusca, cortarCandidatos, TETO_CANDIDATOS } from '../domain/indice-busca';
import { buscarProdutos, itemDaVitrine, listarVitrine, vocabularioDe, type ContextoVitrine, type ProdutoCatalogo } from '../domain/vitrine';
import { interpretarComMedicao } from './ia/buscar';
import type { FabricaRepositorio, RepositorioCatalogo } from './repositorio';

export interface DependenciasRotas {
  repositorio: FabricaRepositorio;
  /** Porta do LLM da busca para o tempo limite dado (ms); `null` = sem provedor configurado (busca por regras, sem aviso). */
  portaIa?: (timeoutMs: number) => PortaInterpretacaoLlm | null;
  /**
   * Chamado DEPOIS da transação de uma gravação do Catálogo (commit ou falha) com o tenant: o repositório descarta o retrato do
   * catálogo ali. O descarte de antes do commit não basta: uma busca no meio recarregaria o dado velho e o guardaria por 60 s.
   */
  aposGravar?: (tenantId: string) => void;
}

/** T-0119: o vocabulário (marcas e categorias de 20 mil produtos) sai uma vez por retrato do catálogo, não por busca. */
const VOCABULARIOS = new WeakMap<readonly ProdutoCatalogo[], ReturnType<typeof vocabularioDe>>();
function vocabularioEmCache(produtos: readonly ProdutoCatalogo[]): ReturnType<typeof vocabularioDe> {
  let v = VOCABULARIOS.get(produtos);
  if (!v) {
    v = vocabularioDe(produtos);
    VOCABULARIOS.set(produtos, v);
  }
  return v;
}

type Ctx<C = unknown, Q = unknown, P = unknown> = ContextoRota<C, Q, P>;

/** RN-CORE-39: filial dos preços na tela do BKO (a pedida ou a padrão); filial que não é do tenant dá 422. */
async function filialDaTela(repo: RepositorioCatalogo, pedida: string | undefined) {
  const { padraoId, filiais } = await repo.filiaisDaTela();
  const r = filialDaTelaDePreco(pedida, padraoId, filiais.map((f) => f.id));
  if (!r.ok) throw new ErroHttpModulo(422, 'FILIAL_INEXISTENTE', 'Essa filial não existe neste tenant. Escolha outra na lista de filiais.');
  return { filialId: r.filialId, filiais };
}

/** RN-CORE-04: cliente em contexto precisa estar na carteira (403 FORA_DA_CARTEIRA, como o `createApp`). */
async function conferirCliente(ctx: ContextoBase, clienteId: string | undefined): Promise<string | null> {
  if (!clienteId) return null;
  const r = verificarCarteira(clienteId, await ctx.carteira());
  if (!r.ok) throw new ErroHttpModulo(403, r.codigo, r.mensagem);
  return clienteId;
}

/** Filial da busca sem cliente: a que vale para o preço (a escolhida ou a padrão) e a escolhida de fato (nula = padrão, estoque da carteira). */
interface FilialDaBuscaSemCliente {
  filialId: string;
  escolhida: string | null;
  /** Filtro de estoque da tela (catalogo-campo-v2 §3): uma filial, `todas` ou nenhum (o padrão do perfil). */
  filtro: FiltroFilial;
}

/**
 * RN-VEN-01: sem cliente, a busca usa a filial padrão do tenant (ou a pedida em `filial`), como o app pelo menu. Revalida tenant (filial do
 * core.filiais@1) e escopo (filiais da carteira). Com cliente em contexto a filial é a dele e `filial` é ignorada.
 */
async function filialDaBusca(ctx: ContextoBase, repo: RepositorioCatalogo, clienteId: string | null, pedida: string | undefined): Promise<FilialDaBuscaSemCliente | null> {
  if (clienteId !== null) return null;
  if (pedida === 'todas') return { filialId: (await filialDaTela(repo, undefined)).filialId, escolhida: null, filtro: 'todas' };
  const { filialId } = await filialDaTela(repo, pedida);
  // RN-CAT-05 / RN-CORE-39: todo perfil vê estoque só das filiais de VENDA dele (core.filiais_do_usuario@1)
  if (pedida && !(await repo.filiaisDeVenda()).filiaisVenda.includes(pedida)) throw new ErroHttpModulo(403, 'FILIAL_FORA_DAS_SUAS', 'Você não tem acesso a essa filial. Escolha uma das suas filiais.');
  return { filialId, escolhida: pedida ?? null, filtro: pedida ?? null };
}

/**
 * catalogo-campo-v2 §3 e §4: filiais do N (`filiais`) e da folha "Estoque por filial" (`filiaisFolha`). O N vem de `filiaisDoEstoque`
 * (domain) e a folha de `filiaisDaFolha`; ambas partem das filiais de VENDA do usuário (RN-CORE-39), para todo perfil.
 * `sem_filial`: como no Core (RN-CORE-39), vale para QUALQUER perfil, admin e analista inclusive (eles se destravam em
 * `PUT /v1/core/eu/filial-cadastro`): a API recusa com 403 USUARIO_SEM_FILIAL e nada de preço ou estoque sai.
 */
async function filiaisDoEstoqueDoUsuario(repo: RepositorioCatalogo, clienteId: string | null, filial: FilialDaBuscaSemCliente | null): Promise<{ filiais: readonly string[]; filiaisFolha: readonly string[] }> {
  const venda = await repo.filiaisDeVenda();
  if (venda.semFilial) throw new ErroHttpModulo(403, CODIGOS_FILIAL_USUARIO.semFilial, MENSAGEM_USUARIO_SEM_FILIAL);
  const filialDoCliente = clienteId !== null ? await repo.filialDoCliente(clienteId) : null;
  return { filiais: filiaisDoEstoque(venda, { filialDoCliente, filtro: filial?.filtro ?? null }), filiaisFolha: filiaisDaFolha(venda) };
}

/** Monta o contexto de preço/estoque do usuário. RN-CAT-05: para quem não vê, nada de preço/estoque é lido do banco. */
async function contextoVitrine(ctx: ContextoBase, repo: RepositorioCatalogo, p: ParametrosCatalogo, clienteId: string | null, produtos: readonly ProdutoCatalogo[], soEstoque = false, filial: FilialDaBuscaSemCliente | null = null): Promise<ContextoVitrine> {
  const base = { perfil: ctx.usuario.perfil, parametros: p, agora: ctx.agora().toISOString(), clienteId };
  const ids = produtos.filter((x) => x.ativo).map((x) => x.id);
  const { filiais, filiaisFolha } = await filiaisDoEstoqueDoUsuario(repo, clienteId, filial);
  const saldos = await repo.saldos(ids);
  // T-0119: o corte dos candidatos só precisa do estoque (a nota da busca não usa o preço)
  if (soEstoque) return { ...base, tabelaClienteId: null, itensPreco: [], promocoes: [], saldos, filiais, filiaisFolha };
  // RN-CAT-05 (revista): promotor sem `promotor_ve_preco_estoque` recebe o estoque, nunca o preço (nada de preço é lido do banco)
  if (!podeVerPrecoEstoque(ctx.usuario.perfil, p)) return { ...base, tabelaClienteId: null, itensPreco: [], promocoes: [], saldos, filiais, filiaisFolha };
  const precos = await repo.precos(clienteId, ids, filial?.filialId ?? null);
  const promocoes = await repo.promocoes(ids);
  return { ...base, tabelaClienteId: precos.tabelaClienteId, itensPreco: precos.itens, promocoes, saldos, filiais, filiaisFolha };
}

interface Interpretacao {
  filtros: FiltrosInterpretados;
  interpreted_by: RespostaBusca['interpreted_by'];
  degraded: boolean;
  notice: string | null;
  remaining_ai_queries: number | null;
}

/**
 * Ordem da RN-CAT-03 (docs/modulos/catalogo/ia.md): `verificarConsultaIa` (não consome) → provedor FORA da transação
 * (até `ia_timeout_ms`; a conexão do banco não fica presa) → débito atômico só se respondeu.
 */
async function interpretar(ctx: ContextoBase, dep: DependenciasRotas, q: ConsultaBuscaQuery, semIa: boolean, vocab: VocabularioTenant, p: ParametrosCatalogo, uso: Awaited<ReturnType<RepositorioCatalogo['usoIa']>>, dia: string): Promise<Interpretacao> {
  // RN-CAT-03: texto que parece código vai direto à busca exata/FTS: sem IA, sem cota gasta e sem aviso de indisponível
  // modo básico = 'nenhum'; código = as mesmas regras da busca sem provedor de IA ('regras')
  if (semIa) return { filtros: interpretarConsulta(q.q, vocab), interpreted_by: q.mode === 'basica' ? 'nenhum' : 'regras', degraded: false, notice: null, remaining_ai_queries: null };
  const timeoutMs = timeoutIaDoTenant(ctx.parametros());
  const porta = dep.portaIa?.(timeoutMs) ?? null;
  let ia: { permitido: boolean; mensagem: string | null } = { permitido: porta !== null, mensagem: null };
  let restantes: number | null = null;
  if (porta) {
    if (uso === 'indisponivel') ia = { permitido: false, mensagem: AVISO_BUSCA_FALHOU };
    else {
      const v = verificarConsultaIa(uso, ctx.agora().toISOString(), ctx.fuso(), p);
      ia = { permitido: v.permitido, mensagem: v.mensagem };
      restantes = v.restantes;
    }
  }
  const r = await interpretarComMedicao({
    tenant_id: ctx.usuario.tenant_id,
    texto: q.q,
    vocabulario: vocab,
    porta,
    online: true,
    ia,
    log: ctx.log,
    timeoutMs,
    debitarCota: async () => {
      const ok = await ctx.comTenant((db, tx) => dep.repositorio(ctx, db, tx).debitarIa(dia, p.limite_consultas_ia_dia));
      if (!ok) ctx.log.warn({ evento: 'catalogo.ia.limite_na_corrida', tenant_id: ctx.usuario.tenant_id }, 'Cota de IA esgotada por consultas simultâneas.');
    },
  });
  if (restantes !== null && r.cotaDebitada) restantes = Math.max(0, restantes - 1);
  return { filtros: r.filtros, interpreted_by: r.resumo.interpreted_by, degraded: r.resumo.degraded, notice: r.resumo.notice, remaining_ai_queries: restantes };
}

export function criarRotasCatalogo(dep: DependenciasRotas): RotaModulo[] {
  /** Gravação que muda o cadastro do retrato (T-0119): descarta o retrato do tenant também DEPOIS do commit. */
  const comTenantGravando = async <T>(ctx: ContextoBase, fn: (db: ClienteBanco, tx: TransacaoTenant) => Promise<T>): Promise<T> => {
    try {
      return await ctx.comTenant(fn);
    } finally {
      dep.aposGravar?.(ctx.usuario.tenant_id);
    }
  };
  /** Produtos ativos do nível `no` e dos abaixo dele (RF-CAT-09); nível que não existe mais = todos. */
  const produtosDoNivel = async (repo: RepositorioCatalogo, produtos: ProdutoCatalogo[], no: string) => {
    const { nos, vinculos } = await repo.dadosExportacao();
    const ativos = idsAtivos(produtos);
    const arvore = montarArvore(nos);
    const r = navegarHierarquia(arvore, vinculos, ativos, no);
    // chegou nos produtos (inclusive "Outros produtos" e "Sem classificação"): os do nível; no meio da hierarquia, o nível inteiro
    const ids = r.tipo === 'produtos' ? new Set(r.produtoIds) : arvore.nos.has(no) ? produtosDoNo(arvore, vinculos, no) : ativos;
    return produtos.filter((p) => ids.has(p.id) && ativos.has(p.id));
  };
  const comRepo = <T>(ctx: ContextoBase, fn: (repo: RepositorioCatalogo) => Promise<T>) => ctx.comTenant((db, tx) => fn(dep.repositorio(ctx, db, tx)));

  const busca: RotaModulo = {
    metodo: 'GET',
    caminho: ROTAS_CATALOGO.busca,
    acao: 'produto.consultar',
    carteira: 'filtrar_no_dominio',
    query: ConsultaBuscaQuery,
    async executar(ctx: Ctx<unknown, ConsultaBuscaQuery>): Promise<RespostaBusca> {
      const q = ctx.query;
      const p = parametrosDoTenant(ctx.parametros());
      const clienteId = await conferirCliente(ctx, q.customer_id);
      // RN-CAT-03: modo básico e texto de código não usam IA (nem leem a cota)
      const semIa = q.mode === 'basica' || textoPareceCodigo(q.q);
      const dia = diaDoTenant(ctx.agora(), ctx.fuso());
      // 1) leitura curta: produtos, sinônimos e uso de IA do dia
      const leitura = await comRepo(ctx, async (repo) => ({ produtos: await (repo.produtosEmCache?.() ?? repo.produtos()), sinonimos: await repo.sinonimos(), uso: semIa ? null : await repo.usoIa(dia) }));
      const vocab = vocabularioEmCache(leitura.produtos);
      // 2) interpretação (provedor fora da transação)
      const interp = await interpretar(ctx, dep, q, semIa, vocab, p, leitura.uso, dia);
      // 3) preço/estoque do usuário, ranking e registro da busca (RF-CAT-07)
      return comRepo(ctx, async (repo) => {
        const filial = await filialDaBusca(ctx, repo, clienteId, q.filial);
        const sinonimos: readonly SinonimoDoTenant[] = leitura.sinonimos;
        const chips = { line: q.line, brand: q.brand, only_in_stock: q.only_in_stock };
        // T-0119 (D-T0107b): com catálogo grande o índice separa os candidatos; preço e estoque são lidos só deles
        let candidatos = candidatosDaBusca({ produtos: leitura.produtos, contexto: { perfil: ctx.usuario.perfil, parametros: p, agora: ctx.agora().toISOString() }, filtros: interp.filtros, chips, sinonimos });
        // teto de candidatos antes do ranking completo (só o estoque é lido para todos; o preço, só para os que ficam)
        if (candidatos && candidatos.produtos.length > TETO_CANDIDATOS) candidatos = cortarCandidatos(candidatos, await contextoVitrine(ctx, repo, p, clienteId, candidatos.produtos, true, filial));
        const produtosDaBusca = candidatos?.produtos ?? leitura.produtos;
        const contexto = await contextoVitrine(ctx, repo, p, clienteId, produtosDaBusca, false, filial);
        const pagina = buscarProdutos({ produtos: produtosDaBusca, contexto, filtros: interp.filtros, chips, sinonimos, limit: q.limit, offset: q.offset, ...(candidatos ? { maxVendas: candidatos.maxVendas } : {}) });
        const termo = termoDeBusca(q.q);
        if (termo && q.offset === 0) {
          // melhor esforço (T-0052 🟢7): falha no registro não derruba a busca; o log não leva o termo (dado do usuário)
          try {
            await repo.registrarBusca({ termo, resultados: pagina.total, em: ctx.agora().toISOString(), interpretado_por: interp.interpreted_by });
          } catch {
            ctx.log.warn({ evento: 'catalogo.busca_log_falhou' }, 'Registro da busca não gravado.');
          }
        }
        ctx.log.info({ evento: 'catalogo.busca', resultados: pagina.total, interpretado_por: interp.interpreted_by, degradada: interp.degraded, com_cliente: clienteId !== null }, 'Busca do catálogo.');
        return { ...pagina, filters: { ...interp.filtros, measures: [...interp.filtros.measures] }, interpreted_by: interp.interpreted_by, degraded: interp.degraded, notice: interp.notice, from_cache: false, remaining_ai_queries: interp.remaining_ai_queries };
      });
    },
  };

  const vitrine: RotaModulo = {
    metodo: 'GET',
    caminho: ROTAS_CATALOGO.produtos,
    acao: 'produto.consultar',
    carteira: 'filtrar_no_dominio',
    query: ConsultaVitrineQuery,
    async executar(ctx: Ctx<unknown, ConsultaVitrineQuery>): Promise<PaginaVitrine> {
      const q = ctx.query;
      const p = parametrosDoTenant(ctx.parametros());
      const clienteId = await conferirCliente(ctx, q.customer_id);
      return comRepo(ctx, async (repo) => {
        const todos = await repo.produtos();
        const produtos = q.no ? await produtosDoNivel(repo, todos, q.no) : todos;
        const contexto = await contextoVitrine(ctx, repo, p, clienteId, produtos);
        return listarVitrine({ produtos, contexto, chips: { line: q.line, brand: q.brand, only_in_stock: q.only_in_stock, campaign: q.campaign }, sinonimos: [], limit: q.limit, offset: q.offset });
      });
    },
  };

  // T-0142 / RF-CAT-09: a hierarquia do app, do mesmo domain; a contagem é de produtos ativos (sem filtro de estoque)
  const hierarquia: RotaModulo = {
    metodo: 'GET',
    caminho: ROTAS_CATALOGO.hierarquia,
    acao: 'produto.consultar',
    carteira: 'filtrar_no_dominio',
    query: ConsultaHierarquiaQuery,
    async executar(ctx: Ctx<unknown, ConsultaHierarquiaQuery>): Promise<RespostaHierarquia> {
      return comRepo(ctx, async (repo) => {
        const [produtos, { nos, vinculos }] = await Promise.all([repo.produtos(), repo.dadosExportacao()]);
        const r = navegarHierarquia(nos, vinculos, idsAtivos(produtos), ctx.query.no ?? null);
        const base = { sem_hierarquia: r.tipo === 'produtos' && r.semHierarquia, trilha: r.caminho, raiz_tocavel: r.raizTocavel };
        if (r.tipo === 'produtos') return { tipo: 'produtos', ...base, rotulo_plural: '', niveis: [], no: r.noId, total_produtos: r.produtoIds.length };
        return { tipo: 'niveis', ...base, rotulo_plural: r.rotuloPlural, niveis: r.niveis.map((n) => ({ id: n.id, codigo: n.codigo, nome: n.nome, total: n.total })), no: null, total_produtos: r.total };
      });
    },
  };

  const ficha: RotaModulo = {
    metodo: 'GET',
    caminho: ROTAS_CATALOGO.produto,
    acao: 'produto.consultar',
    carteira: 'filtrar_no_dominio',
    params: ParamsProduto,
    query: ConsultaFichaQuery,
    async executar(ctx: Ctx<unknown, ConsultaFichaQuery, ParamsProduto>): Promise<FichaProduto> {
      const p = parametrosDoTenant(ctx.parametros());
      const clienteId = await conferirCliente(ctx, ctx.query.customer_id);
      return comRepo(ctx, async (repo) => {
        const produto = await repo.produto(ctx.params.id);
        // RN-CAT-01: produto de outro tenant (RLS) ou inativo = 404 sem dizer se existe
        if (!produto || !produto.ativo) throw new ErroNaoEncontrado('PRODUTO_NAO_ENCONTRADO', 'Produto não encontrado no catálogo.');
        const contexto = await contextoVitrine(ctx, repo, p, clienteId, [produto]);
        const { conteudo, midias } = await repo.conteudo(produto.id);
        const extras = await repo.extrasFicha(produto.id);
        return montarFicha(produto, itemDaVitrine(produto, contexto), conteudo, midias, { ofereceJunto: extras.ofereceJunto, etiquetas: extras.etiquetas });
      });
    },
  };

  const filtros: RotaModulo = {
    metodo: 'GET',
    caminho: ROTAS_CATALOGO.filtros,
    acao: 'produto.consultar',
    carteira: 'nao_se_aplica',
    async executar(ctx: Ctx): Promise<FiltrosCatalogo> {
      const v = vocabularioDe(await comRepo(ctx, (repo) => repo.produtos()));
      return { brands: [...v.marcas], lines: [...v.linhas] };
    },
  };

  // ---------- BKO (RN-CAT-04: analista e admin) ----------
  const listarSinonimos: RotaModulo = {
    metodo: 'GET',
    caminho: ROTAS_CATALOGO.sinonimos,
    acao: 'sinonimo.gerenciar',
    carteira: 'nao_se_aplica',
    async executar(ctx: Ctx): Promise<ListaSinonimos> {
      const items = await comRepo(ctx, (repo) => repo.sinonimos());
      return { items: items.sort((a, b) => a.term.localeCompare(b.term, 'pt-BR') || a.id.localeCompare(b.id)) };
    },
  };

  const salvarSinonimo: RotaModulo = {
    metodo: 'PUT',
    caminho: ROTAS_CATALOGO.sinonimo,
    acao: 'sinonimo.gerenciar',
    carteira: 'nao_se_aplica',
    params: ParamsSinonimo,
    corpo: SalvarSinonimo,
    async executar(ctx: Ctx<SalvarSinonimo, unknown, ParamsSinonimo>): Promise<RespostaEscrita> {
      const n = normalizarSinonimo(ctx.corpo);
      if (!n.ok) throw new ErroRegraNegocio(n.codigo, n.mensagem);
      return ctx.comTenant(async (db, tx) => {
        const repo = dep.repositorio(ctx, db, tx);
        const conflito = conflitoDeSinonimo(ctx.params.id, n.valor, await repo.sinonimos());
        if (conflito) throw new ErroHttpModulo(409, 'SINONIMO_EM_CONFLITO', conflito);
        const { criado } = await repo.salvarSinonimo(ctx.params.id, n.valor);
        await tx.auditar({ acao: 'sinonimo.gerenciar', entidade: 'sinonimo', entidade_id: ctx.params.id, depois: { term: n.valor.term, synonyms: n.valor.synonyms, active: n.valor.active } });
        return { id: ctx.params.id, criado };
      });
    },
  };

  const removerSinonimo: RotaModulo = {
    metodo: 'DELETE',
    caminho: ROTAS_CATALOGO.sinonimo,
    acao: 'sinonimo.gerenciar',
    carteira: 'nao_se_aplica',
    params: ParamsSinonimo,
    status: 204,
    async executar(ctx: Ctx<unknown, unknown, ParamsSinonimo>): Promise<void> {
      await ctx.comTenant(async (db, tx) => {
        // idempotente: remover o que já não existe também é 204
        if (await dep.repositorio(ctx, db, tx).removerSinonimo(ctx.params.id)) await tx.auditar({ acao: 'sinonimo.gerenciar', entidade: 'sinonimo', entidade_id: ctx.params.id, antes: { id: ctx.params.id } });
      });
    },
  };

  const destaque: RotaModulo = {
    metodo: 'PUT',
    caminho: ROTAS_CATALOGO.destaque,
    acao: 'destaque.gerenciar',
    carteira: 'nao_se_aplica',
    params: ParamsProduto,
    corpo: SalvarDestaque,
    async executar(ctx: Ctx<SalvarDestaque, unknown, ParamsProduto>): Promise<RespostaEscrita> {
      return comTenantGravando(ctx, async (db, tx) => {
        const repo = dep.repositorio(ctx, db, tx);
        const produto = await repo.produto(ctx.params.id);
        if (!produto) throw new ErroNaoEncontrado('PRODUTO_NAO_ENCONTRADO', 'Produto não encontrado no catálogo.');
        await repo.marcarDestaque(produto.id, ctx.corpo.is_campaign);
        await tx.auditar({ acao: 'destaque.gerenciar', entidade: 'produto', entidade_id: produto.id, antes: { is_campaign: produto.campanha }, depois: { is_campaign: ctx.corpo.is_campaign } });
        return { id: produto.id, criado: false };
      });
    },
  };

  const fotoPrincipal: RotaModulo = {
    metodo: 'PUT',
    caminho: ROTAS_CATALOGO.fotoPrincipal,
    acao: 'produto.enriquecer',
    carteira: 'nao_se_aplica',
    params: ParamsProduto,
    corpo: SalvarFotoPrincipal,
    async executar(ctx: Ctx<SalvarFotoPrincipal, unknown, ParamsProduto>): Promise<RespostaEscrita> {
      return comTenantGravando(ctx, async (db, tx) => {
        const repo = dep.repositorio(ctx, db, tx);
        const produto = await repo.produto(ctx.params.id);
        if (!produto) throw new ErroNaoEncontrado('PRODUTO_NAO_ENCONTRADO', 'Produto não encontrado no catálogo.');
        const { arquivo_id: arquivoId, titulo } = ctx.corpo;
        // a foto é do produto (vale para o tenant inteiro), não de um cliente: cliente_id nulo
        await tx.registrarArquivo({ id: arquivoId, finalidade: 'foto_produto', entidade: 'produto', entidade_id: produto.id, cliente_id: null });
        const r = await repo.definirFotoPrincipal(produto.id, arquivoId, titulo);
        if (r.alterou) await tx.auditar({ acao: 'produto.enriquecer', entidade: 'produto', entidade_id: produto.id, antes: null, depois: { foto_principal: arquivoId } });
        return { id: produto.id, criado: r.alterou };
      });
    },
  };

  const conteudo: RotaModulo = {
    metodo: 'PUT',
    caminho: ROTAS_CATALOGO.conteudo,
    acao: 'produto.enriquecer',
    carteira: 'nao_se_aplica',
    params: ParamsProduto,
    corpo: SalvarConteudo,
    async executar(ctx: Ctx<SalvarConteudo, unknown, ParamsProduto>): Promise<RespostaEscrita> {
      return comTenantGravando(ctx, async (db, tx) => {
        const repo = dep.repositorio(ctx, db, tx);
        const produto = await repo.produto(ctx.params.id);
        if (!produto) throw new ErroNaoEncontrado('PRODUTO_NAO_ENCONTRADO', 'Produto não encontrado no catálogo.');
        const maxAplicacao = parametrosDoTenant(ctx.parametros()).aplicacao_max_cadastro;
        if (ctx.corpo.aplicacao && ctx.corpo.aplicacao.length > maxAplicacao) {
          throw new ErroRegraNegocio('RN-CAT-11', `A aplicação passa de ${maxAplicacao} caracteres. Encurte o texto e salve de novo.`, { campo: 'aplicacao' });
        }
        const { criado } = await repo.salvarConteudo(produto.id, ctx.corpo, ctx.agora().toISOString());
        await tx.auditar({ acao: 'produto.enriquecer', entidade: 'produto', entidade_id: produto.id, depois: { atributos: ctx.corpo.attributes.length, argumentos: ctx.corpo.selling_points.length, faq: ctx.corpo.faq.length } });
        return { id: produto.id, criado };
      });
    },
  };

  // T-0085 K9: o conjunto inteiro (aplicação, referências, oferece junto, etiquetas); a API revalida com a mesma função do BKO
  const cadastroCatalogo: RotaModulo = {
    metodo: 'PUT',
    caminho: ROTAS_CATALOGO.cadastroCatalogo,
    acao: 'produto.enriquecer',
    carteira: 'nao_se_aplica',
    params: ParamsProduto,
    corpo: SalvarCadastroCatalogo,
    async executar(ctx: Ctx<SalvarCadastroCatalogo, unknown, ParamsProduto>): Promise<RespostaEscrita> {
      return comTenantGravando(ctx, async (db, tx) => {
        const repo = dep.repositorio(ctx, db, tx);
        const produto = await repo.produto(ctx.params.id);
        if (!produto) throw new ErroNaoEncontrado('PRODUTO_NAO_ENCONTRADO', 'Produto não encontrado no catálogo.');
        const corpo: SalvarCadastroCatalogo = { ...ctx.corpo, aplicacao: ctx.corpo.aplicacao?.trim() ? ctx.corpo.aplicacao.trim() : null };
        const erros = validarCadastroCatalogo(produto.id, corpo, { aplicacaoMax: parametrosDoTenant(ctx.parametros()).aplicacao_max_cadastro });
        if (erros.length > 0) {
          const e = erros[0]!;
          throw new ErroRegraNegocio(e.regra, e.mensagem, { campo: e.campo });
        }
        // marcas concorrentes do Catálogo (RN-CAT-13, ADR 0034): marca desconhecida ou inativa é 422 RN-CAT-09 com mensagem clara
        const errosMarca = validarMarcasDaReferencia(corpo.referencias ?? [], await repo.marcasConcorrentes());
        if (errosMarca.length > 0) throw new ErroRegraNegocio(errosMarca[0]!.regra, errosMarca[0]!.mensagem, { campo: errosMarca[0]!.campo });
        // "Oferece junto" digitado por código fora da página do BKO: resolve aqui, sem diferenciar maiúsculas
        const codigos = (corpo.oferece_junto_codigos ?? []).map((c) => c.trim()).filter((c) => c !== '');
        if (codigos.length > 0) {
          const achados = resolverCodigosOfereceJunto(codigos, await repo.produtos());
          if (achados.naoEncontrados.length > 0) throw new ErroRegraNegocio('RN-CAT-09', `Oferece junto: o código "${achados.naoEncontrados[0]}" não existe ou está inativo. Confira o código e tente de novo.`, { campo: 'oferece_junto' });
          corpo.oferece_junto = [...new Set([...corpo.oferece_junto, ...achados.ids])];
          const apos = validarCadastroCatalogo(produto.id, { ...corpo, oferece_junto_codigos: [] }, { aplicacaoMax: parametrosDoTenant(ctx.parametros()).aplicacao_max_cadastro });
          if (apos.length > 0) throw new ErroRegraNegocio(apos[0]!.regra, apos[0]!.mensagem, { campo: apos[0]!.campo });
        }
        delete corpo.oferece_junto_codigos;
        for (const id of corpo.oferece_junto) {
          const outro = await repo.produto(id);
          if (!outro || !outro.ativo) throw new ErroRegraNegocio('RN-CAT-09', 'Um produto de "Oferece junto" não existe ou está inativo. Tire-o da lista e salve de novo.', { campo: 'oferece_junto' });
        }
        const extras = await repo.extrasFicha(produto.id);
        const antes = { aplicacao_tamanho: (produto.aplicacao ?? '').length, referencias: (produto.referencias ?? []).map((r) => ({ marca_id: r.marca_id, codigo: r.codigo })), oferece_junto: extras.ofereceJunto.map((o) => o.produto_id), etiquetas: extras.etiquetas };
        const { criado } = await repo.salvarCadastroCatalogo(produto.id, corpo, ctx.agora().toISOString());
        // auditoria sem dado pessoal: tamanhos, marcas e códigos de concorrente, ids de produto
        await tx.auditar({
          acao: 'produto.enriquecer',
          entidade: 'produto',
          entidade_id: produto.id,
          antes,
          depois: { evento: 'catalogo.produto.cadastro_alterado', aplicacao_tamanho: (corpo.aplicacao ?? '').length, referencias: corpo.referencias ? corpo.referencias.map((r) => ({ marca_id: r.marca_id, codigo: r.codigo.trim() })) : antes.referencias, oferece_junto: corpo.oferece_junto, etiquetas: corpo.etiquetas },
        });
        return { id: produto.id, criado };
      });
    },
  };

  const marcasConcorrentes: RotaModulo = {
    metodo: 'GET',
    caminho: ROTAS_CATALOGO.marcasConcorrentes,
    acao: 'produto.enriquecer',
    carteira: 'nao_se_aplica',
    async executar(ctx: Ctx): Promise<ListaMarcasConcorrentes> {
      const marcas = await comRepo(ctx, (repo) => repo.marcasConcorrentes());
      return { items: [...marcas.entries()].filter(([, m]) => m.ativo).map(([id, m]) => ({ id, nome: m.nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.id.localeCompare(b.id)) };
    },
  };

  // T-0113 / RN-CAT-13 (ADR 0034): cadastro de marcas concorrentes do Catálogo; a lista é única, com ou sem o Promotor
  const listarMarcas: RotaModulo = {
    metodo: 'GET',
    caminho: ROTAS_CATALOGO.marcas,
    acao: 'produto.consultar',
    carteira: 'nao_se_aplica',
    query: MarcaListaQuerySchema,
    async executar(ctx: Ctx<unknown, MarcaListaQuery>): Promise<MarcaListaSaida> {
      const q = ctx.query;
      const todas = await comRepo(ctx, (repo) => repo.marcasCadastro());
      return {
        marcas: filtrarMarcas(todas, { situacao: q.situacao, busca: q.busca }),
      };
    },
  };

  /** Valida (RN-CAT-13), grava, publica o fato e audita (só ids), tudo na transação da rota. */
  async function escreverMarca(ctx: Ctx<unknown, unknown, unknown>, id: string, pedido: { nome?: string | undefined; ativo?: boolean | undefined; external_id?: string | null | undefined }, criar: boolean): Promise<RespostaEscrita> {
    return comTenantGravando(ctx, async (db, tx) => {
      const repo = dep.repositorio(ctx, db, tx);
      const todas = await repo.marcasCadastro();
      const atual = todas.find((m) => m.id === id) ?? null;
      if (!atual && !criar) throw new ErroNaoEncontrado('MARCA_NAO_ENCONTRADA', 'Marca não encontrada. Atualize a lista e tente de novo.');
      // POST repetido com o mesmo id (reenvio da outbox) não muda nada
      if (atual && criar) return { id, criado: false };
      const nome = pedido.nome ?? atual?.nome ?? '';
      const v = validarNomeMarca(nome);
      if (!v.ok) throw new ErroRegraNegocio(v.erro.regra, v.erro.mensagem, { campo: v.erro.campo });
      const repetida = todas.find((m) => m.id !== id && nomeMarcaIgual(m.nome, v.nome));
      if (repetida) throw new ErroRegraNegocio('RN-CAT-13', `Já existe a marca "${repetida.nome}"${repetida.ativo ? '' : ' (inativa)'}. Use a que existe ou escolha outro nome.`, { campo: 'nome' });
      const depois = { nome: v.nome, ativo: pedido.ativo ?? atual?.ativo ?? true, external_id: pedido.external_id !== undefined ? pedido.external_id : (atual?.external_id ?? null) };
      const fato = fatoDaEscritaMarca(atual ? { nome: atual.nome, ativo: atual.ativo, external_id: atual.external_id } : null, depois);
      if (fato === null) return { id, criado: false };
      // id de marca apagada ou de outro tenant: nada é gravado nem publicado; a mensagem não revela de quem é o id
      if (!(await repo.gravarMarca(id, depois))) throw new ErroHttpModulo(409, 'ID_EM_USO', 'Esse identificador já foi usado em outro cadastro. Recarregue a página e tente de novo.');
      await tx.publicar(EVENTO_MARCA_CONCORRENTE_ALTERADA, { id, ...depois, fato, alterada_em: ctx.agora().toISOString() }, id);
      // auditoria só com ids e fato (RN-AUD-01): o nome da marca não é dado pessoal, mas o log fica enxuto
      await tx.auditar({ acao: 'marca.gerenciar', entidade: 'marca_concorrente', entidade_id: id, depois: { fato, ativo: depois.ativo } });
      return { id, criado: fato === 'criada' };
    });
  }

  const criarMarca: RotaModulo = {
    metodo: 'POST',
    caminho: ROTAS_CATALOGO.marcas,
    acao: 'marca.gerenciar',
    carteira: 'nao_se_aplica',
    corpo: MarcaCriarSchema,
    async executar(ctx: Ctx<MarcaCriar>): Promise<RespostaEscrita> {
      const { id, ...resto } = ctx.corpo;
      return escreverMarca(ctx, id, resto, true);
    },
  };

  const alterarMarca: RotaModulo = {
    metodo: 'PUT',
    caminho: ROTAS_CATALOGO.marca,
    acao: 'marca.gerenciar',
    carteira: 'nao_se_aplica',
    params: ParamsMarca,
    corpo: MarcaAlterarSchema,
    async executar(ctx: Ctx<MarcaAlterar, unknown, ParamsMarca>): Promise<RespostaEscrita> {
      return escreverMarca(ctx, ctx.params.id, ctx.corpo, false);
    },
  };

  // T-0085 fatia C: página única (teto de 20 mil produtos no domain); só quem enriquece o catálogo (analista e admin)
  const exportacao: RotaModulo = {
    metodo: 'GET',
    caminho: ROTAS_CATALOGO.exportacao,
    acao: 'produto.enriquecer',
    carteira: 'nao_se_aplica',
    async executar(ctx: Ctx): Promise<RespostaExportacao> {
      return comRepo(ctx, async (repo) => {
        const [produtos, extras, marcas] = await Promise.all([repo.produtos(), repo.dadosExportacao(), repo.marcasConcorrentes()]);
        const r = montarExportacao({ produtos, ...extras, marcas });
        const lista = [...marcas.entries()].filter(([, m]) => m.ativo).map(([id, m]) => ({ id, nome: m.nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.id.localeCompare(b.id));
        return { produtos: r.produtos, marcas: lista, truncado: r.truncado };
      });
    },
  };

  // ---------- BKO: Tabelas de preço (só o preço da UN) e Escalonada (RN-VEN-23; T-0089): analista e admin ----------
  const tabelasPreco: RotaModulo = {
    metodo: 'GET',
    caminho: ROTAS_CATALOGO.tabelasPreco,
    acao: 'tabela_preco.gerenciar',
    carteira: 'nao_se_aplica',
    query: ConsultaTabelasPrecoQuery,
    async executar(ctx: Ctx<unknown, ConsultaTabelasPrecoQuery>): Promise<ListaTabelasPreco> {
      return comRepo(ctx, async (repo) => {
        const { filialId, filiais } = await filialDaTela(repo, ctx.query.filial);
        return { items: await repo.tabelasPreco(filialId), filial_id: filialId, filiais };
      });
    },
  };

  const precosTabela: RotaModulo = {
    metodo: 'GET',
    caminho: ROTAS_CATALOGO.precosTabela,
    acao: 'tabela_preco.gerenciar',
    carteira: 'nao_se_aplica',
    params: ParamsTabelaPreco,
    query: ConsultaPrecosTabelaQuery,
    async executar(ctx: Ctx<unknown, ConsultaPrecosTabelaQuery, ParamsTabelaPreco>): Promise<PaginaPrecosTabela> {
      const { q, limit, offset } = ctx.query;
      return comRepo(ctx, async (repo) => {
        const { filialId } = await filialDaTela(repo, ctx.query.filial);
        const [precos, produtos] = await Promise.all([repo.precosUnidade(ctx.params.id, filialId), repo.produtos()]);
        const porId = new Map(produtos.map((p) => [p.id, p]));
        const termo = q ? chaveDeTermo(q) : '';
        const linhas = precos
          .map((p) => ({ produto_id: p.produto_id, sku: porId.get(p.produto_id)?.sku ?? '', nome: porId.get(p.produto_id)?.nome ?? '', preco_cents: p.preco_cents, vigencia_inicio: p.vigencia_inicio, vigencia_fim: p.vigencia_fim }))
          .filter((l) => termo === '' || chaveDeTermo(`${l.sku} ${l.nome}`).includes(termo))
          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.produto_id.localeCompare(b.produto_id));
        const items = linhas.slice(offset, offset + limit);
        return { filial_id: filialId, items, total: linhas.length, next_offset: offset + limit < linhas.length ? offset + limit : null };
      });
    },
  };

  const listarEscalonada: RotaModulo = {
    metodo: 'GET',
    caminho: ROTAS_CATALOGO.escalonada,
    acao: 'tabela_preco.gerenciar',
    carteira: 'nao_se_aplica',
    query: ConsultaEscalonadaQuery,
    async executar(ctx: Ctx<unknown, ConsultaEscalonadaQuery>): Promise<PaginaEscalonada> {
      const { q, tabela_preco_id, vigente, limit, offset } = ctx.query;
      const hoje = dataCivilNoFuso(ctx.agora(), ctx.fuso());
      return comRepo(ctx, async (repo) => {
        const { filialId: filialPadrao } = await filialDaTela(repo, undefined);
        const [faixas, tabelas, produtos] = await Promise.all([repo.faixas(), repo.tabelasPreco(filialPadrao), repo.produtos()]);
        const porId = new Map(produtos.map((p) => [p.id, p]));
        const nomeTabela = new Map(tabelas.map((t) => [t.id, t.nome]));
        // P4: compara com o preço da UN na tabela (só das tabelas citadas pelas faixas; a geral compara com a menor tabela)
        const precoDaTabela = new Map<string, number>();
        for (const t of new Set(faixas.map((f) => f.tabela_preco_id).filter((x): x is string => x !== null))) for (const p of await repo.precosUnidade(t, filialPadrao)) precoDaTabela.set(`${t}|${p.produto_id}`, p.preco_cents);
        const termo = q ? chaveDeTermo(q) : '';
        const linhas: FaixaCadastrada[] = faixas
          .filter((f) => !tabela_preco_id || f.tabela_preco_id === tabela_preco_id)
          .map((f) => {
            const p = porId.get(f.produto_id);
            const precoTabela = f.tabela_preco_id ? (precoDaTabela.get(`${f.tabela_preco_id}|${f.produto_id}`) ?? null) : null;
            return {
              id: f.id,
              produto_id: f.produto_id,
              sku: p?.sku ?? '',
              nome: p?.nome ?? '',
              medida: f.medida,
              quantidade_minima: f.quantidade_minima,
              preco_unidade_cents: f.preco_unidade_cents,
              vigencia_inicio: f.vigencia_inicio,
              vigencia_fim: f.vigencia_fim,
              tabela_preco_id: f.tabela_preco_id,
              tabela_preco_nome: f.tabela_preco_id ? (nomeTabela.get(f.tabela_preco_id) ?? null) : null,
              ativo: f.ativo,
              origem: f.external_id ? ('erp' as const) : ('manual' as const),
              mais_cara_que_a_tabela: faixaMaisCaraQueATabela(f.preco_unidade_cents, precoTabela),
              vigente: faixaVigente(f, hoje),
            };
          })
          .filter((l) => (vigente === undefined || l.vigente === vigente) && (termo === '' || chaveDeTermo(`${l.sku} ${l.nome}`).includes(termo)))
          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || (a.medida ?? '').localeCompare(b.medida ?? '') || a.quantidade_minima - b.quantidade_minima || a.id.localeCompare(b.id));
        const items = linhas.slice(offset, offset + limit);
        return { items, total: linhas.length, next_offset: offset + limit < linhas.length ? offset + limit : null };
      });
    },
  };

  const salvarFaixa: RotaModulo = {
    metodo: 'PUT',
    caminho: ROTAS_CATALOGO.faixa,
    acao: 'tabela_preco.gerenciar',
    carteira: 'nao_se_aplica',
    params: ParamsFaixa,
    corpo: SalvarFaixa,
    async executar(ctx: Ctx<SalvarFaixa, unknown, ParamsFaixa>): Promise<RespostaEscrita> {
      // RN-VEN-23: a API revalida o que o BKO validou
      const v = validarFaixa(ctx.corpo);
      if (!v.ok) throw new ErroRegraNegocio('RN-VEN-23', v.mensagem);
      return ctx.comTenant(async (db, tx) => {
        const repo = dep.repositorio(ctx, db, tx);
        const existentes = await repo.faixas();
        const atual = existentes.find((f) => f.id === ctx.params.id);
        if (atual?.external_id) throw new ErroHttpModulo(409, 'FAIXA_DO_ERP', 'Esta faixa vem do ERP e é alterada lá. Cadastre outra faixa aqui se precisar de uma exceção.');
        if (!(await repo.produtos()).some((p) => p.id === ctx.corpo.produto_id)) throw new ErroHttpModulo(422, 'PRODUTO_INEXISTENTE', 'O produto escolhido não existe mais no catálogo. Atualize a lista e escolha outro.');
        const conflito = conflitoDeFaixa(ctx.params.id, ctx.corpo, existentes);
        if (conflito) throw new ErroHttpModulo(409, 'FAIXA_EM_CONFLITO', conflito);
        const { criado } = await repo.salvarFaixa(ctx.params.id, ctx.corpo);
        await tx.auditar({
          acao: 'tabela_preco.gerenciar',
          entidade: 'tabela_escalonada',
          entidade_id: ctx.params.id,
          ...(atual ? { antes: { quantidade_minima: atual.quantidade_minima, preco_unidade_cents: atual.preco_unidade_cents, ativo: atual.ativo } } : {}),
          depois: { produto_id: ctx.corpo.produto_id, medida: ctx.corpo.medida, quantidade_minima: ctx.corpo.quantidade_minima, preco_unidade_cents: ctx.corpo.preco_unidade_cents, ativo: ctx.corpo.ativo },
        });
        return { id: ctx.params.id, criado };
      });
    },
  };

  const removerFaixa: RotaModulo = {
    metodo: 'DELETE',
    caminho: ROTAS_CATALOGO.faixa,
    acao: 'tabela_preco.gerenciar',
    carteira: 'nao_se_aplica',
    params: ParamsFaixa,
    status: 204,
    async executar(ctx: Ctx<unknown, unknown, ParamsFaixa>): Promise<void> {
      await ctx.comTenant(async (db, tx) => {
        const repo = dep.repositorio(ctx, db, tx);
        const atual = (await repo.faixas()).find((f) => f.id === ctx.params.id);
        if (atual?.external_id) throw new ErroHttpModulo(409, 'FAIXA_DO_ERP', 'Esta faixa vem do ERP e é alterada lá. Para tirá-la de uso, inative-a no ERP.');
        // idempotente: remover o que já não existe também é 204
        if (await repo.removerFaixa(ctx.params.id)) await tx.auditar({ acao: 'tabela_preco.gerenciar', entidade: 'tabela_escalonada', entidade_id: ctx.params.id, antes: { id: ctx.params.id } });
      });
    },
  };

  const termos: RotaModulo = {
    metodo: 'GET',
    caminho: ROTAS_CATALOGO.termosSemResultado,
    acao: 'busca.ver_sem_resultado',
    carteira: 'nao_se_aplica',
    query: ConsultaTermosQuery,
    async executar(ctx: Ctx<unknown, ConsultaTermosQuery>): Promise<ListaTermosSemResultado> {
      const desde = new Date(ctx.agora().getTime() - ctx.query.days * 86_400_000).toISOString();
      return { items: await comRepo(ctx, (repo) => repo.termosSemResultado(desde, ctx.query.limit)) };
    },
  };

  return [busca, vitrine, hierarquia, ficha, filtros, listarSinonimos, salvarSinonimo, removerSinonimo, destaque, conteudo, fotoPrincipal, cadastroCatalogo, marcasConcorrentes, listarMarcas, criarMarca, alterarMarca, exportacao, termos, tabelasPreco, precosTabela, listarEscalonada, salvarFaixa, removerFaixa];
}
