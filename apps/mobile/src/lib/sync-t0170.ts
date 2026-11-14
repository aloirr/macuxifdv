/**
 * Costura do sync da T-0170 no shell mobile (item 8 do #149; desenho `docs/desenho/tarefas-consultor.md` §3.4 e §5).
 * As mesmas definições dos provedores da API (`modules/core/api/sync-t0170.ts`):
 * - pull `tarefa` (só as do usuário), `frase_dia` (RN-CORE-41), `meta_produtividade` e `deslocamento_dia` (RN-CORE-45/46);
 * - push `tarefa_conclusao` (comando, `somente_insercao`, ADR 0009);
 * - `usuario_avatar` nos dois sentidos (RN-CORE-42): o aparelho envia a troca e recebe a linha.
 * Cada entidade registrada ganha a tabela `ent_<entidade>` no SQLite do aparelho (SDK, `sqlite/esquema.ts`): não há
 * migração local. A entidade que o Core já registrar no `moduloApp` dele não entra de novo. Puro (sem react-native).
 */
import {
  ConclusaoTarefaSchema,
  DeslocamentoDiaSchema,
  FraseDiaSyncSchema,
  MetaProdutividadeSchema,
  TarefaSyncSchema,
  UsuarioAvatarPushSchema,
  UsuarioAvatarSyncSchema,
  type UsuarioAvatarPush,
} from '@macuxi/core/contracts';
import { definirEntidadeSync, type DefinicaoEntidadeSync, type ModuloShell, type NovoItemOutbox } from '@macuxi/platform-sdk';

const pull = (nome: string, schema: DefinicaoEntidadeSync['schema']) =>
  definirEntidadeSync({ nome, modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema });

export const ENTIDADE_AVATAR = 'usuario_avatar';

export const ENTIDADES_SYNC_T0170: readonly DefinicaoEntidadeSync[] = [
  pull('tarefa', TarefaSyncSchema),
  definirEntidadeSync({ nome: 'tarefa_conclusao', modulo: 'core', direcao: 'push', conflito: 'somente_insercao', schema: ConclusaoTarefaSchema }),
  pull('frase_dia', FraseDiaSyncSchema),
  definirEntidadeSync({
    nome: ENTIDADE_AVATAR,
    modulo: 'core',
    direcao: 'ambos',
    conflito: 'servidor_vence',
    schema: UsuarioAvatarPushSchema,
    schemaLinha: UsuarioAvatarSyncSchema,
  }),
  pull('meta_produtividade', MetaProdutividadeSchema),
  pull('deslocamento_dia', DeslocamentoDiaSchema),
];

/** O módulo com as entidades da T-0170 que são dele e que ele ainda não registra. */
export function comSyncT0170<C>(m: ModuloShell<C>): ModuloShell<C> {
  const proprias = new Set((m.entidadesSync ?? []).map((e) => e.nome));
  const novas = ENTIDADES_SYNC_T0170.filter((e) => e.modulo === m.manifesto.id && !proprias.has(e.nome));
  return novas.length ? { ...m, entidadesSync: [...(m.entidadesSync ?? []), ...novas] } : m;
}

export type EscolhaDoPerfil = Pick<UsuarioAvatarPush, 'tipo' | 'avatar_codigo' | 'arquivo_id'>;

/**
 * Item da fila da troca de foto ou avatar (RN-CORE-42): UUID e hora do aparelho; a última troca vence no servidor pelo
 * `alterado_em`. Na foto, o arquivo vai antes para a fila de arquivos (`motor.enfileirarArquivo`, ADR 0010).
 */
export function itemTrocaDeAvatar(p: { id: string; usuarioId: string; escolha: EscolhaDoPerfil; agora: Date }): NovoItemOutbox {
  const payload: UsuarioAvatarPush = { id: p.id, usuario_id: p.usuarioId, ...p.escolha, alterado_em: p.agora.toISOString() };
  return { id: p.id, entidade: ENTIDADE_AVATAR, payload, rotulo: 'Foto do perfil' };
}
