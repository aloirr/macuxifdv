export const LIMITE_SUGESTOES = 5;
/**
 * Percorre as linhas do pedido na ordem e, dentro de cada produto, as relações pela `ordem`. Tira o que já está no
 * pedido, o que não tem preço ou estoque, e não repete (o que já saiu em "complementares" não volta em "superiores").
 * `verPreco` falso (promotor, RN-CAT-05): saída vazia. `limite` vale por bloco e nunca passa de 5.
 */
export function sugestoesDoPedido(relacoes, produto_ids, vendaveis, limite = LIMITE_SUGESTOES, verPreco = true) {
    if (!verPreco)
        return { complementares: [], superiores: [] };
    const max = Math.max(0, Math.min(LIMITE_SUGESTOES, Math.trunc(limite)));
    const noPedido = new Set(produto_ids);
    const usados = new Set();
    const vivas = relacoes.filter((r) => r.ativo && !r.deleted_at && r.produto_id !== r.relacionado_id);
    const montar = (tipo) => {
        const lista = [];
        for (const origem of new Set(produto_ids)) {
            const doProduto = vivas.filter((r) => r.tipo === tipo && r.produto_id === origem).sort((a, b) => a.ordem - b.ordem);
            for (const r of doProduto) {
                if (lista.length >= max)
                    return lista;
                const alvo = r.relacionado_id;
                if (noPedido.has(alvo) || usados.has(alvo))
                    continue;
                const v = vendaveis.get(alvo);
                if (!v || v.preco_cents === null || v.preco_cents <= 0 || !(v.estoque > 0))
                    continue;
                usados.add(alvo);
                lista.push({ produto_id: alvo, tipo, origem_produto_id: origem, preco_cents: v.preco_cents });
            }
        }
        return lista;
    };
    return { complementares: montar('complementar'), superiores: montar('superior') };
}
/** Junta o preço da tabela do cliente (`precosDoCliente`) ao saldo por produto; produto sem saldo conhecido conta 0. */
export function vendaveisDe(precos, saldos) {
    return new Map(precos.itens.map((i) => [i.produto_id, { preco_cents: i.preco_cents, estoque: saldos.get(i.produto_id) ?? 0 }]));
}
