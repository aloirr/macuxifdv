/**
 * Atividade do aluno e resumo da jornada (RN-TRE-01, 02, 04, 05, 06, 07; RF-TRE-01 a 03).
 *
 * A MESMA função roda no app (prévia offline: o aluno vê XP, nível e medalha na hora, sobre as linhas do pull e a fila
 * do aparelho) e na API (revalidação do que o aparelho enviou, RN-TRE-04). Recebe o estado do aluno e o conteúdo
 * (trilhas e quizzes) e devolve o novo estado e o que gravar — nada é editado nem apagado (append-only).
 */
import { localDate } from '@macuxi/comum';
import { avaliarMedalhas, medalhasPadrao, type Medalha } from './medalhas';
import { nivelDoXp, type NivelDoXp } from './niveis';
import { instanteMs } from './numeros';
import { PARAMETROS_PADRAO, type ParametrosTreinamento } from './parametros';
import { concluirLicao, registrarTentativaQuiz } from './progresso';
import { quizAprovado, type CorrecaoQuiz, type QuestaoDef, type RespostaQuestao } from './quiz';
import { diasComAtividade, maiorSequencia, sequenciaAtual } from './streak';
import { progressoDaTrilha, proximaLicao, statusDaLicao, trilhaConcluida, trilhasDisponiveis, trilhasPendentes, usuarioNoPublico, type TrilhaDef, type UsuarioPublico } from './trilha';
import { saldoXp, xpDoDia, type LancamentoXp } from './xp';

/** Quiz de uma lição: as questões com as alternativas corretas (corrigir offline e revalidar no servidor). */
export interface QuizDef {
  id: string;
  trilha_id: string;
  licao_id: string;
  questoes: readonly QuestaoDef[];
}

/** Conteúdo que o aluno enxerga. Na API vão TODAS as trilhas do tenant (arquivadas inclusive: contam na medalha). */
export interface ConteudoDoAluno {
  trilhas: readonly TrilhaDef[];
  quizzes: readonly QuizDef[];
}

export interface ConclusaoDoAluno {
  id: string;
  trilha_id: string;
  licao_id: string;
  tempo_gasto_seg: number;
  concluida_em: string;
}

export interface TentativaDoAluno {
  id: string;
  quiz_id: string;
  realizada_em: string;
  respostas: readonly RespostaQuestao[];
  acertos: number;
  total_questoes: number;
  nota_pct: number;
  aprovada: boolean;
  primeira_tentativa: boolean;
  /** RN-TRE-05: respondida até o fim (toda questão com alternativa marcada) — só assim conta para o streak. */
  finalizada: boolean;
}

export interface ConquistaDoAluno {
  id: string;
  medalha_codigo: string;
  conquistada_em: string;
}

/** Tudo o que já está gravado para o aluno (servidor) ou guardado no aparelho (pull + fila). */
export interface EstadoDoAluno {
  tenant_id: string;
  usuario_id: string;
  usuario: UsuarioPublico;
  conclusoes: readonly ConclusaoDoAluno[];
  tentativas: readonly TentativaDoAluno[];
  lancamentos: readonly LancamentoXp[];
  conquistas: readonly ConquistaDoAluno[];
}

export const estadoVazio = (tenant_id: string, usuario_id: string, usuario: UsuarioPublico): EstadoDoAluno => ({
  tenant_id,
  usuario_id,
  usuario,
  conclusoes: [],
  tentativas: [],
  lancamentos: [],
  conquistas: [],
});

/** O que o aparelho envia (o `id` é o UUID do aparelho: reenvio não duplica). */
export type AtividadeDoAluno =
  | { tipo: 'licao'; id: string; trilha_id: string; licao_id: string; tempo_gasto_seg: number; concluida_em: string }
  | { tipo: 'quiz'; id: string; quiz_id: string; realizada_em: string; respostas: readonly RespostaQuestao[] };

export type CodigoAtividade =
  | 'LICAO_DESCONHECIDA'
  | 'TRILHA_NAO_PUBLICADA'
  | 'LICAO_BLOQUEADA'
  | 'TEMPO_MINIMO'
  | 'QUIZ_PENDENTE'
  | 'FORA_DO_PUBLICO'
  | 'QUIZ_DESCONHECIDO'
  | 'RESPOSTA_INVALIDA'
  | 'LIMITE_DIARIO'
  | 'INTERVALO_MINIMO';

/** Conquista nova, com o nome para a celebração e para o evento `treinamento.medalha.conquistada@1`. */
export type ConquistaNova = ConquistaDoAluno & { nome: string };

export type ResultadoAtividade =
  | {
      status: 'aceito';
      tipo: 'licao' | 'quiz';
      conclusao: ConclusaoDoAluno | null;
      tentativa: TentativaDoAluno | null;
      correcao: CorrecaoQuiz | null;
      lancamentos: LancamentoXp[];
      conquistas: ConquistaNova[];
      xp_ganho: number;
      trilha_concluida: boolean;
      /** Celebração discreta ao subir de nível (RN-TRE-06). */
      nivel_antes: number;
      nivel_depois: number;
    }
  | { status: 'duplicado' }
  | { status: 'rejeitado'; codigo: CodigoAtividade; regra: string; mensagem: string; proxima_em?: string };

export interface OpcoesAtividade {
  /** Gera o UUID de cada lançamento e conquista criados. */
  gerarId: () => string;
  params?: ParametrosTreinamento;
  /** Catálogo de medalhas do tenant; padrão = `medalhasPadrao(streak_medalha_dias)` (RF-TRE-03). */
  catalogo?: readonly Medalha[];
}

const rejeitar = (codigo: CodigoAtividade, regra: string, mensagem: string, proxima_em?: string): ResultadoAtividade => ({
  status: 'rejeitado',
  codigo,
  regra,
  mensagem,
  ...(proxima_em ? { proxima_em } : {}),
});

const FORA_DO_PUBLICO = 'Esta trilha não é para o seu perfil ou equipe. Atualize o app para ver as suas trilhas.';
const QUIZ_DESCONHECIDO = 'Este quiz não faz mais parte das suas trilhas. Atualize o app e escolha outra lição.';

/** RN-TRE-05: instantes que contam para o streak — lição concluída e quiz respondido até o fim. */
export function instantesQueContam(estado: Pick<EstadoDoAluno, 'conclusoes' | 'tentativas'>): string[] {
  return [...estado.conclusoes.map((c) => c.concluida_em), ...estado.tentativas.filter((t) => t.finalizada).map((t) => t.realizada_em)];
}

const concluidasDaTrilha = (estado: EstadoDoAluno, trilhaId: string): string[] => estado.conclusoes.filter((c) => c.trilha_id === trilhaId).map((c) => c.licao_id);

const xpDoAluno = (estado: EstadoDoAluno): number => saldoXp(estado.lancamentos, estado.usuario_id);

/** RF-TRE-03: medalhas que o novo estado conquista (nunca em duplicidade). */
function novasConquistas(estado: EstadoDoAluno, conteudo: ConteudoDoAluno, instante: string, opcoes: OpcoesAtividade, params: ParametrosTreinamento): ConquistaNova[] {
  const catalogo = opcoes.catalogo ?? medalhasPadrao(params.streak_medalha_dias);
  const notas = estado.tentativas.map((t) => t.nota_pct);
  const novas = avaliarMedalhas(
    catalogo,
    {
      trilhas_concluidas: conteudo.trilhas.filter((t) => trilhaConcluida(t, concluidasDaTrilha(estado, t.id))).length,
      melhor_nota_pct: notas.length > 0 ? Math.max(...notas) : null,
      maior_sequencia_dias: maiorSequencia(diasComAtividade(instantesQueContam(estado), params.fuso)),
    },
    estado.conquistas.map((c) => c.medalha_codigo),
  );
  return novas.map((m) => ({ id: opcoes.gerarId(), medalha_codigo: m.codigo, nome: m.nome, conquistada_em: instante }));
}

/**
 * Aplica UMA atividade do aluno (conclusão de lição ou tentativa de quiz) sobre o estado. Ordem das checagens:
 * mesmo `id` já gravado → `duplicado` (RN-TRE-04) → conteúdo conhecido (RF-TRE-01) → público-alvo (RN-TRE-07) → regras
 * de `concluirLicao` / `registrarTentativaQuiz` (RN-TRE-01/02/04/05) → medalhas (RF-TRE-03).
 */
export function aplicarAtividade(
  estado: EstadoDoAluno,
  atividade: AtividadeDoAluno,
  conteudo: ConteudoDoAluno,
  opcoes: OpcoesAtividade,
): { estado: EstadoDoAluno; resultado: ResultadoAtividade } {
  const params = opcoes.params ?? { ...PARAMETROS_PADRAO };
  const igual = (r: ResultadoAtividade) => ({ estado, resultado: r });
  if (estado.conclusoes.some((c) => c.id === atividade.id) || estado.tentativas.some((t) => t.id === atividade.id)) return igual({ status: 'duplicado' });
  const base = { tenant_id: estado.tenant_id, usuario_id: estado.usuario_id, atividades: instantesQueContam(estado), lancamentos: estado.lancamentos, gerarId: opcoes.gerarId, params };
  const nivelAntes = nivelDoXp(xpDoAluno(estado), params.niveis_xp_min).nivel;

  if (atividade.tipo === 'licao') {
    const trilha = conteudo.trilhas.find((t) => t.id === atividade.trilha_id);
    if (!trilha) return igual(rejeitar('LICAO_DESCONHECIDA', 'RF-TRE-01', 'Essa lição não faz mais parte da trilha. Atualize o app e escolha outra lição.'));
    const concluidas = concluidasDaTrilha(estado, trilha.id);
    if (concluidas.includes(atividade.licao_id)) return igual({ status: 'duplicado' });
    if (!usuarioNoPublico(trilha.publico_alvo, estado.usuario)) return igual(rejeitar('FORA_DO_PUBLICO', 'RN-TRE-07', FORA_DO_PUBLICO));
    const quizDaLicao = trilha.modulos.flatMap((m) => m.licoes).find((l) => l.id === atividade.licao_id)?.quiz_id ?? null;
    const r = concluirLicao({
      ...base,
      licao_id: atividade.licao_id,
      tempo_gasto_seg: atividade.tempo_gasto_seg,
      concluida_em: atividade.concluida_em,
      trilha,
      concluidas,
      quiz_aprovado: quizDaLicao !== null && quizAprovado(estado.tentativas.filter((t) => t.quiz_id === quizDaLicao)),
    });
    if (r.resultado === 'duplicado') return igual({ status: 'duplicado' });
    if (r.resultado === 'rejeitado') return igual(rejeitar(r.codigo, r.regra, r.mensagem));
    const conclusao: ConclusaoDoAluno = { id: atividade.id, trilha_id: trilha.id, licao_id: atividade.licao_id, tempo_gasto_seg: atividade.tempo_gasto_seg, concluida_em: atividade.concluida_em };
    const parcial: EstadoDoAluno = { ...estado, conclusoes: [...estado.conclusoes, conclusao], lancamentos: [...estado.lancamentos, ...r.lancamentos] };
    const conquistas = novasConquistas(parcial, conteudo, atividade.concluida_em, opcoes, params);
    const novo: EstadoDoAluno = { ...parcial, conquistas: [...parcial.conquistas, ...conquistas.map(({ nome: _n, ...c }) => c)] };
    return {
      estado: novo,
      resultado: {
        status: 'aceito',
        tipo: 'licao',
        conclusao,
        tentativa: null,
        correcao: null,
        lancamentos: r.lancamentos,
        conquistas,
        xp_ganho: r.xp_ganho,
        trilha_concluida: r.trilha_concluida,
        nivel_antes: nivelAntes,
        nivel_depois: nivelDoXp(xpDoAluno(novo), params.niveis_xp_min).nivel,
      },
    };
  }

  const quiz = conteudo.quizzes.find((q) => q.id === atividade.quiz_id);
  const trilha = quiz && conteudo.trilhas.find((t) => t.id === quiz.trilha_id);
  if (!quiz || !trilha) return igual(rejeitar('QUIZ_DESCONHECIDO', 'RF-TRE-01', QUIZ_DESCONHECIDO));
  if (trilha.status !== 'publicada') return igual(rejeitar('TRILHA_NAO_PUBLICADA', 'RF-TRE-01', 'Essa trilha não está mais publicada. Atualize o app para ver as trilhas disponíveis.'));
  if (!usuarioNoPublico(trilha.publico_alvo, estado.usuario)) return igual(rejeitar('FORA_DO_PUBLICO', 'RN-TRE-07', FORA_DO_PUBLICO));
  if (statusDaLicao(trilha, quiz.licao_id, concluidasDaTrilha(estado, trilha.id)).status === 'bloqueada') {
    return igual(rejeitar('LICAO_BLOQUEADA', 'RF-TRE-01', 'Conclua as lições anteriores da trilha antes de fazer este quiz.'));
  }
  const ids = new Set(quiz.questoes.map((q) => q.id));
  const vistas = new Set<string>();
  for (const r of atividade.respostas) {
    if (!ids.has(r.questao_id) || vistas.has(r.questao_id)) return igual(rejeitar('RESPOSTA_INVALIDA', 'RN-TRE-02', 'As respostas não batem com as questões deste quiz. Atualize o app e responda de novo.'));
    vistas.add(r.questao_id);
  }
  const anteriores = estado.tentativas.filter((t) => t.quiz_id === quiz.id);
  const r = registrarTentativaQuiz({ ...base, quiz_id: quiz.id, questoes: quiz.questoes, respostas: atividade.respostas, realizada_em: atividade.realizada_em, anteriores });
  if (r.resultado === 'recusada') return igual(rejeitar(r.motivo, r.regra, r.mensagem, r.proxima_em));
  const tentativa: TentativaDoAluno = {
    id: atividade.id,
    quiz_id: quiz.id,
    realizada_em: atividade.realizada_em,
    respostas: atividade.respostas,
    acertos: r.correcao.acertos,
    total_questoes: r.correcao.total,
    nota_pct: r.correcao.nota_pct,
    aprovada: r.aprovada,
    primeira_tentativa: r.primeira_tentativa,
    finalizada: r.quiz_finalizado,
  };
  const parcial: EstadoDoAluno = { ...estado, tentativas: [...estado.tentativas, tentativa], lancamentos: [...estado.lancamentos, ...r.lancamentos] };
  const conquistas = novasConquistas(parcial, conteudo, atividade.realizada_em, opcoes, params);
  const novo: EstadoDoAluno = { ...parcial, conquistas: [...parcial.conquistas, ...conquistas.map(({ nome: _n, ...c }) => c)] };
  return {
    estado: novo,
    resultado: {
      status: 'aceito',
      tipo: 'quiz',
      conclusao: null,
      tentativa,
      correcao: r.correcao,
      lancamentos: r.lancamentos,
      conquistas,
      xp_ganho: r.xp_ganho,
      trilha_concluida: false,
      nivel_antes: nivelAntes,
      nivel_depois: nivelDoXp(xpDoAluno(novo), params.niveis_xp_min).nivel,
    },
  };
}

const instanteDa = (a: AtividadeDoAluno): string => (a.tipo === 'licao' ? a.concluida_em : a.realizada_em);

/**
 * RN-TRE-04: aplica um lote (push do aparelho ou fila local) na ordem do INSTANTE do fato (empate: ordem de chegada),
 * para que o quiz feito antes libere a lição enviada depois e o teto diário valha para o que aconteceu primeiro.
 * Devolve os resultados na ordem de entrada.
 */
export function aplicarAtividades(
  estado: EstadoDoAluno,
  atividades: readonly AtividadeDoAluno[],
  conteudo: ConteudoDoAluno,
  opcoes: OpcoesAtividade,
): { estado: EstadoDoAluno; resultados: { id: string; resultado: ResultadoAtividade }[] } {
  const ordem = atividades.map((a, i) => ({ a, i })).sort((x, y) => instanteMs(instanteDa(x.a)) - instanteMs(instanteDa(y.a)) || x.i - y.i);
  const porIndice = new Map<number, ResultadoAtividade>();
  let atual = estado;
  for (const { a, i } of ordem) {
    const r = aplicarAtividade(atual, a, conteudo, opcoes);
    atual = r.estado;
    porIndice.set(i, r.resultado);
  }
  return { estado: atual, resultados: atividades.map((a, i) => ({ id: a.id, resultado: porIndice.get(i)! })) };
}

export interface TrilhaNaJornada {
  trilha_id: string;
  obrigatoria: boolean;
  prazo: string | null;
  atrasada: boolean;
  dias_para_prazo: number | null;
  progresso_pct: number;
  concluida: boolean;
  licoes_total: number;
  licoes_concluidas: number;
  /** "Retomar de onde parou" (RF-TRE-02); null se a trilha acabou. */
  proxima_licao_id: string | null;
}

export interface ResumoJornada {
  xp_total: number;
  xp_hoje: number;
  nivel: NivelDoXp;
  streak: { dias: number; ativa_hoje: boolean; em_risco: boolean; maior: number };
  trilhas: TrilhaNaJornada[];
  medalhas: { codigo: string; nome: string; conquistada_em: string | null }[];
  obrigatorias_pendentes: number;
}

/**
 * Tela inicial do "Treinar": XP, nível (RN-TRE-06), sequência de dias (RN-TRE-05), medalhas (RF-TRE-03) e trilhas do
 * público (RN-TRE-07) — obrigatórias pendentes primeiro (prazo crescente), depois as em andamento e as concluídas por último.
 * `hoje` = data civil no fuso do tenant.
 */
export function resumoDaJornada(
  estado: EstadoDoAluno,
  conteudo: ConteudoDoAluno,
  opcoes: { hoje: string; params?: ParametrosTreinamento; catalogo?: readonly Medalha[] },
): ResumoJornada {
  const params = opcoes.params ?? { ...PARAMETROS_PADRAO };
  const xp = xpDoAluno(estado);
  const dias = diasComAtividade(instantesQueContam(estado), params.fuso);
  const seq = sequenciaAtual(dias, opcoes.hoje);
  const disponiveis = trilhasDisponiveis(conteudo.trilhas, estado.usuario);
  const todasConcluidas = estado.conclusoes.map((c) => c.licao_id);
  const pendentes = trilhasPendentes(disponiveis, estado.usuario, todasConcluidas, opcoes.hoje);
  const posPendente = new Map(pendentes.map((p, i) => [p.trilha_id, i]));
  const trilhas = disponiveis.map((t): TrilhaNaJornada => {
    const feitas = concluidasDaTrilha(estado, t.id);
    const prog = progressoDaTrilha(t, feitas);
    const pend = pendentes.find((p) => p.trilha_id === t.id);
    return {
      trilha_id: t.id,
      obrigatoria: t.obrigatoria,
      prazo: t.prazo,
      atrasada: pend?.atrasada ?? false,
      dias_para_prazo: pend?.dias_para_prazo ?? null,
      progresso_pct: prog.pct,
      concluida: prog.concluida,
      licoes_total: prog.total,
      licoes_concluidas: prog.concluidas,
      proxima_licao_id: proximaLicao(t, feitas),
    };
  });
  const grupo = (t: TrilhaNaJornada) => (posPendente.has(t.trilha_id) ? 0 : t.concluida ? 2 : 1);
  trilhas.sort((a, b) => grupo(a) - grupo(b) || (posPendente.get(a.trilha_id) ?? 0) - (posPendente.get(b.trilha_id) ?? 0) || (a.trilha_id < b.trilha_id ? -1 : a.trilha_id > b.trilha_id ? 1 : 0));
  const catalogo = opcoes.catalogo ?? medalhasPadrao(params.streak_medalha_dias);
  const conquistas = new Map(estado.conquistas.map((c) => [c.medalha_codigo, c.conquistada_em]));
  return {
    xp_total: xp,
    xp_hoje: xpDoDia(estado.lancamentos, estado.usuario_id, opcoes.hoje),
    nivel: nivelDoXp(xp, params.niveis_xp_min),
    streak: { dias: seq.dias, ativa_hoje: seq.ativa_hoje, em_risco: seq.em_risco, maior: maiorSequencia(dias) },
    trilhas,
    medalhas: catalogo.map((m) => ({ codigo: m.codigo, nome: m.nome, conquistada_em: conquistas.get(m.codigo) ?? null })),
    obrigatorias_pendentes: pendentes.length,
  };
}

/** Data civil de um instante no fuso do tenant (atalho para as telas e a API). */
export const diaDoInstante = (instante: Date, fuso: string = PARAMETROS_PADRAO.fuso): string => localDate(instante, fuso);
