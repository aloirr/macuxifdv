/**
 * Rotas do Gestor (`/v1/gestor`, T-0055). Declarativas: o `createApp` (apps/api) aplica login, LICENÇA do Gestor
 * (403 MODULO_INATIVO, RN-CORE-02), PERFIL (por `acao` do manifesto ou `perfis`) e Zod antes do `executar`.
 * Aqui: o ESCOPO (RN-CORE-04) vem da lista autoritativa da plataforma (`ctx.usuariosVisiveis()`) e é aplicado pelo
 * domain em toda resposta; fora do escopo = 404 sem revelar existência. Leitura do tenant (analista/admin) é só
 * leitura (RN-GES-07). Nenhuma rota de pedido aqui (RN-PRO-01): aprovar/rejeitar e o pedido em nome são do Vendedor.
 */
import { CONSULTA_CADASTRO_RESUMO, CONSULTA_CALENDARIO_METAS, CONSULTA_PRODUTIVIDADE_EQUIPE, CONSULTA_TRAJETO_DO_DIA, type HorarioAlmoco, type ParametrosAlertasProdutividade } from '@macuxi/core/contracts';
import { ErroHttpModulo, ErroNaoEncontrado, ErroRegraNegocio, exigirPermissao, uuidPadrao, type ClienteBanco, type ContextoBase, type Perfil, type RotaModulo, type TransacaoTenant } from '@macuxi/platform-sdk';
import { exigirDataCivil } from '@macuxi/comum';
import type { z } from 'zod';
import manifest from '../manifest';
import {
  ACAO_VER_TRAJETO,
  AjusteRegraAlerta,
  AlertasQuery,
  DataQuery,
  DisponibilidadeEmNomeQuery,
  ParamsId,
  ParamsTipoAlerta,
  ParamsUsuario,
  RankingQuery,
  TIPOS_REGRA_EQUIPE,
  type FichaMembro,
  type FilaAprovacao,
  type ListaAlertas,
  type MembroEquipe,
  type RankingEquipe,
  type RegrasAlertaResposta,
  type TrajetoEquipe,
  type VisaoEquipe,
} from '../contracts';
import {
  ajustarRegraAlerta,
  alertasDoEscopo,
  dataDaConsulta,
  disponibilidadePedidoEmNome,
  dispensarAlerta,
  ehTipoProdutividade,
  equipeDoEscopo,
  escopoDosVisiveis,
  fichaDoMembro,
  filaDeAprovacoes,
  membrosDoCadastro,
  parametrosDoTenant,
  pessoasDoTrajeto,
  rankingDaEquipe,
  reconciliarParaViewer,
  resolverRegras,
  resumirFila,
  usuariosDaProjecao,
  visaoDaEquipe,
  type EscopoGestor,
  type EstadoProjecao,
  type ParametrosGestor,
} from '../domain';
import { rotasDeParametrosAlertas } from './parametros-alertas';
import type { AcessoTenant, RepositorioGestor } from './repositorio';

/** Quem LÊ os painéis: a equipe (painel_equipe.ver) e o tenant em leitura (painel_tenant.ver, RN-GES-07). */
export const PERFIS_LEITURA: readonly Perfil[] = [...new Set([...manifest.acoes['painel_equipe.ver']!.perfis, ...manifest.acoes['painel_tenant.ver']!.perfis])];

const LOTE_CADASTRO = 500;

/** Tudo que uma rota de leitura precisa, carregado na transação do tenant. */
export interface ContextoGestor {
  acesso: AcessoTenant;
  tx: TransacaoTenant;
  viewer: { id: string; perfil: MembroEquipe['perfil'] };
  escopo: EscopoGestor;
  membros: MembroEquipe[];
  estado: EstadoProjecao;
  modulos: ReadonlySet<string>;
  params: ParametrosGestor;
  agora: string;
}

/**
 * Nomes e perfis pelo cadastro do Core (`core.cadastro_resumo@1`, ADR 0012): supervisor/gerente = os usuários visíveis
 * da plataforma; tenant = quem aparece na projeção. A árvore completa (superior de cada um) entra quando o Core oferecer
 * a hierarquia por consulta; até lá a equipe fica pendurada em quem consulta (`membrosDoCadastro`).
 */
async function carregarMembros(ctx: ContextoBase, tx: TransacaoTenant, escopo: EscopoGestor, estado: EstadoProjecao, visiveis: ReadonlySet<string> | 'tenant'): Promise<MembroEquipe[]> {
  const eu = ctx.usuario.id;
  const ids = new Set<string>([eu]);
  if (escopo.tipo === 'equipe' && visiveis !== 'tenant') for (const id of visiveis) ids.add(id);
  if (escopo.tipo === 'tenant') for (const id of usuariosDaProjecao(estado)) ids.add(id);
  const lista = [...ids];
  const cadastro: { id: string; nome: string; perfil: string }[] = [];
  for (let i = 0; i < lista.length; i += LOTE_CADASTRO) {
    const r = await tx.consultar(CONSULTA_CADASTRO_RESUMO, { cliente_ids: [], produto_ids: [], usuario_ids: lista.slice(i, i + LOTE_CADASTRO) });
    cadastro.push(...r.usuarios);
  }
  const nome = cadastro.find((c) => c.id === eu)?.nome ?? 'Gestor';
  return membrosDoCadastro({ id: eu, perfil: ctx.usuario.perfil, nome }, cadastro);
}

/** Nome (fantasia, senão razão social) e código (`external_id`) do cliente para o cartão da fila, pelo cadastro do Core (`core.cadastro_resumo@1`). */
async function nomesDosClientes(tx: TransacaoTenant, ids: readonly string[]): Promise<Map<string, { nome: string; codigo: string | null }>> {
  const unicos = [...new Set(ids)];
  const nomes = new Map<string, { nome: string; codigo: string | null }>();
  for (let i = 0; i < unicos.length; i += LOTE_CADASTRO) {
    const r = await tx.consultar(CONSULTA_CADASTRO_RESUMO, { cliente_ids: unicos.slice(i, i + LOTE_CADASTRO), produto_ids: [], usuario_ids: [] });
    for (const c of r.clientes) nomes.set(c.id, { nome: c.nome_fantasia?.trim() || c.razao_social, codigo: c.external_id?.trim() || null });
  }
  return nomes;
}

export async function carregarContexto(ctx: ContextoBase, repo: RepositorioGestor, db: ClienteBanco, tx: TransacaoTenant): Promise<ContextoGestor> {
  const viewer = { id: ctx.usuario.id, perfil: ctx.usuario.perfil };
  const visiveis = await ctx.usuariosVisiveis();
  const escopo = escopoDosVisiveis(viewer, visiveis);
  const acesso: AcessoTenant = { db, tenant_id: ctx.usuario.tenant_id };
  const estado = await repo.estado(acesso);
  const membros = escopo.tipo === 'nenhum' ? [] : await carregarMembros(ctx, tx, escopo, estado, visiveis);
  const { params, erro } = parametrosDoTenant(ctx.parametros(), ctx.fuso());
  if (erro) ctx.log.warn({ erro }, 'parâmetro do Gestor inválido no tenant: usando o padrão');
  // RN-CORE-22/26: semana útil e feriados das metas vêm do Core (consulta de configuração do tenant), a mesma fonte do Início e das Metas
  const calendario = await tx.consultar(CONSULTA_CALENDARIO_METAS, {}, { licenca: 'tenant' });
  const paramsComCalendario = { ...params, calendario_metas: { dias_uteis_semana: calendario.dias_uteis_semana, feriados: calendario.feriados } };
  return { acesso, tx, viewer, escopo, membros, estado, modulos: new Set(['core', ...ctx.usuario.modulos]), params: paramsComCalendario, agora: ctx.agora().toISOString() };
}

type Executar<T> = (g: ContextoGestor, ctx: ContextoBase) => Promise<T>;
const comGestor = <T>(ctx: ContextoBase, repo: RepositorioGestor, fn: Executar<T>): Promise<T> =>
  ctx.comTenant(async (db, tx) => fn(await carregarContexto(ctx, repo, db, tx), ctx));

/** Data do usuário (`?data=`): o contrato só confere o formato; "2026-02-30" não existe e vira 422 em português, não 500. */
export function dataDoUsuario(data: string | undefined): string | undefined {
  if (data === undefined) return undefined;
  try {
    return exigirDataCivil(data);
  } catch {
    throw new ErroRegraNegocio('DATA_INVALIDA', `A data ${data} não existe no calendário. Informe uma data válida no formato AAAA-MM-DD.`);
  }
}

const base = (g: ContextoGestor, data?: string) => ({
  estado: g.estado,
  membros: g.membros,
  viewer: g.viewer,
  escopo: g.escopo,
  modulos: g.modulos,
  agora: g.agora,
  params: g.params,
  data: dataDaConsulta(data, g.agora, g.params.fuso),
});

const LOTE_PRODUTIVIDADE = 500;

/**
 * T-0180, ADR 0059 §4: o que o Core sabe da produtividade da equipe de campo (`core.produtividade_equipe@1`): o limite do "parado"
 * (`inicio.parado_min`), o parâmetro `alertas.produtividade` e o último contato do aparelho de cada pessoa. Sem gente de campo, `undefined`.
 */
async function produtividadeDaEquipe(g: ContextoGestor): Promise<{ parado_min: number; alertas: ParametrosAlertasProdutividade; ultimo_contato_em: Record<string, string | null>; almoco: Record<string, HorarioAlmoco> } | undefined> {
  const ids = g.membros.filter((m) => (m.perfil === 'vendedor' || m.perfil === 'promotor') && m.ativo).map((m) => m.id);
  let base: { parado_min: number; alertas: ParametrosAlertasProdutividade } | undefined;
  const ultimo_contato_em: Record<string, string | null> = {};
  const almoco: Record<string, HorarioAlmoco> = {};
  for (let i = 0; i < ids.length; i += LOTE_PRODUTIVIDADE) {
    const r = await g.tx.consultar(CONSULTA_PRODUTIVIDADE_EQUIPE, { usuario_ids: ids.slice(i, i + LOTE_PRODUTIVIDADE) });
    base ??= { parado_min: r.parado_min, alertas: r.alertas };
    for (const u of r.usuarios) {
      ultimo_contato_em[u.id] = u.ultimo_contato_em;
      almoco[u.id] = { inicio_min: u.almoco_inicio_min, fim_min: u.almoco_fim_min };
    }
  }
  return base && { ...base, ultimo_contato_em, almoco };
}

/** Reconcilia os alertas (tipos do viewer) e devolve a lista atualizada do tenant. */
async function alertasAtualizados(g: ContextoGestor, repo: RepositorioGestor) {
  const existentes = await repo.alertas(g.acesso);
  const ajustes = await repo.ajustesRegras(g.acesso);
  const prod = await produtividadeDaEquipe(g);
  const ops = reconciliarParaViewer(existentes, {
    estado: g.estado,
    membros: g.membros,
    agora: g.agora,
    modulos: g.modulos,
    ajustes,
    params: prod ? { ...g.params, parado_min: prod.parado_min } : g.params,
    produtividade: prod?.alertas,
    ultimo_contato_em: prod?.ultimo_contato_em,
    almoco: prod?.almoco,
  });
  if (ops.abrir.length + ops.atualizar.length + ops.encerrar.length === 0) return existentes;
  await repo.aplicarOperacoesAlerta(g.acesso, ops, { agora: g.agora, novoId: uuidPadrao });
  return repo.alertas(g.acesso);
}

/** Fábrica das rotas sobre um repositório (memória hoje; SQL quando a migração do banco-dados chegar). */
export function criarRotasGestor(repo: RepositorioGestor): RotaModulo[] {
  /** GET /v1/gestor/equipe?data= — RF-GES-01: resumo, equipes abaixo e painel do dia de cada pessoa de campo. */
  const equipe: RotaModulo = {
    metodo: 'GET',
    caminho: 'equipe',
    perfis: PERFIS_LEITURA,
    carteira: 'filtrar_no_dominio',
    query: DataQuery,
    executar: (ctx) => {
      const data = dataDoUsuario((ctx.query as DataQuery).data);
      return comGestor(ctx, repo, async (g): Promise<VisaoEquipe> => visaoDaEquipe(base(g, data)));
    },
  };

  /** GET /v1/gestor/equipe/:usuario_id?data= — RF-GES-02/10: ficha; fora do escopo = 404 (não revela). */
  const ficha: RotaModulo = {
    metodo: 'GET',
    caminho: 'equipe/:usuario_id',
    perfis: PERFIS_LEITURA,
    carteira: 'filtrar_no_dominio',
    params: ParamsUsuario,
    query: DataQuery,
    executar: (ctx) => {
      const data = dataDoUsuario((ctx.query as DataQuery).data);
      return comGestor(ctx, repo, async (g): Promise<FichaMembro> => {
        const f = fichaDoMembro({ ...base(g, data), usuario_id: (ctx.params as z.infer<typeof ParamsUsuario>).usuario_id });
        if (!f) throw new ErroNaoEncontrado('MEMBRO_NAO_ENCONTRADO', 'Pessoa não encontrada na sua equipe.');
        return f;
      });
    },
  };

  /**
   * GET /v1/gestor/equipe/:usuario_id/trajeto?data= — T-0156, RN-CORE-13/RN-CORE-37, tracking §7: trajeto do dia de uma pessoa de campo,
   * pelo `core.trajeto_do_dia@1` (o Core confere de novo escopo e permissão). Exige `core.trajeto.ver_equipe` (supervisor e gerente; o admin só
   * se o perfil dele receber a permissão no BKO; nunca vendedor, promotor ou analista). Fora do escopo = 404. Só leitura: nada exporta pontos brutos, e nenhuma
   * coordenada vai para log ou erro (§9). Sem pontos, `pontos` vem vazio.
   */
  const trajeto: RotaModulo = {
    metodo: 'GET',
    caminho: 'equipe/:usuario_id/trajeto',
    carteira: 'filtrar_no_dominio',
    params: ParamsUsuario,
    query: DataQuery,
    executar: (ctx) => {
      exigirPermissao(ctx.usuario, ACAO_VER_TRAJETO);
      const data = dataDoUsuario((ctx.query as DataQuery).data);
      const { usuario_id } = ctx.params as z.infer<typeof ParamsUsuario>;
      return comGestor(ctx, repo, async (g): Promise<TrajetoEquipe> => {
        const alvo = pessoasDoTrajeto({ viewer: g.viewer, membros: equipeDoEscopo(g) }).find((m) => m.id === usuario_id);
        if (!alvo) throw new ErroNaoEncontrado('MEMBRO_NAO_ENCONTRADO', 'Pessoa não encontrada na sua equipe.');
        const dia = dataDaConsulta(data, g.agora, g.params.fuso);
        const r = await g.tx.consultar(CONSULTA_TRAJETO_DO_DIA, { usuario_ids: [alvo.id], data: dia });
        return { data: r.data, trajeto: r.usuarios.find((u) => u.id === alvo.id) ?? { id: alvo.id, metros: 0, pontos: [] } };
      });
    },
  };

  /** GET /v1/gestor/ranking?indicador=&periodo=&data= — RF-GES-03 (desempate total no domain). */
  const ranking: RotaModulo = {
    metodo: 'GET',
    caminho: 'ranking',
    perfis: PERFIS_LEITURA,
    carteira: 'filtrar_no_dominio',
    query: RankingQuery,
    executar: (ctx) => {
      const q = ctx.query as RankingQuery;
      const data = dataDoUsuario(q.data);
      return comGestor(ctx, repo, async (g): Promise<RankingEquipe> => {
        const b = base(g, data);
        return rankingDaEquipe({ estado: g.estado, membros: equipeDoEscopo(g), viewer: g.viewer, indicador: q.indicador, periodo: q.periodo, data_ref: b.data, modulos: g.modulos, params: g.params, agora: g.agora });
      });
    },
  };

  /** GET /v1/gestor/aprovacoes — RF-GES-04, RN-GES-03/04/07: fila com prazo em dias úteis; quem decide é o Vendedor. */
  const aprovacoes: RotaModulo = {
    metodo: 'GET',
    caminho: 'aprovacoes',
    perfis: PERFIS_LEITURA,
    carteira: 'filtrar_no_dominio',
    executar: (ctx) =>
      comGestor(ctx, repo, async (g): Promise<FilaAprovacao> => {
        const itens = filaDeAprovacoes({ estado: g.estado, viewer: g.viewer, escopo: g.escopo, agora: g.agora, modulos: g.modulos, params: g.params });
        const nomes = await nomesDosClientes(g.tx, itens.map((i) => i.cliente_id));
        const comNome = itens.map((i) => ({ ...i, cliente_nome: nomes.get(i.cliente_id)?.nome || null, cliente_codigo: nomes.get(i.cliente_id)?.codigo ?? null }));
        return { itens: comNome, resumo: resumirFila(comNome), calculado_em: g.agora };
      }),
  };

  /**
   * GET /v1/gestor/alertas?status=&produtividade=1 — RF-GES-07: reconcilia e lista os alertas do escopo (padrão: abertos e dispensados).
   * Os de produtividade só vêm com `produtividade=1` (ADR 0059 §1): o Gestão anterior à v1.0.13 rejeita o tipo novo.
   */
  const alertas: RotaModulo = {
    metodo: 'GET',
    caminho: 'alertas',
    perfis: PERFIS_LEITURA,
    carteira: 'filtrar_no_dominio',
    query: AlertasQuery,
    executar: (ctx) =>
      comGestor(ctx, repo, async (g): Promise<ListaAlertas> => {
        const q = ctx.query as AlertasQuery;
        const todos = (await alertasAtualizados(g, repo)).filter((a) => q.produtividade === '1' || !ehTipoProdutividade(a.tipo));
        return { itens: alertasDoEscopo(todos, g.escopo, { status: q.status, ativos: !q.status, modulos: g.modulos }), calculado_em: g.agora };
      }),
  };

  /** POST /v1/gestor/alertas/:id/dispensar — RF-GES-07 (supervisor/gerente); auditado (RN-AUD-01); idempotente. */
  const dispensar: RotaModulo = {
    metodo: 'POST',
    caminho: 'alertas/:id/dispensar',
    acao: 'alerta_equipe.dispensar',
    carteira: 'filtrar_no_dominio',
    params: ParamsId,
    executar: (ctx) =>
      comGestor(ctx, repo, async (g) => {
        const { id } = ctx.params as z.infer<typeof ParamsId>;
        const atual = (await repo.alertas(g.acesso)).find((a) => a.id === id) ?? null;
        const r = dispensarAlerta(atual && alertasDoEscopo([atual], g.escopo, { modulos: g.modulos }).length > 0 ? atual : null, g.escopo);
        if (!r.ok && r.codigo === 'ALERTA_NAO_ENCONTRADO') throw new ErroNaoEncontrado(r.codigo, 'Alerta não encontrado na sua equipe.');
        if (!r.ok) throw new ErroHttpModulo(409, r.codigo, 'Este alerta já foi encerrado: a condição normalizou. Atualize a lista.');
        if (r.repetido) return r.alerta;
        await repo.gravarAlerta(g.acesso, r.alerta);
        await g.tx.auditar({ acao: 'alerta_equipe.dispensar', entidade: 'alerta', entidade_id: id, antes: { status: 'aberto', tipo: r.alerta.tipo }, depois: { status: 'dispensado' } });
        return r.alerta;
      }),
  };

  /** GET /v1/gestor/alertas/regras — regras vigentes do tenant (BKO, `alerta_regra.gerenciar`). */
  const regras: RotaModulo = {
    metodo: 'GET',
    caminho: 'alertas/regras',
    acao: 'alerta_regra.gerenciar',
    carteira: 'nao_se_aplica',
    executar: (ctx) =>
      ctx.comTenant(async (db): Promise<RegrasAlertaResposta> => {
        const r = resolverRegras(await repo.ajustesRegras({ db, tenant_id: ctx.usuario.tenant_id }));
        return { regras: TIPOS_REGRA_EQUIPE.map((t) => r[t]) };
      }),
  };

  /** PUT /v1/gestor/alertas/regras/:tipo — liga/desliga e ajusta uma regra (analista/admin); auditado. */
  const ajustarRegra: RotaModulo = {
    metodo: 'PUT',
    caminho: 'alertas/regras/:tipo',
    acao: 'alerta_regra.gerenciar',
    carteira: 'nao_se_aplica',
    params: ParamsTipoAlerta,
    corpo: AjusteRegraAlerta,
    executar: (ctx) =>
      ctx.comTenant(async (db, tx) => {
        const { tipo } = ctx.params as z.infer<typeof ParamsTipoAlerta>;
        const acesso = { db, tenant_id: ctx.usuario.tenant_id };
        const atuais = await repo.ajustesRegras(acesso);
        const r = ajustarRegraAlerta(atuais, tipo, ctx.corpo);
        if (!r.ok) throw new ErroRegraNegocio('REGRA_ALERTA_INVALIDA', r.erros.join(' '));
        await repo.gravarAjustesRegras(acesso, r.ajustes);
        await tx.auditar({ acao: 'alerta_regra.gerenciar', entidade: 'alerta_regra', entidade_id: null, antes: { tipo, ajuste: atuais[tipo] ?? null }, depois: { tipo, ajuste: r.ajustes[tipo] } });
        return resolverRegras(r.ajustes)[tipo];
      }),
  };

  /**
   * GET /v1/gestor/pedido-em-nome/disponibilidade?vendedor_id= — RF-GES-05, RN-VEN-35: se o botão aparece e para quem.
   * O pedido em si é do Vendedor (extensão `pedido.criar_em_nome`, ação de mesmo nome), que revalida tudo.
   */
  const emNome: RotaModulo = {
    metodo: 'GET',
    caminho: 'pedido-em-nome/disponibilidade',
    perfis: PERFIS_LEITURA,
    carteira: 'filtrar_no_dominio',
    query: DisponibilidadeEmNomeQuery,
    executar: (ctx) =>
      comGestor(ctx, repo, async (g) =>
        disponibilidadePedidoEmNome({ autor: g.viewer, vendedor_id: (ctx.query as DisponibilidadeEmNomeQuery).vendedor_id, membros: equipeDoEscopo(g), modulos: g.modulos }),
      ),
  };

  return [equipe, ficha, trajeto, ranking, aprovacoes, alertas, dispensar, regras, ajustarRegra, ...rotasDeParametrosAlertas, emNome];
}
