/**
 * Regras do BKO de trilhas (RF-TRE-01): o que pode ser editado, o que impede publicar e as mudanças de status.
 * A publicação e o arquivamento são auditados na API (RN-AUD-01).
 */
import { licoesOrdenadas, validarTrilha, type StatusTrilha, type TrilhaDef } from './trilha';

/** Quiz como o BKO o cadastra: alternativas com a marca de correta. */
export interface QuizParaPublicar {
  id: string;
  licao_id: string;
  questoes: readonly { id: string; alternativas: readonly { id: string; correta: boolean }[] }[];
}

export type TrilhaParaPublicar = TrilhaDef & { quizzes: readonly QuizParaPublicar[] };

export type ResultadoRegraBko = { ok: true } | { ok: false; codigo: string; regra: string; mensagem: string };

/** RF-TRE-01: edita-se só o rascunho. Publicada muda o que o aluno já fez; o caminho é arquivar e criar outra. */
export function podeEditarTrilha(status: StatusTrilha): ResultadoRegraBko {
  if (status === 'rascunho') return { ok: true };
  return {
    ok: false,
    codigo: 'TRILHA_NAO_EDITAVEL',
    regra: 'RF-TRE-01',
    mensagem: status === 'publicada' ? 'Trilha publicada não pode ser editada: arquive e crie uma nova versão.' : 'Trilha arquivada não pode ser editada: crie uma nova trilha.',
  };
}

/**
 * RF-TRE-01 / RN-TRE-02: problemas que impedem publicar — os de estrutura (`validarTrilha`), trilha sem lição,
 * quiz inexistente ou de outra lição, quiz sem questão, questão com menos de 2 alternativas ou sem alternativa correta.
 * Lista vazia = pode publicar.
 */
export function problemasParaPublicar(t: TrilhaParaPublicar): string[] {
  const erros = [...validarTrilha(t)];
  const licoes = licoesOrdenadas(t);
  if (licoes.length === 0) erros.push('A trilha precisa de ao menos uma lição para ser publicada.');
  const quizzes = new Map(t.quizzes.map((q) => [q.id, q]));
  for (const l of licoes) {
    if (!l.quiz_id) continue;
    const q = quizzes.get(l.quiz_id);
    if (!q || q.licao_id !== l.id) erros.push(`A lição ${l.id} aponta para o quiz ${l.quiz_id}, que não está cadastrado nela.`);
  }
  for (const q of t.quizzes) {
    if (q.questoes.length === 0) erros.push(`O quiz ${q.id} precisa de ao menos uma questão.`);
    for (const qu of q.questoes) {
      if (qu.alternativas.length < 2) erros.push(`A questão ${qu.id} precisa de ao menos 2 alternativas.`);
      if (!qu.alternativas.some((a) => a.correta)) erros.push(`A questão ${qu.id} precisa de ao menos uma alternativa correta.`);
    }
  }
  return erros;
}

export type AcaoStatusTrilha = 'publicar' | 'arquivar';

/** RF-TRE-01: rascunho → publicada → arquivada (arquivar também vale para rascunho). Repetir é idempotente. */
export function transicaoDaTrilha(
  atual: StatusTrilha,
  acao: AcaoStatusTrilha,
): { ok: true; status: StatusTrilha; mudou: boolean } | { ok: false; codigo: string; regra: string; mensagem: string } {
  if (acao === 'arquivar') return { ok: true, status: 'arquivada', mudou: atual !== 'arquivada' };
  if (atual === 'arquivada') return { ok: false, codigo: 'TRILHA_ARQUIVADA', regra: 'RF-TRE-01', mensagem: 'Trilha arquivada não volta a ser publicada: crie uma nova trilha.' };
  return { ok: true, status: 'publicada', mudou: atual !== 'publicada' };
}
