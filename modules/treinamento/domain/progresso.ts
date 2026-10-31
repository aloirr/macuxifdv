/**
 * Progresso e validação no servidor (RN-TRE-04) e orquestração das conclusões que rendem XP
 * (RN-TRE-01, RN-TRE-02). Tudo é função pura: recebe o estado e devolve o que gravar (append-only).
 */
import { localDate } from '@macuxi/comum';
import { PARAMETROS_PADRAO, type ParametrosTreinamento } from './parametros';
import { aprovado, corrigirQuiz, ehPrimeiraTentativa, quizRespondidoAteOFim, validarTentativa, type CorrecaoQuiz, type QuestaoDef, type RespostaQuestao, type TentativaComNota } from './quiz';
import { diasComAtividade, sequenciaNaData } from './streak';
import { licoesOrdenadas, progressoDaTrilha, statusDaLicao, type TrilhaDef } from './trilha';
import { processarLote, xpDaLicao, xpDaTrilha, xpDoQuiz, xpDoStreak, type CandidatoXp, type LancamentoXp } from './xp';

export interface ConclusaoLicaoEntrada {
  licao_id: string;
  tempo_gasto_seg: number;
  /** Instante UTC (hora do aparelho). */
  concluida_em: string;
}

export interface ContextoConclusao {
  trilha: TrilhaDef;
  /** Lições da trilha que o usuário já concluiu (inclui as do mesmo lote offline, já aceitas). */
  concluidas: ReadonlySet<string> | readonly string[];
  /** O quiz da lição (se houver) já foi aprovado? */
  quiz_aprovado: boolean;
}

export type CodigoRejeicao = 'LICAO_DESCONHECIDA' | 'TRILHA_NAO_PUBLICADA' | 'LICAO_BLOQUEADA' | 'TEMPO_MINIMO' | 'QUIZ_PENDENTE';

export type ResultadoConclusao =
  | { resultado: 'aceito' }
  | { resultado: 'duplicado' }
  | { resultado: 'rejeitado'; codigo: CodigoRejeicao; regra: 'RN-TRE-04' | 'RN-TRE-02' | 'RF-TRE-01'; mensagem: string };

/**
 * RN-TRE-04: tempo mínimo na lição = o maior entre o piso [30 s] e [50%] da duração estimada (quando informada),
 * em segundos inteiros (para cima). Ex.: sem duração → 30 s; 600 s → 300 s; 40 s → 30 s (20 s < piso).
 * Conta em inteiros (pct × 100) para não errar com ponto flutuante (70% de 100 s = 70 s, não 71).
 */
export function tempoMinimoDaLicao(
  duracaoEstimadaSeg: number | null | undefined,
  params: Pick<ParametrosTreinamento, 'segundos_minimos_licao' | 'pct_minimo_duracao_licao'> = PARAMETROS_PADRAO,
): number {
  if (duracaoEstimadaSeg === null || duracaoEstimadaSeg === undefined || !Number.isFinite(duracaoEstimadaSeg) || duracaoEstimadaSeg <= 0) return params.segundos_minimos_licao;
  const proporcional = Math.ceil((Math.round(params.pct_minimo_duracao_licao * 100) * duracaoEstimadaSeg) / 10_000);
  return Math.max(params.segundos_minimos_licao, proporcional);
}

/**
 * RN-TRE-04: o servidor revalida a conclusão enviada pelo aparelho — tempo mínimo na lição (`tempoMinimoDaLicao`), pré-requisitos
 * (RF-TRE-01) e quiz aprovado quando a lição tem quiz (RN-TRE-02). Lição já concluída = `duplicado` (idempotente).
 */
export function validarConclusaoLicao(
  e: ConclusaoLicaoEntrada,
  ctx: ContextoConclusao,
  params: Pick<ParametrosTreinamento, 'segundos_minimos_licao' | 'pct_minimo_duracao_licao'> = PARAMETROS_PADRAO,
): ResultadoConclusao {
  const feitas = ctx.concluidas instanceof Set ? ctx.concluidas : new Set(ctx.concluidas);
  const licao = licoesOrdenadas(ctx.trilha).find((l) => l.id === e.licao_id);
  if (!licao) return { resultado: 'rejeitado', codigo: 'LICAO_DESCONHECIDA', regra: 'RF-TRE-01', mensagem: 'Essa lição não faz mais parte da trilha. Atualize o app e escolha outra lição.' };
  if (feitas.has(e.licao_id)) return { resultado: 'duplicado' };
  if (ctx.trilha.status !== 'publicada') return { resultado: 'rejeitado', codigo: 'TRILHA_NAO_PUBLICADA', regra: 'RF-TRE-01', mensagem: 'Essa trilha não está mais publicada. Atualize o app para ver as trilhas disponíveis.' };
  if (statusDaLicao(ctx.trilha, e.licao_id, feitas).status === 'bloqueada') {
    return { resultado: 'rejeitado', codigo: 'LICAO_BLOQUEADA', regra: 'RF-TRE-01', mensagem: 'Conclua as lições anteriores da trilha antes de fazer esta.' };
  }
  const minimo = tempoMinimoDaLicao(licao.duracao_estimada_seg, params);
  if (e.tempo_gasto_seg < minimo) {
    return {
      resultado: 'rejeitado',
      codigo: 'TEMPO_MINIMO',
      regra: 'RN-TRE-04',
      mensagem: `A lição precisa de pelo menos ${minimo} s de leitura ou vídeo para contar. Leia ou assista com calma e conclua de novo.`,
    };
  }
  if (licao.quiz_id && !ctx.quiz_aprovado) {
    return { resultado: 'rejeitado', codigo: 'QUIZ_PENDENTE', regra: 'RN-TRE-02', mensagem: 'Para concluir esta lição, passe no quiz com a nota mínima.' };
  }
  return { resultado: 'aceito' };
}

interface EntradaXpComum {
  tenant_id: string;
  usuario_id: string;
  /** Instantes UTC de atividades anteriores que contam para o streak: só lição concluída e quiz finalizado (`atividadesQueContam`). */
  atividades: readonly string[];
  lancamentos: readonly LancamentoXp[];
  /** Gera o UUID de cada lançamento criado. */
  gerarId: () => string;
  params?: ParametrosTreinamento;
}

/** Candidato do streak do dia da atividade (RN-TRE-01); a repetição no mesmo dia é barrada pela chave do evento. */
function candidatoStreak(e: EntradaXpComum, instante: string, params: ParametrosTreinamento): { candidato: CandidatoXp | null; dias: number } {
  const dias = diasComAtividade([...e.atividades, instante], params.fuso);
  const dia = localDate(new Date(instante), params.fuso);
  const sequencia = sequenciaNaData(dias, dia);
  const pontos = xpDoStreak(sequencia, params);
  return {
    dias: sequencia,
    candidato: pontos > 0 ? { id: e.gerarId(), tenant_id: e.tenant_id, usuario_id: e.usuario_id, origem: 'streak', referencia_id: dia, pontos_base: pontos, ocorrido_em: instante } : null,
  };
}

export type ResultadoConcluirLicao =
  | { resultado: 'aceito'; trilha_concluida: boolean; streak_dias: number; lancamentos: LancamentoXp[]; xp_ganho: number }
  | { resultado: 'duplicado' }
  | Extract<ResultadoConclusao, { resultado: 'rejeitado' }>;

/**
 * Conclui a lição: valida (RN-TRE-04) e devolve os lançamentos novos — lição [10], trilha [50] se foi a última
 * lição, streak do dia — já com teto diário e sem duplicar. Quem chama grava o progresso e os lançamentos.
 */
export function concluirLicao(
  e: EntradaXpComum & ConclusaoLicaoEntrada & ContextoConclusao,
): ResultadoConcluirLicao {
  const params = e.params ?? { ...PARAMETROS_PADRAO };
  const v = validarConclusaoLicao(e, e, params);
  if (v.resultado !== 'aceito') return v;

  const feitas = new Set(e.concluidas);
  feitas.add(e.licao_id);
  const trilhaConcluida = progressoDaTrilha(e.trilha, feitas).concluida;
  const base = { tenant_id: e.tenant_id, usuario_id: e.usuario_id, ocorrido_em: e.concluida_em };
  const candidatos: CandidatoXp[] = [{ ...base, id: e.gerarId(), origem: 'licao', referencia_id: e.licao_id, pontos_base: xpDaLicao(params) }];
  if (trilhaConcluida) candidatos.push({ ...base, id: e.gerarId(), origem: 'trilha', referencia_id: e.trilha.id, pontos_base: xpDaTrilha(params) });
  const streak = candidatoStreak(e, e.concluida_em, params);
  if (streak.candidato) candidatos.push(streak.candidato);

  const { lancamentos } = processarLote(e.lancamentos, candidatos, params);
  // processarLote ordena por instante e id; devolve na ordem lição → trilha → streak.
  const ordem = { licao: 0, trilha: 1, quiz: 2, streak: 3, desafio_vendas: 4 } as const;
  lancamentos.sort((a, b) => ordem[a.origem] - ordem[b.origem]);
  return { resultado: 'aceito', trilha_concluida: trilhaConcluida, streak_dias: streak.dias, lancamentos, xp_ganho: lancamentos.reduce((s, l) => s + l.pontos, 0) };
}

export type ResultadoTentativaQuiz =
  | { resultado: 'aceita'; correcao: CorrecaoQuiz; aprovada: boolean; primeira_tentativa: boolean; quiz_finalizado: boolean; lancamentos: LancamentoXp[]; xp_ganho: number }
  | { resultado: 'recusada'; motivo: 'LIMITE_DIARIO' | 'INTERVALO_MINIMO'; regra: 'RN-TRE-02'; proxima_em: string; mensagem: string };

/**
 * RN-TRE-02: registra a tentativa de quiz — confere limite diário/intervalo, corrige, aprova pela nota mínima e
 * devolve os lançamentos: [5] por acerto só na 1ª tentativa e o streak do dia (este só se o quiz foi respondido até o fim).
 */
export function registrarTentativaQuiz(
  e: EntradaXpComum & {
    quiz_id: string;
    questoes: readonly QuestaoDef[];
    respostas: readonly RespostaQuestao[];
    realizada_em: string;
    anteriores: readonly TentativaComNota[];
  },
): ResultadoTentativaQuiz {
  const params = e.params ?? { ...PARAMETROS_PADRAO };
  const permissao = validarTentativa(e.anteriores, e.realizada_em, params);
  if (!permissao.permitida) return { resultado: 'recusada', motivo: permissao.motivo, regra: permissao.regra, proxima_em: permissao.proxima_em, mensagem: permissao.mensagem };

  const correcao = corrigirQuiz(e.questoes, e.respostas);
  const primeira = ehPrimeiraTentativa(e.anteriores);
  const base = { tenant_id: e.tenant_id, usuario_id: e.usuario_id, ocorrido_em: e.realizada_em };
  const candidatos: CandidatoXp[] = [{ ...base, id: e.gerarId(), origem: 'quiz', referencia_id: e.quiz_id, pontos_base: xpDoQuiz(correcao.acertos, primeira, params) }];
  // Ajuste B: só quiz respondido até o fim mantém a sequência de dias (abrir e abandonar não conta).
  const finalizado = quizRespondidoAteOFim(e.questoes, e.respostas);
  if (finalizado) {
    const streak = candidatoStreak(e, e.realizada_em, params);
    if (streak.candidato) candidatos.push(streak.candidato);
  }

  const { lancamentos } = processarLote(e.lancamentos, candidatos, params);
  return {
    resultado: 'aceita',
    correcao,
    aprovada: aprovado(correcao.acertos, correcao.total, params.nota_minima_pct),
    primeira_tentativa: primeira,
    quiz_finalizado: finalizado,
    lancamentos,
    xp_ganho: lancamentos.reduce((s, l) => s + l.pontos, 0),
  };
}
