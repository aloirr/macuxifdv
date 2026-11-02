/**
 * Acesso a dados do Treinamento (desenho T-0058). A API fala só com esta interface; a implementação SQL (schema
 * `treinamento`, migração 0017 do banco-dados) entra quando a migração chegar ao main. Até lá:
 *  - `moduloApi` (produção) é montado SEM fábrica: as rotas respondem 503 `TREINAMENTO_INDISPONIVEL` (falha fechada,
 *    depois de licença e perfil) e o sync não serve as entidades (o aparelho guarda a fila: `SYNC_NAO_IMPLEMENTADO`);
 *  - os testes usam a implementação em memória (`memoria.ts`), com a mesma interface.
 * Tudo aqui já está no tenant da transação (`ctx.comTenant`, RLS): nenhum método recebe `tenant_id` de fora.
 */
import type { ClienteBanco, LinhaSync, PedidoPull, Perfil } from '@macuxi/platform-sdk';
import type { Trilha } from '../contracts/conteudo';
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
  inserirTrilha(t: Trilha): Promise<void>;
  /** Substitui a trilha (o `updated_at` vem preenchido por quem chama). */
  atualizarTrilha(t: Trilha): Promise<void>;
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
   * implementação SQL depende de uma consulta do Core (pedido ao engenheiro-software/modulo-core na T-0058).
   */
  usuarios(): Promise<UsuarioTreinamento[]>;
}

export interface FabricaRepositorio {
  /** Repositório dentro da transação do tenant; `agora` = relógio da requisição (grava `created_at`/`updated_at`). */
  doTenant(db: ClienteBanco, tenantId: string, agora: () => Date): RepositorioTreinamento;
}
