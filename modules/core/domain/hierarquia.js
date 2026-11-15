/**
 * Superior direto = responsável da equipe do usuário; se o próprio usuário é o responsável (ou a equipe não tem
 * responsável), sobe pela equipe-pai até achar outro responsável. Ciclo na árvore de equipes termina sem superior.
 */
export function montarHierarquia(equipes, usuarios) {
    const porId = new Map(equipes.map((e) => [e.id, e]));
    const superiorDe = (u) => {
        const vistos = new Set();
        let e = u.equipe_id ? porId.get(u.equipe_id) : undefined;
        while (e && !vistos.has(e.id)) {
            vistos.add(e.id);
            if (e.responsavel_id && e.responsavel_id !== u.id)
                return e.responsavel_id;
            e = e.equipe_pai_id ? porId.get(e.equipe_pai_id) : undefined;
        }
        return null;
    };
    return usuarios.map((u) => ({ id: u.id, nome: u.nome, perfil: u.perfil, superior_id: superiorDe(u), ativo: u.ativo }));
}
/** Subordinados diretos e indiretos de `id` (sem ele). Robusto a ciclo. */
export function subordinadosDe(membros, id) {
    const filhos = new Map();
    for (const m of membros)
        if (m.superior_id)
            filhos.set(m.superior_id, [...(filhos.get(m.superior_id) ?? []), m.id]);
    const vistos = new Set([id]);
    const fila = [id];
    while (fila.length > 0) {
        for (const f of filhos.get(fila.shift()) ?? []) {
            if (vistos.has(f))
                continue;
            vistos.add(f);
            fila.push(f);
        }
    }
    vistos.delete(id);
    return [...vistos];
}
/** Recorte do que o usuário enxerga (`ctx.usuariosVisiveis()`); superior fora do recorte vira `null` (não revela quem está acima). */
export function recortarHierarquia(membros, visiveis) {
    if (visiveis === 'tenant')
        return [...membros];
    return membros.filter((m) => visiveis.has(m.id)).map((m) => ({ ...m, superior_id: m.superior_id && visiveis.has(m.superior_id) ? m.superior_id : null }));
}
