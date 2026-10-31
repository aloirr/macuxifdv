/**
 * Quiz: correção, nota, aprovação, tentativas por dia/intervalo e nota que vale (RN-TRE-02, RF-TRE-01).
 * O "dia" é o do fuso do tenant; os instantes são UTC (ISO 8601 com Z).
 */
import { localDate } from '@macuxi/comum';
import { arredondar, instanteMs } from './numeros';
import { PARAMETROS_PADRAO, type NotaQueVale, type ParametrosTreinamento } from './parametros';

export interface QuestaoDef {
  id: string;
  /** Alternativas corretas (uma, ou várias na múltipla escolha). */
  corretas: readonly string[];
}

export interface RespostaQuestao {
  questao_id: string;
  alternativa_ids: readonly string[];
}

export interface CorrecaoQuiz {
  acertos: number;
  total: number;
  nota_pct: number;
  por_questao: { questao_id: string; correta: boolean }[];
}

/** RN-TRE-02: nota (0–100) = acertos ÷ questões × 100, arredondada a 2 casas (meio para cima). */
export function notaDoQuiz(acertos: number, total: number): number {
  if (!Number.isInteger(total) || total < 1) throw new RangeError('O quiz precisa ter ao menos uma questão.');
  if (!Number.isInteger(acertos) || acertos < 0 || acertos > total) throw new RangeError('O número de acertos precisa estar entre 0 e o total de questões.');
  return arredondar((acertos / total) * 100);
}

/**
 * RN-TRE-02: corrige as respostas. Questão acerta só se o conjunto marcado é exatamente o das corretas;
 * em branco conta como erro. Resposta a questão de fora do quiz ou repetida é erro (a API recusa o envio).
 */
export function corrigirQuiz(questoes: readonly QuestaoDef[], respostas: readonly RespostaQuestao[]): CorrecaoQuiz {
  const ids = new Set(questoes.map((q) => q.id));
  const porId = new Map<string, readonly string[]>();
  for (const r of respostas) {
    if (!ids.has(r.questao_id)) throw new RangeError(`A questão ${r.questao_id} não pertence a este quiz.`);
    if (porId.has(r.questao_id)) throw new RangeError(`A questão ${r.questao_id} foi respondida mais de uma vez.`);
    porId.set(r.questao_id, r.alternativa_ids);
  }
  const por_questao = questoes.map((q) => {
    const marcadas = new Set(porId.get(q.id) ?? []);
    const correta = marcadas.size > 0 && marcadas.size === q.corretas.length && q.corretas.every((c) => marcadas.has(c));
    return { questao_id: q.id, correta };
  });
  const acertos = por_questao.filter((q) => q.correta).length;
  return { acertos, total: questoes.length, nota_pct: notaDoQuiz(acertos, questoes.length), por_questao };
}

/**
 * RN-TRE-02: aprovado com nota ≥ mínima [70%]. Comparação exata (acertos × 100 ≥ mínimo × total):
 * a nota exibida, arredondada, nunca aprova quem ficou abaixo.
 */
export function aprovado(acertos: number, total: number, notaMinimaPct: number = PARAMETROS_PADRAO.nota_minima_pct): boolean {
  notaDoQuiz(acertos, total); // valida os argumentos
  return acertos * 100 >= notaMinimaPct * total;
}

/** Ajuste B: o quiz foi respondido até o fim? Toda questão tem ao menos uma alternativa marcada. */
export function quizRespondidoAteOFim(questoes: readonly QuestaoDef[], respostas: readonly RespostaQuestao[]): boolean {
  const respondidas = new Set(respostas.filter((r) => r.alternativa_ids.length > 0).map((r) => r.questao_id));
  return questoes.length > 0 && questoes.every((q) => respondidas.has(q.id));
}

export interface TentativaRegistrada {
  /** Instante UTC em que o aluno enviou a tentativa (hora do aparelho). */
  realizada_em: string;
}

export type ResultadoTentativa =
  | { permitida: true; tentativas_restantes_hoje: number }
  | { permitida: false; motivo: 'LIMITE_DIARIO' | 'INTERVALO_MINIMO'; regra: 'RN-TRE-02'; proxima_em: string; mensagem: string };

/** Primeiro instante do dia seguinte (no fuso) ao do instante informado, em ISO UTC, ao minuto. */
export function inicioDoProximoDia(instante: string, fuso: string): string {
  const base = instanteMs(instante);
  const hoje = localDate(new Date(base), fuso);
  let ms = base;
  while (localDate(new Date(ms), fuso) === hoje) ms += 3_600_000;
  ms -= 3_600_000;
  while (localDate(new Date(ms), fuso) === hoje) ms += 60_000;
  return new Date(ms).toISOString();
}

/**
 * RN-TRE-02: pode fazer nova tentativa? No máximo [3] por dia (dia no fuso do tenant) e, se o tenant
 * definir, um intervalo mínimo desde a tentativa anterior (decisão 31/10). `realizada_em` é a hora da nova
 * tentativa: a validação offline (RN-TRE-04) considera só as tentativas anteriores a ela.
 */
export function validarTentativa(
  anteriores: readonly TentativaRegistrada[],
  realizada_em: string,
  params: Pick<ParametrosTreinamento, 'tentativas_max_dia' | 'intervalo_min_tentativas_min' | 'fuso'> = PARAMETROS_PADRAO,
): ResultadoTentativa {
  const agora = instanteMs(realizada_em);
  const antes = anteriores.map((t) => instanteMs(t.realizada_em)).filter((ms) => ms <= agora).sort((a, b) => a - b);

  const ultima = antes[antes.length - 1];
  if (ultima !== undefined && params.intervalo_min_tentativas_min > 0) {
    const liberaEm = ultima + params.intervalo_min_tentativas_min * 60_000;
    if (agora < liberaEm) {
      const faltam = Math.ceil((liberaEm - agora) / 60_000);
      return {
        permitida: false,
        motivo: 'INTERVALO_MINIMO',
        regra: 'RN-TRE-02',
        proxima_em: new Date(liberaEm).toISOString(),
        mensagem: `Espere ${faltam} min para tentar de novo e aproveite para rever a lição.`,
      };
    }
  }

  const hoje = localDate(new Date(agora), params.fuso);
  const feitasHoje = antes.filter((ms) => localDate(new Date(ms), params.fuso) === hoje).length;
  if (feitasHoje >= params.tentativas_max_dia) {
    return {
      permitida: false,
      motivo: 'LIMITE_DIARIO',
      regra: 'RN-TRE-02',
      proxima_em: inicioDoProximoDia(realizada_em, params.fuso),
      mensagem: `Você já fez ${params.tentativas_max_dia} tentativas hoje. Revise a lição e tente de novo amanhã.`,
    };
  }
  return { permitida: true, tentativas_restantes_hoje: params.tentativas_max_dia - feitasHoje - 1 };
}

/** RN-TRE-02: XP de acerto só na 1ª tentativa do quiz (nenhuma tentativa anterior do usuário). */
export function ehPrimeiraTentativa(anteriores: readonly TentativaRegistrada[]): boolean {
  return anteriores.length === 0;
}

export interface TentativaComNota extends TentativaRegistrada {
  nota_pct: number;
  aprovada: boolean;
}

/** decisão 31/10: nota que vale nos relatórios — a melhor (padrão) ou a da última tentativa; null sem tentativas. */
export function notaQueVale(tentativas: readonly TentativaComNota[], modo: NotaQueVale = PARAMETROS_PADRAO.nota_que_vale): number | null {
  if (tentativas.length === 0) return null;
  if (modo === 'melhor') return Math.max(...tentativas.map((t) => t.nota_pct));
  return [...tentativas].sort((a, b) => instanteMs(a.realizada_em) - instanteMs(b.realizada_em)).at(-1)!.nota_pct;
}

/** Aprovado uma vez, aprovado para sempre: o progresso só cresce (tentativa posterior pior não revoga). */
export function quizAprovado(tentativas: readonly Pick<TentativaComNota, 'aprovada'>[]): boolean {
  return tentativas.some((t) => t.aprovada);
}
