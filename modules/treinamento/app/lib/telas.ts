/**
 * Montagem pura do que as telas do Treinar mostram (mapa da trilha, quiz, títulos da jornada). Os status e as regras
 * vêm do domain (`statusDaLicao`, `statusDoModulo`, `tempoMinimoDaLicao`, `quizAprovado`); aqui só se junta com os textos.
 */
import {
  trilhaParaDominio,
  type LicaoConteudo,
  type QuestaoConteudo,
  type TrilhaSyncLinha,
} from '../../contracts';
import {
  quizAprovado,
  statusDaLicao,
  statusDoModulo,
  tempoMinimoDaLicao,
  type EstadoDoAluno,
  type ParametrosTreinamento,
  type ResumoJornada,
  type TrilhaNaJornada,
} from '../../domain';

export interface LicaoNoMapa {
  id: string;
  titulo: string;
  tipo: LicaoConteudo['tipo'];
  status: 'concluida' | 'liberada' | 'bloqueada';
  tem_quiz: boolean;
}

export interface ModuloNoMapa {
  id: string;
  titulo: string;
  status: 'concluido' | 'liberado' | 'bloqueado';
  licoes: LicaoNoMapa[];
}

const porOrdem = <T extends { ordem: number }>(l: readonly T[]): T[] =>
  [...l].sort((a, b) => a.ordem - b.ordem);

const concluidasDaTrilha = (estado: Pick<EstadoDoAluno, 'conclusoes'>, trilhaId: string): string[] =>
  estado.conclusoes.filter((c) => c.trilha_id === trilhaId).map((c) => c.licao_id);

/** RF-TRE-01/02: mapa da trilha (módulos → lições) com o status que o domain calcula. */
export function mapaDaTrilha(
  trilha: TrilhaSyncLinha,
  estado: Pick<EstadoDoAluno, 'conclusoes'>,
): ModuloNoMapa[] {
  const def = trilhaParaDominio(trilha);
  const feitas = concluidasDaTrilha(estado, trilha.id);
  return porOrdem(trilha.modulos).map((m) => ({
    id: m.id,
    titulo: m.titulo,
    status: m.licoes.length === 0 ? 'bloqueado' : statusDoModulo(def, m.id, feitas).status,
    licoes: porOrdem(m.licoes).map((l) => ({
      id: l.id,
      titulo: l.titulo,
      tipo: l.tipo,
      status: statusDaLicao(def, l.id, feitas).status,
      tem_quiz: Boolean(l.quiz),
    })),
  }));
}

export interface LicaoNaTela {
  trilha: TrilhaSyncLinha;
  licao: LicaoConteudo;
  modulo_titulo: string;
  status: 'concluida' | 'liberada' | 'bloqueada';
  /** RN-TRE-04: segundos mínimos na lição para a conclusão contar. */
  tempo_minimo_seg: number;
  /** A lição tem quiz e ele ainda não foi aprovado: o botão vira "Fazer o quiz" (RN-TRE-02). */
  precisa_quiz: boolean;
}

/** Acha a lição nas trilhas do aparelho e calcula o que a tela precisa (status, tempo mínimo, quiz pendente). */
export function licaoNaTela(
  trilhas: readonly TrilhaSyncLinha[],
  licaoId: string,
  estado: Pick<EstadoDoAluno, 'conclusoes' | 'tentativas'>,
  params: ParametrosTreinamento,
): LicaoNaTela | null {
  for (const t of trilhas) {
    for (const m of t.modulos) {
      const licao = m.licoes.find((l) => l.id === licaoId);
      if (!licao) continue;
      const status = statusDaLicao(trilhaParaDominio(t), licao.id, concluidasDaTrilha(estado, t.id)).status;
      const aprovado = licao.quiz
        ? quizAprovado(estado.tentativas.filter((x) => x.quiz_id === licao.quiz!.id))
        : true;
      return {
        trilha: t,
        licao,
        modulo_titulo: m.titulo,
        status,
        tempo_minimo_seg: tempoMinimoDaLicao(licao.duracao_estimada_seg, params),
        precisa_quiz: !aprovado,
      };
    }
  }
  return null;
}

export interface QuestaoNaTela {
  id: string;
  enunciado: string;
  /** Mais de uma alternativa correta = múltipla escolha (marcar todas as certas). */
  multipla: boolean;
  alternativas: { id: string; texto: string }[];
}

/** Questões do quiz da lição, em ordem, sem expor qual alternativa é a correta à tela. */
export function questoesDaTela(licao: LicaoConteudo): QuestaoNaTela[] {
  return porOrdem<QuestaoConteudo>(licao.quiz?.questoes ?? []).map((q) => ({
    id: q.id,
    enunciado: q.enunciado,
    multipla: q.alternativas.filter((a) => a.correta).length > 1,
    alternativas: q.alternativas.map((a) => ({ id: a.id, texto: a.texto })),
  }));
}

/** Marca/desmarca uma alternativa (única na escolha simples; alterna na múltipla). */
export function marcarAlternativa(
  marcadas: Readonly<Record<string, readonly string[]>>,
  questao: QuestaoNaTela,
  alternativaId: string,
): Record<string, string[]> {
  const atuais = marcadas[questao.id] ?? [];
  const novas = questao.multipla
    ? atuais.includes(alternativaId)
      ? atuais.filter((a) => a !== alternativaId)
      : [...atuais, alternativaId]
    : [alternativaId];
  return {
    ...Object.fromEntries(Object.entries(marcadas).map(([k, v]) => [k, [...v]])),
    [questao.id]: novas,
  };
}

export type TrilhaDaLista = TrilhaNaJornada & { titulo: string };

/** Trilhas da jornada com o título (a ordem é a do domain: obrigatórias pendentes, em andamento, concluídas). */
export function trilhasComTitulo(
  jornada: Pick<ResumoJornada, 'trilhas'>,
  trilhas: readonly TrilhaSyncLinha[],
): TrilhaDaLista[] {
  const titulos = new Map(trilhas.map((t) => [t.id, t.titulo]));
  return jornada.trilhas.map((t) => ({ ...t, titulo: titulos.get(t.trilha_id) ?? 'Trilha' }));
}
