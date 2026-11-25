export async function equipesAtivas(db) {
    return (await db.query('select id, equipe_pai_id, responsavel_id from core.equipe where deleted_at is null and ativo')).rows;
}
export async function lerHierarquiaDoTenant(db) {
    const equipes = await equipesAtivas(db);
    const usuarios = (await db.query('select id, nome, perfil, equipe_id, ativo from core.usuario where deleted_at is null')).rows;
    return { equipes, usuarios };
}
