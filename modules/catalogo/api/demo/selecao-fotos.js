export function escolherProdutosDeVitrine(itens, limite) {
    const grupos = new Map();
    for (const i of itens) {
        const chave = (i.line ?? '').trim().toLowerCase();
        grupos.set(chave, [...(grupos.get(chave) ?? []), i]);
    }
    const filas = [...grupos.values()];
    const saida = [];
    for (let rodada = 0; saida.length < limite; rodada++) {
        let achou = false;
        for (const fila of filas) {
            const i = fila[rodada];
            if (!i)
                continue;
            achou = true;
            if (saida.length < limite)
                saida.push(i);
        }
        if (!achou)
            break;
    }
    return saida;
}
