/**
 * Acesso a dados do Treinamento (desenho T-0058). A API fala só com esta interface:
 *  - produção: `repositorio-postgres.ts` (schema `treinamento`, migração 0017 do banco-dados), ligado em `index.ts`;
 *  - sem fábrica (`criarApiTreinamento()`): as rotas respondem 503 `TREINAMENTO_INDISPONIVEL` (falha fechada, depois de
 *    licença e perfil) e o sync não serve as entidades — só para montagens sem banco;
 *  - testes sem banco: a implementação em memória (`memoria.ts`), com a mesma interface.
 * Tudo aqui já está no tenant da transação (`ctx.comTenant`, RLS): nenhum método recebe `tenant_id` de fora.
 */
import type { ClienteBanco, LinhaSync, PedidoPull, Perfil, TransacaoTenant } from '@macuxi/platform-sdk';
import type { Trilha } from '../contracts/conteudo';
import type { AcaoStatusTrilha } from '../domain/bko';
import type { ConclusaoDoAluno, ConquistaDoAluno, TentativaDoAluno } from '../domain/atividade';
import type { ConclusaoDoUsuario, TentativaDoUsuario } from '../domain/painel';
import type { LancamentoXp } from '../domain/xp';

/** Usuário do tenant como o Treinamento precisa (público-alvo, ranking por equipe/regional, painel). */
export interface UsuarioTreinamento {
  id: string;
  nome: string;
  perfil: Perfil;
  equipe_id: string | null;
  regional_id: string | null;
  ativo: boolean;
}

/** Trilha gravada (linha do pull `trilha` = `TrilhaSyncLinha`). */
export type TrilhaGravada = Trilha & { deleted_at: string | null };

export interface EstadoGravadoDoAluno {
  conclusoes: ConclusaoDoAluno[];
  tentativas: TentativaDoAluno[];
  lancamentos: LancamentoXp[];
  conquistas: ConquistaDoAluno[];
}

/** O que uma atividade aceita grava (append-only: nada é editado nem apagado). */
export interface EfeitosDaAtividade {
  conclusao: ConclusaoDoAluno | null;
  tentativa: TentativaDoAluno | null;
  lancamentos: readonly LancamentoXp[];
  conquistas: readonly ConquistaDoAluno[];
}

/** Carimbos que o banco decide (`now()` da transação): a resposta da rota devolve o que foi gravado, não o relógio da API. */
export interface CarimbosTrilha {
  created_at: string;
  updated_at: string;
}

/** Mudança de status (publicar/arquivar): vira a linha do tempo `trilha_publicacao` (append-only, RN-AUD-01). */
export interface MudancaDeStatus {
  trilha_id: string;
  acao: AcaoStatusTrilha;
  de: Trilha['status'];
  para: Trilha['status'];
  publicada_em: string | null;
  arquivada_em: string | null;
  autor_id: string;
  ocorrido_em: string;
  request_id: string | null;
}

/** Linha da linha do tempo de publicação. */
export interface PublicacaoGravada {
  trilha_id: string;
  acao: AcaoStatusTrilha;
  de: Trilha['status'];
  para: Trilha['status'];
  autor_id: string;
  ocorrido_em: string;
  request_id: string | null;
}

export type EntidadeDoAluno = 'progresso' | 'tentativa' | 'xp_lancamento' | 'medalha_usuario';

export interface RepositorioTreinamento {
  /**
   * Serializa a escrita do aluno na transação (SQL: `pg_advisory_xact_lock(hash(tenant_id, usuario_id))`): os tetos de
   * XP são ler-depois-gravar (regras.md §8, "Concorrência na fase da API").
   */
  travarAluno(usuarioId: string): Promise<void>;

  // ---- conteúdo (BKO e pull) ----
  /** Todas as trilhas vivas do tenant (qualquer status). */
  trilhas(): Promise<TrilhaGravada[]>;
  trilha(id: string): Promise<TrilhaGravada | null>;
  inserirTrilha(t: Trilha): Promise<CarimbosTrilha>;
  /** Substitui a trilha e a árvore inteira (só em rascunho; o `updated_at` quem decide é o banco). */
  atualizarTrilha(t: Trilha): Promise<CarimbosTrilha>;
  /** Publicar/arquivar: muda o status e grava a linha de `trilha_publicacao`, sem mexer na árvore. */
  mudarStatusTrilha(m: MudancaDeStatus): Promise<CarimbosTrilha>;
  /** Linha do tempo da trilha, da mais antiga à mais nova. */
  publicacoesDaTrilha(trilhaId: string): Promise<PublicacaoGravada[]>;
  /** Página do pull de `trilha`: `(updated_at, id)` > `desde` e `updated_at` < `ate`, incluindo removidas. */
  trilhasDesde(p: PedidoPull): Promise<TrilhaGravada[]>;

  // ---- aluno ----
  estadoDoAluno(usuarioId: string): Promise<EstadoGravadoDoAluno>;
  gravarAtividade(usuarioId: string, efeitos: EfeitosDaAtividade): Promise<void>;
  /** Pull das linhas do próprio aluno (escopo `proprio`), na ordem `(updated_at, id)`. */
  linhasDoAluno(entidade: EntidadeDoAluno, usuarioId: string, p: PedidoPull): Promise<LinhaSync[]>;

  // ---- ranking e painel (tenant inteiro; o recorte de escopo é da rota, RN-CORE-04) ----
  conclusoesDoTenant(): Promise<ConclusaoDoUsuario[]>;
  tentativasDoTenant(): Promise<TentativaDoUsuario[]>;
  lancamentosDoTenant(): Promise<LancamentoXp[]>;
  /**
   * Usuários do tenant. Vêm do Core (perfil, equipe, regional, ativo) — o Treinamento não lê `core.*` (regra 1): a
   * implementação SQL usa uma consulta pública do Core (ADR 0012; hoje `core.cadastro_resumo@1`, ver
   * `repositorio-postgres.ts`).
   */
  usuarios(): Promise<UsuarioTreinamento[]>;
}

export interface FabricaRepositorio {
  /**
   * Repositório dentro da transação do tenant; `agora` = relógio da requisição. `tx` é a transação da rota (a consulta
   * pública do Core para `usuarios()`).
   */
  doTenant(db: ClienteBanco, tenantId: string, agora: () => Date, tx?: TransacaoTenant): RepositorioTreinamento;
}
