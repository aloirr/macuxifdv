/**
 * Gestor imediato do usuário (Perfil do app; RN-CORE-04). A regra é a do domain (`gestorImediatoDe`: superior direto, ativo); aqui a
 * API lê as equipes e os usuários do tenant (RLS) e devolve só `{ id, nome }`, que vai na sessão do próprio usuário.
 */
import type { ClienteBanco } from '@macuxi/platform-sdk';
import type { GestorImediato } from '../contracts';
import { gestorImediatoDe, montarHierarquia, type EquipeLinha, type UsuarioLinha } from '../domain';

export async function gestorImediatoDoUsuario(db: ClienteBanco, usuarioId: string): Promise<{ gestor_imediato: GestorImediato | null }> {
  const equipes = (await db.query<EquipeLinha>('select id, equipe_pai_id, responsavel_id from core.equipe where deleted_at is null and ativo')).rows;
  const usuarios = (await db.query<UsuarioLinha>('select id, nome, perfil, equipe_id, ativo from core.usuario where deleted_at is null')).rows;
  return { gestor_imediato: gestorImediatoDe(montarHierarquia(equipes, usuarios), usuarioId) };
}
