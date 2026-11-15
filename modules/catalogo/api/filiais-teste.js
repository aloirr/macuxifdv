export function consultarFiliaisDeTeste(c, cfg = {}) {
    return async (def, entrada) => {
        if (def.nome !== 'core.filiais@1')
            throw new Error(`consulta não simulada no teste: ${def.nome}`);
        const padrao = (await c.query('select core.filial_padrao_id(plataforma.tenant_atual()) as id')).rows[0].id;
        const filial = (id, nome, padraoDoTenant) => ({ id, codigo: id.slice(-4), nome, cidade: null, uf: null, padrao: padraoDoTenant, ativo: true, external_id: null });
        const filiais = [filial(padrao, 'Filial padrão', true), ...Object.entries(cfg.outras ?? {}).map(([id, nome]) => filial(id, nome, false))];
        const efetiva = (cliente) => cfg.clientes?.[cliente] ?? padrao;
        return {
            padrao_id: padrao,
            filiais,
            clientes: (entrada.cliente_ids ?? []).map((cliente_id) => ({ cliente_id, filial_id: efetiva(cliente_id) })),
            por_external_id: [],
            da_carteira: entrada.escopo === 'carteira' ? (cfg.daCarteira === undefined ? [...new Set([padrao, ...Object.values(cfg.clientes ?? {})])] : cfg.daCarteira) : null,
        };
    };
}
