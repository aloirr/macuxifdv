/**
 * Painel de adesão do gestor/BKO (RF-TRE-05) e base de conclusões de trilha do ranking (RN-TRE-03).
 * Os usuários chegam já filtrados pelo escopo do perfil (RN-CORE-04: supervisor = equipe, gerente = equipes abaixo,
 * analista/admin = tenant); aqui só se calcula.
 */
import { localDate } from '@macuxi/comum';
import type { QuizDef } from './atividade';
import { adesaoDoMes, conclusaoDaTrilha, publicoDaTrilha, type AdesaoDoMes } from './adesao';
import { arredondar, instanteMs } from './numeros';
import type { NotaQueVale } from './parametros';
import { notaQueVale } from './quiz';
import type { ConclusaoTrilha } from './ranking';
import { licoesOrdenadas, trilhaConcluida, usuarioNoPublico, type TrilhaDef } from './trilha';

export interface ConclusaoDoUsuario {
  usuario_id: string;
  trilha_id: string;
  licao_id: string;
  concluida_em: string;
}

export interface TentativaDoUsuario {
  usuario_id: string;
  quiz_id: string;
  realizada_em: string;
  nota_pct: number;
  aprovada: boolean;
}

export interface UsuarioDoPainel {
  id: string;
  nome: string;
  perfil: string;
  equipe_id: string | null;
  ativo: boolean;
}

/**
 * RN-TRE-03: uma linha por (usuário, trilha) concluída, no instante da lição que completou a trilha (a mais tardia das
 * lições da trilha). Lição repetida conta uma vez; lição que não é da trilha é ignorada.
 */
export function conclusoesDeTrilhas(tenantId: string, trilhas: readonly TrilhaDef[], conclusoes: readonly ConclusaoDoUsuario[]): ConclusaoTrilha[] {
  const out: ConclusaoTrilha[] = [];
  const usuarios = [...new Set(conclusoes.map((c) => c.usuario_id))].sort();
  for (const t of trilhas) {
    const ids = new Set(licoesOrdenadas(t).map((l) => l.id));
    for (const u of usuarios) {
      const minhas = conclusoes.filter((c) => c.usuario_id === u && c.trilha_id === t.id && ids.has(c.licao_id));
      if (!trilhaConcluida(t, minhas.map((c) => c.licao_id))) continue;
      const primeiraDeCada = new Map<string, string>();
      for (const c of minhas) {
        const atual = primeiraDeCada.get(c.licao_id);
        if (!atual || instanteMs(c.concluida_em) < instanteMs(atual)) primeiraDeCada.set(c.licao_id, c.concluida_em);
      }
      const fim = [...primeiraDeCada.values()].reduce((m, x) => (instanteMs(x) > instanteMs(m) ? x : m));
      out.push({ tenant_id: tenantId, usuario_id: u, trilha_id: t.id, concluida_em: fim });
    }
  }
  return out;
}

export interface IndicadorTrilha {
  trilha_id: string;
  publico: number;
  concluiram: number;
  conclusao_pct: number | null;
  /** Média das notas que valem (por pessoa e quiz) do público, nos quizzes da trilha; null sem tentativas. */
  nota_media_pct: number | null;
}

export interface PessoaDoPainel {
  usuario_id: string;
  nome: string;
  perfil: string;
  equipe_id: string | null;
  licoes_no_mes: number;
  trilhas_concluidas: number;
  obrigatorias_pendentes: number;
  nota_media_pct: number | null;
  ultima_atividade_em: string | null;
}

export interface PainelDeAdesao {
  adesao: AdesaoDoMes;
  trilhas: IndicadorTrilha[];
  pessoas: PessoaDoPainel[];
}

const media = (xs: readonly number[]): number | null => (xs.length === 0 ? null : arredondar(xs.reduce((s, x) => s + x, 0) / xs.length));

/** Notas que valem (decisão 31/10: melhor ou última) de um usuário em cada quiz do conjunto. */
function notasQueValem(tentativas: readonly TentativaDoUsuario[], usuarioId: string, quizIds: ReadonlySet<string>, modo: NotaQueVale): number[] {
  const porQuiz = new Map<string, TentativaDoUsuario[]>();
  for (const t of tentativas) if (t.usuario_id === usuarioId && quizIds.has(t.quiz_id)) porQuiz.set(t.quiz_id, [...(porQuiz.get(t.quiz_id) ?? []), t]);
  return [...porQuiz.values()].map((ts) => notaQueVale(ts, modo)!);
}

/**
 * RF-TRE-05: adesão do mês (pessoas do escopo que estão no público de alguma trilha publicada), conclusão e nota média
 * por trilha (publicadas e arquivadas; rascunho fica de fora) e uma linha por pessoa ativa do escopo, em ordem de nome.
 */
export function painelDeAdesao(e: {
  usuarios: readonly UsuarioDoPainel[];
  trilhas: readonly TrilhaDef[];
  quizzes: readonly QuizDef[];
  conclusoes: readonly ConclusaoDoUsuario[];
  tentativas: readonly TentativaDoUsuario[];
  mes: string;
  fuso: string;
  nota_que_vale: NotaQueVale;
}): PainelDeAdesao {
  const ativos = e.usuarios.filter((u) => u.ativo);
  const visiveis = e.trilhas.filter((t) => t.status !== 'rascunho');
  const publicadas = visiveis.filter((t) => t.status === 'publicada');
  const publicoGeral = ativos.filter((u) => publicadas.some((t) => usuarioNoPublico(t.publico_alvo, u))).map((u) => u.id);
  const conclusoesTrilha = conclusoesDeTrilhas('', visiveis, e.conclusoes);

  const trilhas = visiveis.map((t): IndicadorTrilha => {
    const publico = publicoDaTrilha(t, ativos);
    const concl = conclusaoDaTrilha(publico, conclusoesTrilha.filter((c) => c.trilha_id === t.id).map((c) => c.usuario_id));
    const quizIds = new Set(e.quizzes.filter((q) => q.trilha_id === t.id).map((q) => q.id));
    const notas = publico.flatMap((u) => notasQueValem(e.tentativas, u, quizIds, e.nota_que_vale));
    return { trilha_id: t.id, ...concl, nota_media_pct: media(notas) };
  });

  const todosQuizzes = new Set(e.quizzes.map((q) => q.id));
  const pessoas = [...ativos]
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }) || (a.id < b.id ? -1 : 1))
    .map((u): PessoaDoPainel => {
      const minhas = e.conclusoes.filter((c) => c.usuario_id === u.id);
      const instantes = [...minhas.map((c) => c.concluida_em), ...e.tentativas.filter((t) => t.usuario_id === u.id).map((t) => t.realizada_em)];
      const concluidas = new Set(conclusoesTrilha.filter((c) => c.usuario_id === u.id).map((c) => c.trilha_id));
      return {
        usuario_id: u.id,
        nome: u.nome,
        perfil: u.perfil,
        equipe_id: u.equipe_id,
        licoes_no_mes: minhas.filter((c) => localDate(new Date(c.concluida_em), e.fuso).slice(0, 7) === e.mes).length,
        trilhas_concluidas: concluidas.size,
        obrigatorias_pendentes: publicadas.filter((t) => t.obrigatoria && usuarioNoPublico(t.publico_alvo, u) && !concluidas.has(t.id)).length,
        nota_media_pct: media(notasQueValem(e.tentativas, u.id, todosQuizzes, e.nota_que_vale)),
        ultima_atividade_em: instantes.length === 0 ? null : instantes.reduce((m, x) => (instanteMs(x) > instanteMs(m) ? x : m)),
      };
    });

  return { adesao: adesaoDoMes({ publico: publicoGeral, conclusoes: e.conclusoes, mes: e.mes, fuso: e.fuso }), trilhas, pessoas };
}
