/**
 * Rotas do construtor no BKO (`/v1/pesquisa/questionarios*`; RF-PES-01/02/05, RN-PES-01, RN-AUD-01).
 * O `createApp` aplica login, licença do módulo, perfil/ação do manifesto e Zod (regra 6); aqui só a regra do domain
 * revalidada e a gravação. Questionário não tem cliente: escopo de carteira `nao_se_aplica`.
 */
import type { ContextoRota, RotaModulo } from '@macuxi/platform-sdk';
import {
  CriarQuestionarioRequest,
  ListaQuestionariosQuery,
  ParamsQuestionario,
  QuestionarioVersao,
  SalvarRascunhoRequest,
  type ListaQuestionarios,
  type PublicarResponse,
  type QuestionarioDetalhe,
} from '../contracts';
import { criarPrimeiraVersao, editarRascunho, filtrarResumos, iniciarEdicao, publicarVersao, resumirQuestionario, validarVersao, type ParametrosPesquisa } from '../domain';
import { comRepositorio, conflito, naoEncontrado, novoUuid, parametrosDaRota, recusar } from './comum';
import type { FabricaRepositorio, QuestionarioCarregado, RepositorioPesquisa } from './repositorio';

/** Doc 03 §2 + RF-PES-06: quem vê a lista/detalhe dos questionários (cadastro e gestão dos resultados). */
export const PERFIS_LEITURA_BKO = ['supervisor', 'gerente', 'analista', 'admin'] as const;

type Ctx<C = unknown, Q = unknown, P = unknown> = ContextoRota<C, Q, P>;

async function detalhe(repo: RepositorioPesquisa, c: QuestionarioCarregado, parametros: ParametrosPesquisa): Promise<QuestionarioDetalhe> {
  const rascunho = c.versoes.find((v) => v.status === 'rascunho') ?? null;
  return {
    questionario: c.questionario,
    versoes: c.versoes,
    validacao_rascunho: rascunho ? validarVersao(rascunho, parametros) : null,
    respostas: await repo.contarRespostas(c.questionario.id),
  };
}

export function rotasDoConstrutor(fabrica: FabricaRepositorio): RotaModulo[] {
  const listar: RotaModulo = {
    metodo: 'GET',
    caminho: 'questionarios',
    perfis: [...PERFIS_LEITURA_BKO],
    carteira: 'nao_se_aplica',
    query: ListaQuestionariosQuery,
    async executar(ctx: Ctx): Promise<ListaQuestionarios> {
      const q = ctx.query as ListaQuestionariosQuery;
      const todos = await comRepositorio(ctx, fabrica, (repo) => repo.listarQuestionarios());
      const resumos = todos.filter((c) => c.versoes.length > 0).map((c) => resumirQuestionario(c.questionario, c.versoes, { respostas: c.respostas, atualizado_em: c.atualizado_em }));
      return { itens: filtrarResumos(resumos, q) };
    },
  };

  const ver: RotaModulo = {
    metodo: 'GET',
    caminho: 'questionarios/:id',
    perfis: [...PERFIS_LEITURA_BKO],
    carteira: 'nao_se_aplica',
    params: ParamsQuestionario,
    async executar(ctx: Ctx): Promise<QuestionarioDetalhe> {
      const { id } = ctx.params as { id: string };
      const parametros = parametrosDaRota(ctx);
      return comRepositorio(ctx, fabrica, async (repo) => {
        const c = await repo.carregar(id);
        if (!c) return naoEncontrado();
        return detalhe(repo, c, parametros);
      });
    },
  };

  /** RF-PES-01: cria o questionário com a v1 em rascunho. Mesmo `id` de novo = devolve o que já existe (idempotente). */
  const criar: RotaModulo = {
    metodo: 'POST',
    caminho: 'questionarios',
    acao: 'questionario.criar',
    carteira: 'nao_se_aplica',
    corpo: CriarQuestionarioRequest,
    status: 201,
    async executar(ctx: Ctx): Promise<QuestionarioDetalhe> {
      const corpo = ctx.corpo as CriarQuestionarioRequest;
      const agora = ctx.agora().toISOString();
      const parametros = parametrosDaRota(ctx);
      const id = corpo.id ?? novoUuid();
      return comRepositorio(ctx, fabrica, async (repo, tx) => {
        const ja = await repo.carregar(id);
        if (ja) return detalhe(repo, ja, parametros);
        const primeira = { ...criarPrimeiraVersao({ id: novoUuid(), questionario_id: id, tenant_id: ctx.usuario.tenant_id, titulo: corpo.titulo, agora }), ...(corpo.descricao ? { descricao: corpo.descricao } : {}), ...(corpo.modo ? { modo: corpo.modo } : {}) };
        const questionario = { id, tenant_id: ctx.usuario.tenant_id, criado_em: agora, arquivado_em: null };
        await repo.criarQuestionario(questionario, primeira, agora);
        await tx.auditar({ acao: 'questionario.criar', entidade: 'questionario', entidade_id: id, depois: { versao_id: primeira.id, numero: 1, status: 'rascunho' } });
        return detalhe(repo, (await repo.carregar(id))!, parametros);
      });
    },
  };

  /**
   * RF-PES-05 / RN-PES-01: grava o rascunho. Sem rascunho aberto, abre a próxima versão a partir da mais nova
   * (`iniciarEdicao`, ids de pergunta/opção mantidos) — a publicada nunca muda.
   */
  const salvarRascunho: RotaModulo = {
    metodo: 'PUT',
    caminho: 'questionarios/:id/rascunho',
    acao: 'questionario.editar',
    carteira: 'nao_se_aplica',
    params: ParamsQuestionario,
    corpo: SalvarRascunhoRequest,
    async executar(ctx: Ctx): Promise<QuestionarioDetalhe> {
      const { id } = ctx.params as { id: string };
      const alteracoes = ctx.corpo as SalvarRascunhoRequest;
      const agora = ctx.agora().toISOString();
      const parametros = parametrosDaRota(ctx);
      return comRepositorio(ctx, fabrica, async (repo, tx) => {
        const c = await repo.carregar(id);
        if (!c) return naoEncontrado();
        if (c.questionario.arquivado_em !== null) recusar('QUESTIONARIO_ARQUIVADO', 'Este questionário está arquivado e não pode ser editado.');
        const ed = iniciarEdicao(c.versoes, { novo_id: novoUuid(), agora });
        if (!ed.ok) return recusar(ed.codigo, ed.mensagem);
        const r = editarRascunho(ed.valor.versao, alteracoes);
        if (!r.ok) return recusar(r.codigo, r.mensagem);
        const forma = QuestionarioVersao.safeParse(r.valor);
        if (!forma.success) {
          const i = forma.error.issues[0]!;
          return recusar('RASCUNHO_INVALIDO', `Não foi possível salvar o rascunho: ${i.message}`, forma.error.issues.map((x) => ({ caminho: x.path.join('.'), mensagem: x.message })));
        }
        await repo.gravarVersao(forma.data, agora);
        if (ed.valor.criada) await tx.auditar({ acao: 'questionario.editar', entidade: 'questionario_versao', entidade_id: forma.data.id, depois: { numero: forma.data.numero, status: 'rascunho' } });
        return detalhe(repo, (await repo.carregar(id))!, parametros);
      });
    },
  };

  /** RN-PES-01 / RN-AUD-01: publica o rascunho (valida, congela) e audita na mesma transação. */
  const publicar: RotaModulo = {
    metodo: 'POST',
    caminho: 'questionarios/:id/publicar',
    acao: 'questionario.publicar',
    carteira: 'nao_se_aplica',
    params: ParamsQuestionario,
    async executar(ctx: Ctx): Promise<PublicarResponse> {
      const { id } = ctx.params as { id: string };
      const agora = ctx.agora().toISOString();
      const parametros = parametrosDaRota(ctx);
      return comRepositorio(ctx, fabrica, async (repo, tx) => {
        const c = await repo.carregar(id);
        if (!c) return naoEncontrado();
        if (c.questionario.arquivado_em !== null) recusar('QUESTIONARIO_ARQUIVADO', 'Este questionário está arquivado. Crie um novo para publicar.');
        const rascunho = c.versoes.find((v) => v.status === 'rascunho');
        if (!rascunho) return conflito('SEM_RASCUNHO', 'Não há rascunho para publicar: a versão mais nova já está publicada. Edite o questionário para criar uma nova versão.');
        const p = publicarVersao(rascunho, { agora, publicado_por: ctx.usuario.id, outras_versoes: c.versoes, parametros });
        if (!p.ok) return recusar(p.codigo, p.mensagem, p.detalhes);
        await repo.gravarVersao(p.valor, agora);
        await tx.auditar({
          acao: 'questionario.publicar',
          entidade: 'questionario_versao',
          entidade_id: p.valor.id,
          antes: { status: 'rascunho', numero: rascunho.numero },
          depois: { status: 'publicada', numero: p.valor.numero, publicada_em: agora, modo: p.valor.modo, frequencia: p.valor.frequencia },
        });
        return { versao: p.valor, avisos: validarVersao(p.valor, parametros).avisos };
      });
    },
  };

  /** RF-PES-05: arquiva (deixa de ser oferecido; respostas ficam). Idempotente; auditado. */
  const arquivar: RotaModulo = {
    metodo: 'POST',
    caminho: 'questionarios/:id/arquivar',
    acao: 'questionario.arquivar',
    carteira: 'nao_se_aplica',
    params: ParamsQuestionario,
    async executar(ctx: Ctx): Promise<QuestionarioDetalhe> {
      const { id } = ctx.params as { id: string };
      const agora = ctx.agora().toISOString();
      const parametros = parametrosDaRota(ctx);
      return comRepositorio(ctx, fabrica, async (repo, tx) => {
        const c = await repo.carregar(id);
        if (!c) return naoEncontrado();
        if (c.questionario.arquivado_em === null) {
          await repo.arquivar(id, agora);
          await tx.auditar({ acao: 'questionario.arquivar', entidade: 'questionario', entidade_id: id, antes: { arquivado: false }, depois: { arquivado: true } });
        }
        return detalhe(repo, (await repo.carregar(id))!, parametros);
      });
    },
  };

  return [listar, ver, criar, salvarRascunho, publicar, arquivar];
}
