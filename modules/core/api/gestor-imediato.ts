/**
 * Gestor imediato do usuário (Perfil do app; RN-CORE-04). A regra é a do domain (`gestorImediatoDe`: superior imediato, ativo); aqui a
 * API lê as equipes e os usuários do tenant (RLS) e devolve só `{ id, nome }`, que vai na sessão do próprio usuário.
 */
import type { ClienteBanco } from '@macuxi/platform-sdk';
import type { GestorImediato } from '../contracts';
import { gestorImediatoDe } from '../domain';
import { lerHierarquiaDoTenant } from './hierarquia-leitura';

export async function gestorImediatoDoUsuario(db: ClienteBanco, usuarioId: string): Promise<{ gestor_imediato: GestorImediato | null }> {
  const { equipes, usuarios } = await lerHierarquiaDoTenant(db);
  return { gestor_imediato: gestorImediatoDe(equipes, usuarios, usuarioId) };
}
