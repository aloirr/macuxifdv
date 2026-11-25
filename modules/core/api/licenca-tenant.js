export async function licencaDoTenant(db) {
    const lic = await db.query("select modulo from plataforma.tenant_modulo where modulo in ('integracao', 'vendedor') and ativo and deleted_at is null");
    return { integracaoNoTenant: lic.rows.some((r) => r.modulo === 'integracao'), vendedorNoTenant: lic.rows.some((r) => r.modulo === 'vendedor') };
}
