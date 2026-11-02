/**
 * Conteúdo do Treinamento (RF-TRE-01): trilha → módulos → lições → quiz → questões → alternativas, como o BKO cadastra
 * e como o aparelho recebe pelo pull da entidade `trilha` (uma linha = a árvore inteira da trilha, desenho T-0058).
 * As alternativas corretas vão ao aparelho (feedback imediato no quiz offline); a API sempre recorrige (RN-TRE-04).
 */
import { z } from 'zod';
import { PerfilSchema } from '@macuxi/core/contracts';
import type { QuizParaPublicar, TrilhaParaPublicar } from '../domain/bko';
import type { ConteudoDoAluno, QuizDef } from '../domain/atividade';
import type { TrilhaDef } from '../domain/trilha';
import { InstanteUtc, IsoDate, Uuid } from './base';

/** Limites do cadastro (premissa T-0058, iguais aos da Pesquisa: 50 questões, 20 alternativas). */
export const LIMITES_CONTEUDO = { modulos: 30, licoes_por_modulo: 50, questoes: 50, alternativas: 20, texto: 20_000 } as const;

const Titulo = z.string().trim().min(1, 'Informe o título.').max(200);
const Ordem = z.number().int().nonnegative();
const Ids = z.array(Uuid).max(100).default([]);

export const AlternativaConteudo = z.object({ id: Uuid, texto: z.string().trim().min(1, 'Informe o texto da alternativa.').max(500), correta: z.boolean() }).strict();
export type AlternativaConteudo = z.infer<typeof AlternativaConteudo>;

export const QuestaoConteudo = z
  .object({
    id: Uuid,
    ordem: Ordem,
    enunciado: z.string().trim().min(1, 'Informe o enunciado.').max(1000),
    alternativas: z.array(AlternativaConteudo).max(LIMITES_CONTEUDO.alternativas),
  })
  .strict();
export type QuestaoConteudo = z.infer<typeof QuestaoConteudo>;

export const QuizConteudo = z.object({ id: Uuid, questoes: z.array(QuestaoConteudo).max(LIMITES_CONTEUDO.questoes) }).strict();
export type QuizConteudo = z.infer<typeof QuizConteudo>;

export const TIPOS_LICAO = ['texto', 'video', 'pdf', 'link'] as const;
export const TipoLicao = z.enum(TIPOS_LICAO);
export type TipoLicao = z.infer<typeof TipoLicao>;

export const LicaoConteudo = z
  .object({
    id: Uuid,
    ordem: Ordem,
    titulo: Titulo,
    tipo: TipoLicao,
    /** Texto da lição (markdown simples); nas de vídeo/PDF/link, o resumo. */
    texto: z.string().max(LIMITES_CONTEUDO.texto).nullable().default(null),
    /** Endereço do vídeo curto, PDF ou link (vídeo baixa só no Wi-Fi, RF-TRE-02). */
    midia_url: z.string().url().max(2000).nullable().default(null),
    /** Base do tempo mínimo proporcional (RN-TRE-04). */
    duracao_estimada_seg: z.number().int().positive().max(36_000).nullable().default(null),
    pre_requisitos: Ids,
    quiz: QuizConteudo.nullable().default(null),
  })
  .strict();
export type LicaoConteudo = z.infer<typeof LicaoConteudo>;

export const ModuloConteudo = z
  .object({ id: Uuid, ordem: Ordem, titulo: Titulo, pre_requisitos: Ids, licoes: z.array(LicaoConteudo).max(LIMITES_CONTEUDO.licoes_por_modulo) })
  .strict();
export type ModuloConteudo = z.infer<typeof ModuloConteudo>;

export const PublicoAlvoContrato = z.object({ perfis: z.array(PerfilSchema).max(10).default([]), equipes: z.array(Uuid).max(200).default([]) }).strict();
export type PublicoAlvoContrato = z.infer<typeof PublicoAlvoContrato>;

export const STATUS_TRILHA = ['rascunho', 'publicada', 'arquivada'] as const;
export const StatusTrilhaContrato = z.enum(STATUS_TRILHA);

/** Corpo do cadastro/edição no BKO (`POST /bko/trilhas`, `PUT /bko/trilhas/:id`). O `id` é gerado no cliente (idempotente). */
export const TrilhaEdicao = z
  .object({
    id: Uuid,
    titulo: Titulo,
    descricao: z.string().max(2000).nullable().default(null),
    obrigatoria: z.boolean().default(false),
    sequencial: z.boolean().default(true),
    /** Data civil no fuso do tenant. */
    prazo: IsoDate.nullable().default(null),
    publico_alvo: PublicoAlvoContrato.default({ perfis: [], equipes: [] }),
    modulos: z.array(ModuloConteudo).max(LIMITES_CONTEUDO.modulos).default([]),
  })
  .strict();
export type TrilhaEdicao = z.infer<typeof TrilhaEdicao>;
export type TrilhaEdicaoEntrada = z.input<typeof TrilhaEdicao>;

/** Trilha gravada (BKO e linha do pull `trilha`). */
export const Trilha = TrilhaEdicao.extend({
  tenant_id: Uuid,
  status: StatusTrilhaContrato,
  publicada_em: InstanteUtc.nullable(),
  arquivada_em: InstanteUtc.nullable(),
  created_at: InstanteUtc,
  updated_at: InstanteUtc,
}).strict();
export type Trilha = z.infer<typeof Trilha>;

/** Linha do pull da entidade `trilha` (ADR 0009 §2): a trilha + `deleted_at`. */
export const TrilhaSyncLinha = Trilha.extend({ deleted_at: InstanteUtc.nullable() }).strict();
export type TrilhaSyncLinha = z.infer<typeof TrilhaSyncLinha>;

// ---------- conversão para o domain (sem regra: só forma) ----------

type TrilhaComConteudo = Pick<TrilhaEdicao, 'id' | 'obrigatoria' | 'sequencial' | 'prazo' | 'publico_alvo' | 'modulos'> & { status: TrilhaDef['status'] };

/** Estrutura da trilha para o domain (pré-requisitos, público, quiz de cada lição). */
export function trilhaParaDominio(t: TrilhaComConteudo): TrilhaDef {
  return {
    id: t.id,
    status: t.status,
    obrigatoria: t.obrigatoria,
    sequencial: t.sequencial,
    prazo: t.prazo,
    publico_alvo: { perfis: t.publico_alvo.perfis, equipes: t.publico_alvo.equipes },
    modulos: t.modulos.map((m) => ({
      id: m.id,
      ordem: m.ordem,
      pre_requisitos: m.pre_requisitos,
      licoes: m.licoes.map((l) => ({ id: l.id, ordem: l.ordem, pre_requisitos: l.pre_requisitos, quiz_id: l.quiz?.id ?? null, duracao_estimada_seg: l.duracao_estimada_seg })),
    })),
  };
}

/** Quizzes da trilha com as alternativas corretas (correção offline e na API). */
export function quizzesDaTrilha(t: Pick<TrilhaEdicao, 'id' | 'modulos'>): QuizDef[] {
  return t.modulos.flatMap((m) =>
    m.licoes.flatMap((l) =>
      l.quiz ? [{ id: l.quiz.id, trilha_id: t.id, licao_id: l.id, questoes: l.quiz.questoes.map((q) => ({ id: q.id, corretas: q.alternativas.filter((a) => a.correta).map((a) => a.id) })) }] : [],
    ),
  );
}

/** Conteúdo do aluno (domain) a partir das trilhas do contrato. */
export function conteudoParaDominio(trilhas: readonly TrilhaComConteudo[]): ConteudoDoAluno {
  return { trilhas: trilhas.map(trilhaParaDominio), quizzes: trilhas.flatMap(quizzesDaTrilha) };
}

/** Trilha + quizzes no formato das regras de publicação (`problemasParaPublicar`). */
export function trilhaParaPublicar(t: TrilhaComConteudo): TrilhaParaPublicar {
  const quizzes: QuizParaPublicar[] = t.modulos.flatMap((m) =>
    m.licoes.flatMap((l) => (l.quiz ? [{ id: l.quiz.id, licao_id: l.id, questoes: l.quiz.questoes.map((q) => ({ id: q.id, alternativas: q.alternativas.map((a) => ({ id: a.id, correta: a.correta })) })) }] : [])),
  );
  return { ...trilhaParaDominio(t), quizzes };
}

/** Lição pelo id (com o módulo), para as telas. */
export function acharLicao(t: Pick<TrilhaEdicao, 'modulos'>, licaoId: string): { modulo: ModuloConteudo; licao: LicaoConteudo } | null {
  for (const m of t.modulos) {
    const l = m.licoes.find((x) => x.id === licaoId);
    if (l) return { modulo: m, licao: l };
  }
  return null;
}
