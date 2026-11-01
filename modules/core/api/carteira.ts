/**
 * Escopo de carteira (RN-CORE-04): quais clientes o usuário enxerga. A decisão por perfil é do domínio
 * (`clientesVisiveis`); aqui só buscam-se os conjuntos no banco, dentro de `comTenant` (RLS, RN-CORE-05).
 * - vendedor/promotor → própria carteira; supervisor → + carteiras da(s) equipe(s) que ele responde;
 * - gerente → + equipes abaixo; analista/assistente/admin → tenant (nenhuma consulta).
 * Vigência: vínculo com `fim` já passado ou `inicio` futuro não conta.
 */
import { escopoDoPerfil, type AcessoBanco, type ClienteBanco, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import { clientesVisiveis } from '../domain';

const VIGENTE = '(c.inicio is null or c.inicio <= current_date) and (c.fim is null or c.fim >= current_date) and c.deleted_at is null';

export const EQUIPES_DO_RESPONSAVEL = `
  with recursive eq as (
    select id, 0 as nivel from core.equipe where responsavel_id = $1 and deleted_at is null and ativo
    union all
    select e.id, eq.nivel + 1 from core.equipe e join eq on e.equipe_pai_id = eq.id where e.deleted_at is null and e.ativo
  )`;

async function ids(db: ClienteBanco, sql: string, usuarioId: string): Promise<Set<string>> {
  const r = await db.query<{ cliente_id: string }>(sql, [usuarioId]);
  return new Set(r.rows.map((l) => l.cliente_id));
}

export async function carteiraDoUsuario(usuario: UsuarioAutenticado, banco: AcessoBanco): Promise<ReadonlySet<string> | 'tenant'> {
  const escopo = escopoDoPerfil(usuario.perfil);
  if (escopo === 'tenant') return 'tenant';
  return banco.comTenant(usuario.tenant_id, async (db) => {
    const propria = await ids(db, `select c.cliente_id from core.carteira c where c.usuario_id = $1 and ${VIGENTE}`, usuario.id);
    const vazio = new Set<string>();
    const equipe =
      escopo === 'carteira'
        ? vazio
        : await ids(
            db,
            `${EQUIPES_DO_RESPONSAVEL}
             select c.cliente_id from core.carteira c join core.usuario u on u.id = c.usuario_id join eq on eq.id = u.equipe_id
              where eq.nivel = 0 and ${VIGENTE}`,
            usuario.id,
          );
    const abaixo =
      escopo !== 'equipes_abaixo'
        ? vazio
        : await ids(
            db,
            `${EQUIPES_DO_RESPONSAVEL}
             select c.cliente_id from core.carteira c join core.usuario u on u.id = c.usuario_id join eq on eq.id = u.equipe_id
              where eq.nivel > 0 and ${VIGENTE}`,
            usuario.id,
          );
    return clientesVisiveis(usuario.perfil, { propria, equipe, equipesAbaixo: abaixo });
  });
}
