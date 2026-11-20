/**
 * Leitura da hierarquia do tenant (RN-CORE-04): equipes ativas e usuários, pela conexão com RLS. Um lugar só para a leitura, usado por clientes,
 * usuários, importação da equipe e gestor imediato.
 */
import type { ClienteBanco } from '@macuxi/platform-sdk';
import type { EquipeLinha, UsuarioLinha } from '../domain';

export async function equipesAtivas(db: ClienteBanco): Promise<EquipeLinha[]> {
  return (await db.query<EquipeLinha>('select id, equipe_pai_id, responsavel_id from core.equipe where deleted_at is null and ativo')).rows;
}

export async function lerHierarquiaDoTenant(db: ClienteBanco): Promise<{ equipes: EquipeLinha[]; usuarios: UsuarioLinha[] }> {
  const equipes = await equipesAtivas(db);
  const usuarios = (await db.query<UsuarioLinha>('select id, nome, perfil, equipe_id, ativo from core.usuario where deleted_at is null')).rows;
  return { equipes, usuarios };
}
