/**
 * Porta de dados da Pesquisa (T-0057). As rotas e o sync falam só com esta interface; a implementação de hoje é em
 * memória (`repositorio-memoria.ts`), porque a migração 0016 (schema `pesquisa`) ainda não chegou ao `main`. Quando
 * ela chegar, entra a implementação SQL (mesmos métodos, `db` do `ctx.comTenant`, RLS) sem mudar rota nem teste.
 * Sempre por tenant: a fábrica recebe o tenant do TOKEN e o cliente de banco da transação.
 */
import type { ClienteBanco } from '@macuxi/platform-sdk';
import type { Questionario, QuestionarioVersao, QuestionarioVersaoSync, RespostaPesquisa, RespostaPesquisaSync } from '../contracts';

export interface QuestionarioCarregado {
  questionario: Questionario;
  versoes: QuestionarioVersao[];
  /** Maior `updated_at` do questionário e das versões (ordem da lista do BKO). */
  atualizado_em: string;
}

/** Página do pull (mesma semântica do `PedidoPull` do SDK, ADR 0006): `(updated_at, id) > desde` e `updated_at < ate`. */
export interface JanelaPull {
  desde: { updated_at: string; id: string } | null;
  ate: string;
  limite: number;
}

export interface RepositorioPesquisa {
  listarQuestionarios(): Promise<(QuestionarioCarregado & { respostas: number })[]>;
  /** `null` = não existe neste tenant (ou foi removido). */
  carregar(id: string): Promise<QuestionarioCarregado | null>;
  criarQuestionario(q: Questionario, primeira: QuestionarioVersao, agora: string): Promise<void>;
  /** Insere a versão nova ou atualiza o RASCUNHO (a rota garante que publicada nunca é atualizada, RN-PES-01). */
  gravarVersao(v: QuestionarioVersao, agora: string): Promise<void>;
  arquivar(id: string, agora: string): Promise<void>;
  contarRespostas(questionarioId: string): Promise<number>;
  obterResposta(id: string): Promise<RespostaPesquisa | null>;
  /** Só inserção (RF-PES-04): nunca atualiza resposta existente. */
  inserirResposta(r: RespostaPesquisa, agora: string): Promise<void>;
  listarRespostas(questionarioId: string): Promise<RespostaPesquisa[]>;
  /** Pull de `questionario_versao`: só publicadas, com `arquivado_em` do questionário. */
  puxarVersoes(janela: JanelaPull): Promise<QuestionarioVersaoSync[]>;
  /** Pull de `resposta_pesquisa` (resumo), já filtrado pelo escopo do aparelho. */
  puxarRespostas(janela: JanelaPull, noEscopo: (r: Pick<RespostaPesquisa, 'usuario_id' | 'cliente_id'>) => boolean): Promise<RespostaPesquisaSync[]>;
}

/** Fábrica por requisição: tenant do token + cliente de banco da transação (`ctx.comTenant`). */
export type FabricaRepositorio = (tenantId: string, db: ClienteBanco) => RepositorioPesquisa;
