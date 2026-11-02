/**
 * Escopo de carteira (RN-CORE-04): quais clientes o usuário enxerga. A decisão por perfil é do domínio
 * (`clientesVisiveis`); aqui só buscam-se os conjuntos no banco, dentro de `comTenant` (RLS, RN-CORE-05).
 * - vendedor/promotor → própria carteira; supervisor → + carteiras da(s) equipe(s) que ele responde;
 * - gerente → + equipes abaixo; analista/assistente/admin → tenant (nenhuma consulta).
 * Vigência: vínculo com `fim` já passado ou `inicio` futuro não conta.
 */
import { escopoDoPerfil, fusoDoTenantOuPadrao, type AcessoBanco, type ClienteBanco, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import { clientesVisiveis, dataLocal } from '../domain';

/** `$2` = hoje no fuso do tenant (AAAA-MM-DD), não o `current_date` UTC do banco. */
const VIGENTE = '(c.inicio is null or c.inicio <= $2::date) and (c.fim is null or c.fim >= $2::date) and c.deleted_at is null';

export const EQUIPES_DO_RESPONSAVEL = `
  with recursive eq as (
    select id, 0 as nivel from core.equipe where responsavel_id = $1 and deleted_at is null and ativo
    union all
    select e.id, eq.nivel + 1 from core.equipe e join eq on e.equipe_pai_id = eq.id where e.deleted_at is null and e.ativo
  )`;

async function ids(db: ClienteBanco, sql: string, usuarioId: string, hoje: string): Promise<Set<string>> {
  const r = await db.query<{ cliente_id: string }>(sql, [usuarioId, hoje]);
  return new Set(r.rows.map((l) => l.cliente_id));
}

export async function carteiraDoUsuario(
  usuario: UsuarioAutenticado,
  banco: AcessoBanco,
  /** Relógio e fuso injetáveis (testes); o fuso padrão é o do tenant, lido do banco. */
  opcoes: { agora?: () => Date; fuso?: string } = {},
): Promise<ReadonlySet<string> | 'tenant'> {
  const escopo = escopoDoPerfil(usuario.perfil);
  if (escopo === 'tenant') return 'tenant';
  return banco.comTenant(usuario.tenant_id, async (db) => {
    const fuso = opcoes.fuso ?? fusoDoTenantOuPadrao((await db.query<{ fuso: string }>('select fuso from plataforma.tenant where id = plataforma.tenant_atual()')).rows[0]?.fuso);
    const hoje = dataLocal((opcoes.agora ?? (() => new Date()))(), fuso);
    const propria = await ids(db, `select c.cliente_id from core.carteira c where c.usuario_id = $1 and ${VIGENTE}`, usuario.id, hoje);
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
            hoje,
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
            hoje,
          );
    return clientesVisiveis(usuario.perfil, { propria, equipe, equipesAbaixo: abaixo });
  });
}
