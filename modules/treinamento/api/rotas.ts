/**
 * Rotas `/v1/treinamento/*` (desenho T-0058). O `createApp` aplica, em toda rota: autenticação → licença do módulo
 * (RN-CORE-02) → perfil pela AÇÃO do manifesto (ADR 0004) → validação Zod. O escopo do dado (RN-CORE-04) é aplicado
 * aqui: o aluno só vê o próprio progresso, o ranking é do tenant (RN-TRE-03) e o painel recorta pelos usuários visíveis.
 * Nenhuma rota toca cliente: escopo de carteira `nao_se_aplica`. Regras de negócio vêm do domain; aqui só se orquestra.
 */
import { ErroHttpModulo, ErroNaoEncontrado, ErroRegraNegocio, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import {
  AdesaoQuery,
  BkoTrilhasQuery,
  IdParams,
  RankingQuery,
  type AdesaoResposta,
  type BkoTrilhaDetalhe,
  type BkoTrilhaResumo,
  type BkoTrilhasResposta,
  type JornadaResposta,
  type PessoasResposta,
  type RankingResposta,
} from '../contracts/api';
import { conteudoParaDominio, TrilhaEdicao, trilhaParaPublicar, type Trilha } from '../contracts/conteudo';
import { resumoDaJornada } from '../domain/atividade';
import { podeEditarTrilha, problemasParaPublicar, transicaoDaTrilha, type AcaoStatusTrilha } from '../domain/bko';
import { conclusoesDeTrilhas, painelDeAdesao } from '../domain/painel';
import { calcularRanking, intervaloDoPeriodo, type EscopoRanking } from '../domain/ranking';
import { alunoDaSessao, comRepositorio, erroDeRegra, hojeNoTenant, noEscopo, parametrosDoTenant } from './comum';
import type { FabricaRepositorio, RepositorioTreinamento, TrilhaGravada } from './repositorio';

const rota = <C extends z.ZodTypeAny = z.ZodTypeAny, Q extends z.ZodTypeAny = z.ZodTypeAny, P extends z.ZodTypeAny = z.ZodTypeAny>(r: RotaModulo<C, Q, P>): RotaModulo =>
  r as unknown as RotaModulo;

const naoEncontrada = () => new ErroNaoEncontrado('TRILHA_NAO_ENCONTRADA', 'Trilha não encontrada. Atualize a lista e tente de novo.');

function detalhe(t: TrilhaGravada): BkoTrilhaDetalhe {
  const { deleted_at: _d, ...trilha } = t;
  return { ...trilha, problemas_para_publicar: t.status === 'rascunho' ? problemasParaPublicar(trilhaParaPublicar(t)) : [] };
}

function resumo(t: TrilhaGravada): BkoTrilhaResumo {
  const licoes = t.modulos.flatMap((m) => m.licoes);
  return {
    id: t.id,
    titulo: t.titulo,
    status: t.status,
    obrigatoria: t.obrigatoria,
    prazo: t.prazo,
    modulos: t.modulos.length,
    licoes: licoes.length,
    quizzes: licoes.filter((l) => l.quiz).length,
    publico_perfis: [...t.publico_alvo.perfis],
    publico_equipes: t.publico_alvo.equipes.length,
    publicada_em: t.publicada_em,
    updated_at: t.updated_at,
  };
}

async function trilhaOu404(repo: RepositorioTreinamento, id: string): Promise<TrilhaGravada> {
  const t = await repo.trilha(id);
  if (!t) throw naoEncontrada();
  return t;
}

export function criarRotas(fabrica: FabricaRepositorio | null): RotaModulo[] {
  // ---------- aluno ----------
  const jornada = rota({
    metodo: 'GET',
    caminho: 'jornada',
    acao: 'licao.concluir',
    carteira: 'nao_se_aplica',
    executar: (ctx) =>
      comRepositorio(fabrica, ctx, async (repo): Promise<JornadaResposta> => {
        const params = parametrosDoTenant(ctx);
        const [trilhas, gravado, usuarios] = await Promise.all([repo.trilhas(), repo.estadoDoAluno(ctx.usuario.id), repo.usuarios()]);
        const hoje = hojeNoTenant(ctx);
        const r = resumoDaJornada({ tenant_id: ctx.usuario.tenant_id, usuario_id: ctx.usuario.id, usuario: alunoDaSessao(ctx, usuarios), ...gravado }, conteudoParaDominio(trilhas), { hoje, params });
        const titulos = new Map(trilhas.map((t) => [t.id, t.titulo]));
        return { hoje, ...r, trilhas: r.trilhas.map((t) => ({ ...t, titulo: titulos.get(t.trilha_id) ?? '' })) };
      }),
  });

  const ranking = rota({
    metodo: 'GET',
    caminho: 'ranking',
    acao: 'ranking.ver',
    carteira: 'nao_se_aplica',
    query: RankingQuery,
    executar: (ctx) =>
      comRepositorio(fabrica, ctx, async (repo): Promise<RankingResposta> => {
        const params = parametrosDoTenant(ctx);
        const [usuarios, lancamentos, conclusoes, trilhas] = await Promise.all([repo.usuarios(), repo.lancamentosDoTenant(), repo.conclusoesDoTenant(), repo.trilhas()]);
        const eu = alunoDaSessao(ctx, usuarios);
        let escopo: EscopoRanking = { tipo: 'geral' };
        if (ctx.query.escopo === 'equipe') {
          if (!eu.equipe_id) throw new ErroRegraNegocio('SEM_EQUIPE', 'Você ainda não está numa equipe. Veja o ranking geral.', { regra: 'RN-TRE-03' });
          escopo = { tipo: 'equipe', equipe_id: eu.equipe_id };
        } else if (ctx.query.escopo === 'regional') {
          if (!eu.regional_id) throw new ErroRegraNegocio('SEM_REGIONAL', 'Você ainda não está numa regional. Veja o ranking geral.', { regra: 'RN-TRE-03' });
          escopo = { tipo: 'regional', regional_id: eu.regional_id };
        }
        const dataRef = ctx.query.data ?? hojeNoTenant(ctx);
        const tenant = ctx.usuario.tenant_id;
        const linhas = calcularRanking({
          tenant_id: tenant,
          usuarios: usuarios.map((u) => ({ ...u, tenant_id: tenant })),
          lancamentos,
          conclusoes: conclusoesDeTrilhas(tenant, conteudoParaDominio(trilhas).trilhas, conclusoes),
          periodo: ctx.query.periodo,
          data_ref: dataRef,
          escopo,
          perfis: params.perfis_ranking,
          fuso: params.fuso,
        }).map(({ atingiu_em: _a, ...l }) => ({ ...l, eu: l.usuario_id === ctx.usuario.id }));
        const intervalo = intervaloDoPeriodo(ctx.query.periodo, dataRef);
        return {
          periodo: ctx.query.periodo,
          escopo: ctx.query.escopo,
          inicio: intervalo.inicio,
          fim: intervalo.fim,
          data_ref: dataRef,
          calculado_em: ctx.agora().toISOString(),
          linhas,
          minha_linha: linhas.find((l) => l.eu) ?? null,
        };
      }),
  });

  // ---------- painel (RF-TRE-05) ----------
  async function painel(ctx: Parameters<RotaModulo['executar']>[0] & { query: AdesaoQuery }, repo: RepositorioTreinamento) {
    const params = parametrosDoTenant(ctx);
    const [usuarios, trilhas, conclusoes, tentativas, visiveis] = await Promise.all([repo.usuarios(), repo.trilhas(), repo.conclusoesDoTenant(), repo.tentativasDoTenant(), ctx.usuariosVisiveis()]);
    const mes = ctx.query.mes ?? hojeNoTenant(ctx).slice(0, 7);
    const doEscopo = noEscopo(usuarios, visiveis, ctx.query.equipe_id);
    const conteudo = conteudoParaDominio(trilhas);
    const p = painelDeAdesao({ usuarios: doEscopo, trilhas: conteudo.trilhas, quizzes: conteudo.quizzes, conclusoes, tentativas, mes, fuso: params.fuso, nota_que_vale: params.nota_que_vale });
    return { p, mes, trilhas };
  }

  const adesao = rota({
    metodo: 'GET',
    caminho: 'adesao',
    acao: 'adesao.ver',
    carteira: 'nao_se_aplica',
    query: AdesaoQuery,
    executar: (ctx) =>
      comRepositorio(fabrica, ctx, async (repo): Promise<AdesaoResposta> => {
        const { p, mes, trilhas } = await painel(ctx, repo);
        const porId = new Map(trilhas.map((t) => [t.id, t]));
        return {
          mes,
          equipe_id: ctx.query.equipe_id ?? null,
          calculado_em: ctx.agora().toISOString(),
          adesao: { publico: p.adesao.publico, ativos_no_mes: p.adesao.ativos_no_mes, adesao_pct: p.adesao.adesao_pct },
          trilhas: p.trilhas.map((i) => {
            const t = porId.get(i.trilha_id)!;
            return { ...i, titulo: t.titulo, status: t.status, obrigatoria: t.obrigatoria, prazo: t.prazo };
          }),
        };
      }),
  });

  const pessoas = rota({
    metodo: 'GET',
    caminho: 'adesao/pessoas',
    acao: 'notas.ver',
    carteira: 'nao_se_aplica',
    query: AdesaoQuery,
    executar: (ctx) =>
      comRepositorio(fabrica, ctx, async (repo): Promise<PessoasResposta> => {
        const { p, mes } = await painel(ctx, repo);
        return { mes, equipe_id: ctx.query.equipe_id ?? null, calculado_em: ctx.agora().toISOString(), pessoas: p.pessoas };
      }),
  });

  // ---------- BKO de trilhas (RF-TRE-01; doc 03 §2: analista e admin) ----------
  const listar = rota({
    metodo: 'GET',
    caminho: 'bko/trilhas',
    acao: 'trilha.editar',
    carteira: 'nao_se_aplica',
    query: BkoTrilhasQuery,
    executar: (ctx) =>
      comRepositorio(fabrica, ctx, async (repo): Promise<BkoTrilhasResposta> => {
        const busca = ctx.query.busca?.toLocaleLowerCase('pt-BR');
        const itens = (await repo.trilhas())
          .filter((t) => (!ctx.query.status || t.status === ctx.query.status) && (!busca || t.titulo.toLocaleLowerCase('pt-BR').includes(busca)))
          .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : a.id < b.id ? -1 : 1))
          .map(resumo);
        return { itens };
      }),
  });

  const ver = rota({
    metodo: 'GET',
    caminho: 'bko/trilhas/:id',
    acao: 'trilha.editar',
    carteira: 'nao_se_aplica',
    params: IdParams,
    executar: (ctx) => comRepositorio(fabrica, ctx, async (repo) => detalhe(await trilhaOu404(repo, ctx.params.id))),
  });

  const criar = rota({
    metodo: 'POST',
    caminho: 'bko/trilhas',
    acao: 'trilha.criar',
    carteira: 'nao_se_aplica',
    corpo: TrilhaEdicao,
    status: 201,
    executar: (ctx) =>
      comRepositorio(fabrica, ctx, async (repo, tx) => {
        // idempotente pelo id gerado no cliente: repetir o POST devolve a trilha já criada, sem alterar
        const existente = await repo.trilha(ctx.corpo.id);
        if (existente) return detalhe(existente);
        const agora = ctx.agora().toISOString();
        const nova: Trilha = { ...ctx.corpo, tenant_id: ctx.usuario.tenant_id, status: 'rascunho', publicada_em: null, arquivada_em: null, created_at: agora, updated_at: agora };
        await repo.inserirTrilha(nova);
        await tx.auditar({ acao: 'trilha.criar', entidade: 'trilha', entidade_id: nova.id, depois: { status: 'rascunho', modulos: nova.modulos.length } });
        return detalhe({ ...nova, deleted_at: null });
      }),
  });

  const editar = rota({
    metodo: 'PUT',
    caminho: 'bko/trilhas/:id',
    acao: 'trilha.editar',
    carteira: 'nao_se_aplica',
    params: IdParams,
    corpo: TrilhaEdicao,
    executar: (ctx) =>
      comRepositorio(fabrica, ctx, async (repo, tx) => {
        if (ctx.corpo.id !== ctx.params.id) throw new ErroHttpModulo(422, 'ID_DIVERGENTE', 'O id da trilha no corpo é diferente do endereço. Recarregue a página.');
        const atual = await trilhaOu404(repo, ctx.params.id);
        const pode = podeEditarTrilha(atual.status);
        if (!pode.ok) throw erroDeRegra(pode);
        const nova: Trilha = { ...ctx.corpo, tenant_id: atual.tenant_id, status: atual.status, publicada_em: atual.publicada_em, arquivada_em: atual.arquivada_em, created_at: atual.created_at, updated_at: ctx.agora().toISOString() };
        await repo.atualizarTrilha(nova);
        await tx.auditar({ acao: 'trilha.editar', entidade: 'trilha', entidade_id: nova.id, antes: { modulos: atual.modulos.length }, depois: { modulos: nova.modulos.length } });
        return detalhe({ ...nova, deleted_at: null });
      }),
  });

  const mudarStatus = (acao: AcaoStatusTrilha) =>
    rota({
      metodo: 'POST',
      caminho: `bko/trilhas/:id/${acao}`,
      acao: 'trilha.publicar',
      carteira: 'nao_se_aplica',
      params: IdParams,
      executar: (ctx) =>
        comRepositorio(fabrica, ctx, async (repo, tx) => {
          const atual = await trilhaOu404(repo, ctx.params.id);
          const t = transicaoDaTrilha(atual.status, acao);
          if (!t.ok) throw erroDeRegra(t);
          if (!t.mudou) return detalhe(atual);
          if (acao === 'publicar') {
            const problemas = problemasParaPublicar(trilhaParaPublicar(atual));
            if (problemas.length > 0) throw new ErroRegraNegocio('TRILHA_INVALIDA', 'A trilha ainda não pode ser publicada: corrija os pontos indicados.', { regra: 'RF-TRE-01', problemas });
          }
          const agora = ctx.agora().toISOString();
          const nova: Trilha = {
            ...(({ deleted_at: _d, ...x }) => x)(atual),
            status: t.status,
            publicada_em: acao === 'publicar' ? agora : atual.publicada_em,
            arquivada_em: acao === 'arquivar' ? agora : atual.arquivada_em,
            updated_at: agora,
          };
          await repo.atualizarTrilha(nova);
          // RN-AUD-01: só ids e status (nunca dado pessoal)
          await tx.auditar({ acao: `trilha.${acao}`, entidade: 'trilha', entidade_id: nova.id, antes: { status: atual.status }, depois: { status: nova.status } });
          return detalhe({ ...nova, deleted_at: null });
        }),
    });

  return [jornada, ranking, adesao, pessoas, listar, ver, criar, editar, mudarStatus('publicar'), mudarStatus('arquivar')];
}
