/**
 * Sync do Treinamento (ADR 0009; desenho T-0058). Uma única entidade de escrita, `progresso`, recebe as DUAS atividades
 * do aluno (conclusão de lição e tentativa de quiz) num só push: o servidor as aplica na ordem do instante do fato
 * (`aplicarAtividades`), então o quiz aprovado libera a lição enviada no mesmo lote, mesmo offline (RN-TRE-04).
 * O resto é só pull e só do próprio aluno (`proprio`), menos a `trilha` (conteúdo do público do aluno, RN-TRE-07).
 */
import { definirEntidadeSync } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { InstanteUtc } from './base';
import { TrilhaSyncLinha } from './conteudo';
import { MedalhaUsuario } from './medalha';
import { ProgressoLicao, ProgressoLicaoEnvio, TentativaQuizCampos, TentativaQuizEnvio } from './progresso';
import { LancamentoXpCampos } from './xp';

const Linha = { updated_at: InstanteUtc, deleted_at: InstanteUtc.nullable() };

/** Push `progresso`: o que o aparelho envia (o `id` do item = `id` da atividade = UUID do aparelho). */
export const AtividadeEnvio = z.discriminatedUnion('tipo', [
  ProgressoLicaoEnvio.extend({ tipo: z.literal('licao') }).strict(),
  TentativaQuizEnvio.extend({ tipo: z.literal('quiz') }).strict(),
]);
export type AtividadeEnvio = z.infer<typeof AtividadeEnvio>;

export const ProgressoSyncLinha = ProgressoLicao.extend(Linha).strict();
export type ProgressoSyncLinha = z.infer<typeof ProgressoSyncLinha>;

/** `finalizada` (RN-TRE-05): respondida até o fim — o aparelho precisa dela para a sequência de dias. */
export const TentativaSyncLinha = TentativaQuizCampos.extend({ finalizada: z.boolean(), ...Linha }).strict();
export type TentativaSyncLinha = z.infer<typeof TentativaSyncLinha>;

export const XpLancamentoSyncLinha = LancamentoXpCampos.extend(Linha).strict();
export type XpLancamentoSyncLinha = z.infer<typeof XpLancamentoSyncLinha>;

export const MedalhaUsuarioSyncLinha = MedalhaUsuario.extend(Linha).strict();
export type MedalhaUsuarioSyncLinha = z.infer<typeof MedalhaUsuarioSyncLinha>;

export const entidadeTrilha = definirEntidadeSync({ nome: 'trilha', modulo: 'treinamento', direcao: 'pull', conflito: 'servidor_vence', schema: TrilhaSyncLinha });
export const entidadeProgresso = definirEntidadeSync({
  nome: 'progresso',
  modulo: 'treinamento',
  direcao: 'ambos',
  conflito: 'somente_insercao',
  schema: AtividadeEnvio,
  schemaLinha: ProgressoSyncLinha,
});
export const entidadeTentativa = definirEntidadeSync({ nome: 'tentativa', modulo: 'treinamento', direcao: 'pull', conflito: 'somente_insercao', schema: TentativaSyncLinha });
export const entidadeXpLancamento = definirEntidadeSync({ nome: 'xp_lancamento', modulo: 'treinamento', direcao: 'pull', conflito: 'somente_insercao', schema: XpLancamentoSyncLinha });
export const entidadeMedalhaUsuario = definirEntidadeSync({ nome: 'medalha_usuario', modulo: 'treinamento', direcao: 'pull', conflito: 'somente_insercao', schema: MedalhaUsuarioSyncLinha });

/** Entidades servidas hoje (as demais do manifesto — modulo_trilha, licao, quiz, questao, alternativa — viajam dentro de `trilha`). */
export const ENTIDADES_TREINAMENTO = [entidadeTrilha, entidadeProgresso, entidadeTentativa, entidadeXpLancamento, entidadeMedalhaUsuario] as const;
