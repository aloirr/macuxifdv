/**
 * RN-CORE-42 Foto ou avatar (T-0170; desenho `docs/desenho/inicio-frase-avatar-pedidos.md` §2.3). Funções puras: o `receber`
 * do push `usuario_avatar` e a rota do BKO decidem com `aplicarTrocaAvatar`; o aparelho e o BKO mostram com `escolhaAtual`.
 * A última troca vence pelo `alterado_em`. O padrão (sem linha viva) são as iniciais, que a tela calcula do nome.
 */
import type { AvatarCodigo, TipoAvatar, UsuarioAvatarPush } from '../../contracts/avatar';
import { TOLERANCIA_RELOGIO_ADIANTADO_MS } from '../tarefas/conclusao';

/** O que a regra precisa de uma linha de `core.usuario_avatar` (a linha do pull serve). */
export interface AvatarGravado {
  id: string;
  usuario_id: string;
  tipo: TipoAvatar;
  avatar_codigo: AvatarCodigo | null;
  arquivo_id: string | null;
  alterado_em: string;
  deleted_at?: string | null;
}

export interface ContextoTroca {
  /** Usuário da sessão. */
  usuario_id: string;
  /** Ação `usuario_avatar.trocar_outro` do BKO, já recortada pelo escopo de `usuario.ver`. */
  pode_trocar_outro: boolean;
  /** Relógio do servidor. */
  agora: Date;
}

export type DecisaoTroca =
  | { acao: 'recusar'; codigo: 'FORA_DO_ESCOPO' }
  /** `id` já gravado: aceito sem mudança (reenvio da fila). */
  | { acao: 'nada' }
  /** Uma troca mais nova já é a viva: grava esta já apagada e não muda a escolha. */
  | { acao: 'gravar_superada'; alterado_em: string }
  /** Apaga logicamente a viva (e o arquivo dela, se foto) e grava a nova como viva. */
  | { acao: 'substituir'; alterado_em: string; apagar_id: string | null; apagar_arquivo_id: string | null };

function instante(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new RangeError(`Horário inválido: ${iso}.`);
  return t;
}

/**
 * Decide uma troca recebida. `viva` = a linha viva do usuário (ou `null` = iniciais); `idsGravados` = ids de trocas desse
 * usuário que já estão no banco (vivas ou apagadas), para a idempotência.
 */
export function aplicarTrocaAvatar(
  viva: AvatarGravado | null,
  idsGravados: readonly string[],
  troca: UsuarioAvatarPush,
  ctx: ContextoTroca,
): DecisaoTroca {
  if (troca.usuario_id !== ctx.usuario_id && !ctx.pode_trocar_outro) return { acao: 'recusar', codigo: 'FORA_DO_ESCOPO' };
  if (viva && viva.usuario_id !== troca.usuario_id) throw new RangeError('A escolha viva é de outro usuário.');
  if (idsGravados.includes(troca.id) || viva?.id === troca.id) return { acao: 'nada' };
  const agora = ctx.agora.getTime();
  const alterado = instante(troca.alterado_em) - agora > TOLERANCIA_RELOGIO_ADIANTADO_MS ? ctx.agora.toISOString() : troca.alterado_em;
  if (viva && instante(viva.alterado_em) > instante(alterado)) return { acao: 'gravar_superada', alterado_em: alterado };
  return { acao: 'substituir', alterado_em: alterado, apagar_id: viva?.id ?? null, apagar_arquivo_id: viva?.tipo === 'foto' ? viva.arquivo_id : null };
}

export type EscolhaAvatar = { tipo: 'iniciais' } | { tipo: 'avatar'; avatar_codigo: AvatarCodigo } | { tipo: 'foto'; arquivo_id: string };

/** O que mostrar para `usuarioId`: a viva de maior `alterado_em` (o banco garante uma só); sem viva = iniciais. */
export function escolhaAtual(linhas: readonly AvatarGravado[], usuarioId: string): EscolhaAvatar {
  let atual: AvatarGravado | null = null;
  for (const l of linhas) {
    if (l.usuario_id !== usuarioId || l.deleted_at) continue;
    if (!atual || instante(l.alterado_em) > instante(atual.alterado_em)) atual = l;
  }
  if (atual?.tipo === 'avatar' && atual.avatar_codigo) return { tipo: 'avatar', avatar_codigo: atual.avatar_codigo };
  if (atual?.tipo === 'foto' && atual.arquivo_id) return { tipo: 'foto', arquivo_id: atual.arquivo_id };
  return { tipo: 'iniciais' };
}
