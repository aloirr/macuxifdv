import { precoVisivel } from './preco';
const porOrdem = (a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR');
export function montarArvore(linhas) {
    const vivos = new Map(linhas.filter((n) => n.ativo && !n.deleted_at).map((n) => [n.id, n]));
    // só entra quem chega à raiz por pais vivos, sem repetir ninguém no caminho (ciclo)
    const alcanca = (n) => {
        const visto = new Set();
        let atual = n;
        while (atual) {
            if (visto.has(atual.id))
                return false;
            visto.add(atual.id);
            if (atual.pai_id === null)
                return true;
            atual = vivos.get(atual.pai_id);
        }
        return false;
    };
    const nos = new Map([...vivos].filter(([, n]) => alcanca(n)));
    const filhos = new Map();
    for (const n of nos.values())
        filhos.set(n.pai_id, [...(filhos.get(n.pai_id) ?? []), n]);
    for (const l of filhos.values())
        l.sort(porOrdem);
    return { nos, filhos };
}
export const filhosDe = (a, paiId) => a.filhos.get(paiId) ?? [];
/** Da raiz até o nó (a trilha clicável); nó inexistente ou `null` = trilha vazia. */
export function trilhaDe(a, noId) {
    const trilha = [];
    let atual = noId === null ? undefined : a.nos.get(noId);
    while (atual) {
        trilha.unshift(atual);
        atual = atual.pai_id === null ? undefined : a.nos.get(atual.pai_id);
    }
    return trilha;
}
/** O nó e todos os níveis abaixo dele. */
export function descendentesDe(a, noId) {
    const ids = new Set();
    if (!a.nos.has(noId))
        return ids;
    const fila = [noId];
    while (fila.length > 0) {
        const id = fila.pop();
        ids.add(id);
        for (const f of filhosDe(a, id))
            fila.push(f.id);
    }
    return ids;
}
/** Produtos do nó e de tudo abaixo dele; `null` = a árvore inteira. */
export function produtosDoNo(a, vinculos, noId) {
    const nos = noId === null ? new Set(a.nos.keys()) : descendentesDe(a, noId);
    const produtos = new Set();
    for (const v of vinculos)
        if (!v.deleted_at && nos.has(v.no_id))
            produtos.add(v.produto_id);
    return produtos;
}
/** Quantos produtos há em cada filho de `paiId` (contando os níveis abaixo), só entre os `permitidos` quando informados. */
export function contarPorNo(a, vinculos, paiId, permitidos) {
    const r = new Map();
    for (const f of filhosDe(a, paiId)) {
        const ids = produtosDoNo(a, vinculos, f.id);
        r.set(f.id, permitidos ? [...ids].filter((p) => permitidos.has(p)).length : ids.size);
    }
    return r;
}
/**
 * RF-CAT-04 / RN-CAT-06: produtos com preço vigente na tabela do cliente. Cliente sem tabela = conjunto vazio; nunca
 * cai na tabela padrão nem em outra.
 */
export function produtosVendaveisNaTabela(itens, tabelaId, agora) {
    const r = new Set();
    if (tabelaId === null)
        return r;
    const daTabela = itens.filter((i) => i.price_table_id === tabelaId);
    for (const id of new Set(daTabela.map((i) => i.product_id)))
        if (precoVisivel(id, daTabela, [], { agora, tabela_cliente_id: tabelaId }).sellable)
            r.add(id);
    return r;
}
