/**
 * Entidades de sync da Pesquisa (API e aparelho usam as mesmas definições; ADR 0009).
 * - `questionario_versao`: só pull (servidor vence) — versões publicadas, com perguntas, regras e público aninhados.
 * - `resposta_pesquisa`: push de `RespostaEnvio` (somente inserção, idempotente pelo UUID do aparelho, RF-PES-04) e
 *   pull do resumo `RespostaPesquisaSync` (frequência e checkout, RN-PES-02/03).
 * `questionario` e `pergunta` continuam no `sync` do manifesto, sem provedor próprio: o cabeçalho e as perguntas viajam
 * dentro da linha da versão.
 */
import { definirEntidadeSync } from '@macuxi/platform-sdk';
import { QuestionarioVersaoSync, RespostaPesquisaSync } from './api';
import { RespostaEnvio } from './resposta';

export const ENTIDADE_QUESTIONARIO_VERSAO = 'questionario_versao';
export const ENTIDADE_RESPOSTA = 'resposta_pesquisa';

export const entidadeQuestionarioVersao = definirEntidadeSync({
  nome: ENTIDADE_QUESTIONARIO_VERSAO,
  modulo: 'pesquisa',
  direcao: 'pull',
  conflito: 'servidor_vence',
  schema: QuestionarioVersaoSync,
});

export const entidadeRespostaPesquisa = definirEntidadeSync({
  nome: ENTIDADE_RESPOSTA,
  modulo: 'pesquisa',
  direcao: 'ambos',
  conflito: 'somente_insercao',
  schema: RespostaEnvio,
  schemaLinha: RespostaPesquisaSync,
});

export const ENTIDADES_PESQUISA = [entidadeQuestionarioVersao, entidadeRespostaPesquisa] as const;
