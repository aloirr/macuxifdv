/**
 * Provedores de sync do Treinamento (ADR 0009; desenho T-0058).
 *  - push `progresso`: conclusões de lição e tentativas de quiz feitas offline. O servidor revalida tudo com o MESMO
 *    domain do app (`aplicarAtividades`, RN-TRE-04), na ordem do instante do fato, numa transação com a escrita do
 *    aluno serializada; grava o progresso, os lançamentos de XP e as medalhas e publica os eventos na outbox.
 *    Mesmo `id` reenviado = aceito sem efeito (idempotente). A plataforma não confere ação no push: o perfil é
 *    conferido aqui (`licao.concluir` / `quiz.responder`, ADR 0004).
 *  - pull `trilha` (conteúdo publicado do público do aluno, RN-TRE-07) e pull do próprio aluno (`progresso`, `tentativa`,
 *    `xp_lancamento`, `medalha_usuario`; escopo `proprio`, RN-CORE-04).
 */
import { uuidPadrao, type ContextoBase, type DefinicaoEntidadeSync, type ItemPush, type ProvedorSync, type ResultadoItemPush } from '@macuxi/platform-sdk';
import { DEFINICAO_LICAO_CONCLUIDA, DEFINICAO_MEDALHA_CONQUISTADA } from '../contracts/eventos';
import { conteudoParaDominio } from '../contracts/conteudo';
import { entidadeMedalhaUsuario, entidadeProgresso, entidadeTentativa, entidadeTrilha, entidadeXpLancamento, type AtividadeEnvio } from '../contracts/sync';
import { aplicarAtividades, type AtividadeDoAluno, type EstadoDoAluno } from '../domain/atividade';
import { notaQueVale } from '../domain/quiz';
import { usuarioNoPublico } from '../domain/trilha';
import { alunoDaSessao, comRepositorio, parametrosDoTenant, perfilPode } from './comum';
import type { EntidadeDoAluno, FabricaRepositorio } from './repositorio';

const rejeitado = (id: string, codigo: string, mensagem: string): ResultadoItemPush => ({ id, status: 'rejeitado', codigo, mensagem });

function paraAtividade(a: AtividadeEnvio): AtividadeDoAluno {
  return a.tipo === 'licao'
    ? { tipo: 'licao', id: a.id, trilha_id: a.trilha_id, licao_id: a.licao_id, tempo_gasto_seg: a.tempo_gasto_seg, concluida_em: a.concluida_em }
    : { tipo: 'quiz', id: a.id, quiz_id: a.quiz_id, realizada_em: a.realizada_em, respostas: a.respostas };
}

/** Push `progresso`: valida o item (operação, id, perfil) e aplica as atividades válidas pelo domain. */
async function receberAtividades(fabrica: FabricaRepositorio | null, ctx: ContextoBase, itens: readonly ItemPush[]): Promise<ResultadoItemPush[]> {
  const porId = new Map<string, ResultadoItemPush>();
  const validas: AtividadeEnvio[] = [];
  for (const item of itens) {
    const a = item.payload as AtividadeEnvio;
    if (item.operacao === 'remover') porId.set(item.id, rejeitado(item.id, 'SOMENTE_INSERCAO', 'Progresso não é apagado nem editado (RN-TRE-04).'));
    else if (a.id !== item.id) porId.set(item.id, rejeitado(item.id, 'ID_DIVERGENTE', 'O id da atividade é diferente do id do item. Atualize o app.'));
    else if (!perfilPode(a.tipo === 'licao' ? 'licao.concluir' : 'quiz.responder', ctx.usuario.perfil)) {
      porId.set(item.id, rejeitado(item.id, 'PERFIL_SEM_ACESSO', 'Seu perfil não faz trilhas de treinamento.'));
    } else validas.push(a);
  }
  if (validas.length > 0) {
    await comRepositorio(fabrica, ctx, async (repo, tx) => {
      await repo.travarAluno(ctx.usuario.id);
      const params = parametrosDoTenant(ctx);
      // em série: a transação é UMA conexão (o `pg` enfileira e avisa quando duas consultas disputam o mesmo cliente)
      const trilhas = await repo.trilhas();
      const gravado = await repo.estadoDoAluno(ctx.usuario.id);
      const usuarios = await repo.usuarios();
      const estado: EstadoDoAluno = { tenant_id: ctx.usuario.tenant_id, usuario_id: ctx.usuario.id, usuario: alunoDaSessao(ctx, usuarios), ...gravado };
      const conteudo = conteudoParaDominio(trilhas);
      const { estado: final, resultados } = aplicarAtividades(estado, validas.map(paraAtividade), conteudo, { gerarId: uuidPadrao, params });
      for (const { id, resultado: r } of resultados) {
        if (r.status === 'rejeitado') {
          porId.set(id, rejeitado(id, r.codigo, r.mensagem));
          continue;
        }
        porId.set(id, { id, status: 'aceito' });
        if (r.status === 'duplicado') continue;
        await repo.gravarAtividade(ctx.usuario.id, { conclusao: r.conclusao, tentativa: r.tentativa, lancamentos: r.lancamentos, conquistas: r.conquistas.map(({ nome: _n, ...c }) => c) });
        if (r.conclusao) {
          const quizId = conteudo.trilhas.find((t) => t.id === r.conclusao!.trilha_id)?.modulos.flatMap((m) => m.licoes).find((l) => l.id === r.conclusao!.licao_id)?.quiz_id ?? null;
          const notas = quizId ? final.tentativas.filter((t) => t.quiz_id === quizId) : [];
          await tx.publicar(
            DEFINICAO_LICAO_CONCLUIDA,
            {
              progresso_id: r.conclusao.id,
              tenant_id: ctx.usuario.tenant_id,
              usuario_id: ctx.usuario.id,
              trilha_id: r.conclusao.trilha_id,
              licao_id: r.conclusao.licao_id,
              concluida_em: r.conclusao.concluida_em,
              tempo_gasto_seg: r.conclusao.tempo_gasto_seg,
              nota_quiz_pct: notaQueVale(notas, params.nota_que_vale),
              xp_ganho: r.xp_ganho,
              trilha_concluida: r.trilha_concluida,
            },
            ctx.usuario.id,
          );
        }
        for (const c of r.conquistas) {
          await tx.publicar(
            DEFINICAO_MEDALHA_CONQUISTADA,
            { medalha_usuario_id: c.id, tenant_id: ctx.usuario.tenant_id, usuario_id: ctx.usuario.id, medalha_codigo: c.medalha_codigo, nome: c.nome, conquistada_em: c.conquistada_em },
            ctx.usuario.id,
          );
        }
      }
    });
  }
  return itens.map((i) => porId.get(i.id)!);
}

function provedorDoAluno(fabrica: FabricaRepositorio, entidade: DefinicaoEntidadeSync, nome: EntidadeDoAluno): ProvedorSync {
  return { entidade, escopo: 'proprio', puxar: (ctx, p) => comRepositorio(fabrica, ctx, (repo) => repo.linhasDoAluno(nome, ctx.usuario.id, p)) };
}

/** Provedores com a fábrica do repositório (sem fábrica, o módulo não serve sync: o aparelho guarda a fila). */
export function criarProvedoresSync(fabrica: FabricaRepositorio): ProvedorSync[] {
  return [
    {
      entidade: entidadeTrilha,
      escopo: 'proprio',
      // RN-TRE-07: só trilhas publicadas ou arquivadas do público do aluno; quem não estuda (BKO) não baixa conteúdo
      puxar: async (ctx, p) => {
        if (!perfilPode('trilha.baixar_offline', ctx.usuario.perfil)) return [];
        return comRepositorio(fabrica, ctx, async (repo) => {
          const trilhas = await repo.trilhasDesde(p);
          const usuarios = await repo.usuarios();
          const aluno = alunoDaSessao(ctx, usuarios);
          return trilhas.filter((t) => t.deleted_at !== null || (t.status !== 'rascunho' && usuarioNoPublico(t.publico_alvo, aluno)));
        });
      },
    },
    { entidade: entidadeProgresso, escopo: 'proprio', puxar: (ctx, p) => comRepositorio(fabrica, ctx, (repo) => repo.linhasDoAluno('progresso', ctx.usuario.id, p)), receber: (ctx, itens) => receberAtividades(fabrica, ctx, itens) },
    provedorDoAluno(fabrica, entidadeTentativa, 'tentativa'),
    provedorDoAluno(fabrica, entidadeXpLancamento, 'xp_lancamento'),
    provedorDoAluno(fabrica, entidadeMedalhaUsuario, 'medalha_usuario'),
  ];
}
