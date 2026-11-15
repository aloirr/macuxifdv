import { miniaturaNoTeto } from './miniatura';
export async function miniaturasLocais(leitor, ids) {
    const saida = new Map();
    if (ids.length === 0 || !leitor.linhasPorCampo)
        return saida;
    const linhas = await leitor.linhasPorCampo('produto_conteudo', 'produto_id', [...new Set(ids)]);
    for (const l of linhas) {
        if (l.deleted_at)
            continue;
        const m = l.miniatura;
        if (miniaturaNoTeto(m))
            saida.set(l.produto_id, m);
    }
    return saida;
}
