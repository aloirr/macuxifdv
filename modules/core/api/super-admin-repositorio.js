const dt = (v) => (v === null || v === undefined ? null : new Date(v));
export const fabricaSuperAdminSql = (banco) => {
    const um = async (sql, params = []) => banco.semTenant(async (db) => (await db.query(`select ${sql} as r`, params)).rows[0]?.r);
    /** Funções que devolvem `table (...)`. */
    const linhasDe = async (sql, params = []) => banco.semTenant(async (db) => (await db.query(`select * from ${sql}`, params)).rows);
    const estado = (r) => ({ falhas: Number(r?.falhas ?? 0), bloqueado_ate: dt(r?.bloqueado_ate) });
    return {
        async tentativaEstado(chave) {
            return estado((await linhasDe('plataforma.sa_tentativa_estado($1)', [chave]))[0]);
        },
        async tentativaFalha(chave) {
            return estado((await linhasDe('plataforma.sa_tentativa_falha($1)', [chave]))[0]);
        },
        async tentativaSucesso(chave) {
            await um('plataforma.sa_tentativa_sucesso($1)', [chave]);
        },
        async contasParaLogin(email) {
            const linhas = await linhasDe('plataforma.sa_contas_para_login($1)', [email]);
            return linhas.map((r) => ({
                tipo: r.tipo === 'super_admin' ? 'super_admin' : 'admin_cliente',
                conta_id: String(r.conta_id),
                tenant_id: r.tenant_id ? String(r.tenant_id) : null,
                tenant_codigo: r.tenant_codigo ? String(r.tenant_codigo) : null,
                tenant_nome: r.tenant_nome ? String(r.tenant_nome) : null,
                senha_hash: String(r.senha_hash),
                trocar_senha: r.trocar_senha === true,
                senha_expira_em: dt(r.senha_expira_em),
                sessao_versao: Number(r.sessao_versao ?? 0),
            }));
        },
        async abrirSessao(entrada) {
            const r = (await linhasDe('plataforma.sa_abrir_sessao_portal($1::jsonb)', [JSON.stringify(entrada)]))[0];
            return r ? { sessao_id: r.sessao_id, expira_em: new Date(r.expira_em) } : null;
        },
        async escolherEmpresa(sid, tenantId) {
            const r = (await linhasDe('plataforma.sa_escolher_empresa($1, $2)', [sid, tenantId]))[0];
            return r ? { tenant_id: r.tenant_id, usuario_id: r.usuario_id, codigo: r.codigo, nome: r.nome } : null;
        },
        async sessaoValida(sid) {
            const r = (await linhasDe('plataforma.sa_sessao_valida($1)', [sid]))[0];
            return r
                ? {
                    tipo: r.tipo === 'super_admin' ? 'super_admin' : 'admin_cliente',
                    super_admin_id: r.super_admin_id ? String(r.super_admin_id) : null,
                    tenant_id: r.tenant_id ? String(r.tenant_id) : null,
                    usuario_id: r.usuario_id ? String(r.usuario_id) : null,
                    expira_em: new Date(r.expira_em),
                    sem_filial: r.sem_filial === true,
                }
                : null;
        },
        async listarEmpresas(sid) {
            const r = await um('plataforma.sa_listar_tenants($1)', [sid]);
            // a função devolve ListaEmpresasSchema: o nome da empresa é `razao_social` (R-20261107-165858)
            return (r?.itens ?? []).map((e) => ({ id: e.id, codigo: e.codigo, nome: e.razao_social }));
        },
        async revogarSessao(sid) {
            await um('plataforma.sa_revogar($1)', [sid]);
        },
        async auditar(l) {
            await um('plataforma.sa_auditar($1::jsonb)', [JSON.stringify({ ...l, tenant_id: null })]);
        },
    };
};
