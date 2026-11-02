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
 * GET  sinonimos                  sinonimo.gerenciar  (RF-CAT-07)
 * PUT  sinonimos/:id              sinonimo.gerenciar  idempotente pelo id
 * DELETE sinonimos/:id            sinonimo.gerenciar
 * PUT  produtos/:id/destaque      destaque.gerenciar
 * PUT  produtos/:id/conteudo      produto.enriquecer
 * GET  termos-sem-resultado       busca.ver_sem_resultado
 */
import {
  ErroHttpModulo,
  ErroNaoEncontrado,
  ErroRegraNegocio,
  verificarCarteira,
  type ContextoBase,
  type ContextoRota,
  type RotaModulo,
} from '@macuxi/platform-sdk';
import {
  ConsultaBuscaQuery,
  ConsultaFichaQuery,
  ConsultaTermosQuery,
  ConsultaVitrineQuery,
  ParamsProduto,
  ParamsSinonimo,
  ROTAS_CATALOGO,
  SalvarConteudo,
  SalvarDestaque,
  SalvarSinonimo,
  type FichaProduto,
  type FiltrosCatalogo,
  type FiltrosInterpretados,
  type ListaSinonimos,
  type ListaTermosSemResultado,
  type PaginaVitrine,
  type RespostaBusca,
  type RespostaEscrita,
} from '../contracts';
import { conflitoDeSinonimo, montarFicha, normalizarSinonimo, termoDeBusca } from '../domain/conteudo';
import { interpretarConsulta, type VocabularioTenant } from '../domain/consulta';
import { AVISO_BUSCA_FALHOU, type PortaInterpretacaoLlm } from '../domain/ia';
import { diaDoTenant, verificarConsultaIa } from '../domain/limite-ia';
import { parametrosDoTenant, timeoutIaDoTenant, type ParametrosCatalogo } from '../domain/parametros';
import type { SinonimoDoTenant } from '../domain/texto';
import { podeVerPrecoEstoque } from '../domain/visibilidade';
import { buscarProdutos, itemDaVitrine, listarVitrine, vocabularioDe, type ContextoVitrine, type ProdutoCatalogo } from '../domain/vitrine';
import { interpretarComMedicao } from './ia/buscar';
import type { FabricaRepositorio, RepositorioCatalogo } from './repositorio';

export interface DependenciasRotas {
  repositorio: FabricaRepositorio;
  /** Porta do LLM da busca para o tempo limite dado (ms); `null` = sem provedor configurado (busca por regras, sem aviso). */
  portaIa?: (timeoutMs: number) => PortaInterpretacaoLlm | null;
}

type Ctx<C = unknown, Q = unknown, P = unknown> = ContextoRota<C, Q, P>;

/** RN-CORE-04: cliente em contexto precisa estar na carteira (403 FORA_DA_CARTEIRA, como o `createApp`). */
async function conferirCliente(ctx: ContextoBase, clienteId: string | undefined): Promise<string | null> {
  if (!clienteId) return null;
  const r = verificarCarteira(clienteId, await ctx.carteira());
  if (!r.ok) throw new ErroHttpModulo(403, r.codigo, r.mensagem);
  return clienteId;
}

/** Monta o contexto de preço/estoque do usuário. RN-CAT-05: para quem não vê, nada de preço/estoque é lido do banco. */
async function contextoVitrine(ctx: ContextoBase, repo: RepositorioCatalogo, p: ParametrosCatalogo, clienteId: string | null, produtos: readonly ProdutoCatalogo[]): Promise<ContextoVitrine> {
  const base = { perfil: ctx.usuario.perfil, parametros: p, agora: ctx.agora().toISOString(), clienteId };
  if (!podeVerPrecoEstoque(ctx.usuario.perfil, p)) {
    return { ...base, tabelaClienteId: null, itensPreco: [], promocoes: [], saldos: new Map(), filiais: [] };
  }
  const ids = produtos.filter((x) => x.ativo).map((x) => x.id);
  const precos = await repo.precos(clienteId, ids);
  const promocoes = await repo.promocoes(ids);
  const saldos = await repo.saldos(ids);
  const filiais = await repo.filiaisDoUsuario();
  return { ...base, tabelaClienteId: precos.tabelaClienteId, itensPreco: precos.itens, promocoes, saldos, filiais };
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
async function interpretar(ctx: ContextoBase, dep: DependenciasRotas, q: ConsultaBuscaQuery, vocab: VocabularioTenant, p: ParametrosCatalogo, uso: Awaited<ReturnType<RepositorioCatalogo['usoIa']>>, dia: string): Promise<Interpretacao> {
  if (q.mode === 'basica') return { filtros: interpretarConsulta(q.q, vocab), interpreted_by: 'nenhum', degraded: false, notice: null, remaining_ai_queries: null };
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
      const dia = diaDoTenant(ctx.agora(), ctx.fuso());
      // 1) leitura curta: produtos, sinônimos e uso de IA do dia
      const leitura = await comRepo(ctx, async (repo) => ({ produtos: await repo.produtos(), sinonimos: await repo.sinonimos(), uso: q.mode === 'basica' ? null : await repo.usoIa(dia) }));
      const vocab = vocabularioDe(leitura.produtos);
      // 2) interpretação (provedor fora da transação)
      const interp = await interpretar(ctx, dep, q, vocab, p, leitura.uso, dia);
      // 3) preço/estoque do usuário, ranking e registro da busca (RF-CAT-07)
      return comRepo(ctx, async (repo) => {
        const contexto = await contextoVitrine(ctx, repo, p, clienteId, leitura.produtos);
        const sinonimos: readonly SinonimoDoTenant[] = leitura.sinonimos;
        const pagina = buscarProdutos({ produtos: leitura.produtos, contexto, filtros: interp.filtros, chips: { line: q.line, brand: q.brand, only_in_stock: q.only_in_stock }, sinonimos, limit: q.limit, offset: q.offset });
        const termo = termoDeBusca(q.q);
        if (termo && q.offset === 0) await repo.registrarBusca({ termo, resultados: pagina.total, em: ctx.agora().toISOString(), interpretado_por: interp.interpreted_by });
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
        const produtos = await repo.produtos();
        const contexto = await contextoVitrine(ctx, repo, p, clienteId, produtos);
        return listarVitrine({ produtos, contexto, chips: { line: q.line, brand: q.brand, only_in_stock: q.only_in_stock, campaign: q.campaign }, sinonimos: [], limit: q.limit, offset: q.offset });
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
        return montarFicha(produto, itemDaVitrine(produto, contexto), conteudo, midias);
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
      return ctx.comTenant(async (db, tx) => {
        const repo = dep.repositorio(ctx, db, tx);
        const produto = await repo.produto(ctx.params.id);
        if (!produto) throw new ErroNaoEncontrado('PRODUTO_NAO_ENCONTRADO', 'Produto não encontrado no catálogo.');
        await repo.marcarDestaque(produto.id, ctx.corpo.is_campaign);
        await tx.auditar({ acao: 'destaque.gerenciar', entidade: 'produto', entidade_id: produto.id, antes: { is_campaign: produto.campanha }, depois: { is_campaign: ctx.corpo.is_campaign } });
        return { id: produto.id, criado: false };
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
      return ctx.comTenant(async (db, tx) => {
        const repo = dep.repositorio(ctx, db, tx);
        const produto = await repo.produto(ctx.params.id);
        if (!produto) throw new ErroNaoEncontrado('PRODUTO_NAO_ENCONTRADO', 'Produto não encontrado no catálogo.');
        const { criado } = await repo.salvarConteudo(produto.id, ctx.corpo, ctx.agora().toISOString());
        await tx.auditar({ acao: 'produto.enriquecer', entidade: 'produto', entidade_id: produto.id, depois: { atributos: ctx.corpo.attributes.length, argumentos: ctx.corpo.selling_points.length, faq: ctx.corpo.faq.length } });
        return { id: produto.id, criado };
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

  return [busca, vitrine, ficha, filtros, listarSinonimos, salvarSinonimo, removerSinonimo, destaque, conteudo, termos];
}
