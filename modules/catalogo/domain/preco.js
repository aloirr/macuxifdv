/** RN-CAT-06: item fora da tabela do cliente em contexto. */
export const MENSAGEM_SEM_PRECO_CLIENTE = 'Sem preço para este cliente.';
/** Sem cliente em contexto e sem preço na tabela padrão do tenant. */
export const MENSAGEM_SEM_PRECO = 'Sem preço cadastrado para este produto.';
/** Desconto percentual em centavos inteiros, meia para cima (RN-VEN-02). `pct` entre 0 e 100, até 2 casas. */
export function descontoPct(cents, pct) {
    if (!Number.isInteger(cents) || cents < 0)
        throw new RangeError('O preço deve ser um número inteiro de centavos.');
    if (!Number.isFinite(pct) || pct < 0 || pct > 100)
        throw new RangeError('O desconto deve ficar entre 0% e 100%.');
    const pontosBase = Math.round(pct * 100); // centésimos de ponto percentual
    const x = cents * (10_000 - pontosBase);
    return Math.floor((2 * x + 10_000) / 20_000);
}
const instante = (s) => {
    if (s === null || s === undefined)
        return null;
    const t = Date.parse(s);
    return Number.isNaN(t) ? NaN : t;
};
const precoValido = (n) => typeof n === 'number' && Number.isInteger(n) && n > 0;
function vigente(de, ate, agora) {
    const i = instante(de);
    const f = instante(ate);
    if (Number.isNaN(i) || Number.isNaN(f))
        return false;
    return (i === null || i <= agora) && (f === null || agora < f);
}
/** Melhor linha vigente de uma tabela para o produto: início mais recente; empate, o maior preço. */
function escolherItem(itens, produto, tabela, agora) {
    const validos = itens.filter((i) => i.product_id === produto && i.price_table_id === tabela && precoValido(i.price_cents) && vigente(i.valid_from, i.valid_to, agora));
    if (validos.length === 0)
        return null;
    return validos.reduce((a, b) => {
        const ia = instante(a.valid_from) ?? -Infinity;
        const ib = instante(b.valid_from) ?? -Infinity;
        if (ia !== ib)
            return ia > ib ? a : b;
        return a.price_cents >= b.price_cents ? a : b;
    });
}
function precoDaPromocao(base, p) {
    if (!Number.isFinite(p.valor))
        return null;
    let preco;
    if (p.tipo === 'preco_fixo') {
        if (!precoValido(p.valor))
            return null;
        preco = p.valor;
    }
    else {
        if (p.valor <= 0 || p.valor >= 100)
            return null;
        preco = descontoPct(base, p.valor);
    }
    return preco > 0 && preco < base ? preco : null;
}
/**
 * Preço que o usuário vê/usa agora para o produto. Sem preço na tabela aplicável ⇒ não vendável (RN-VEN-01);
 * com cliente em contexto, a tabela padrão nunca é usada (RN-CAT-06). Quem pode ver o preço é `visibilidade.ts`.
 */
export function precoVisivel(produtoId, itens, promocoes, ctx) {
    const agora = Date.parse(ctx.agora);
    if (Number.isNaN(agora))
        throw new RangeError('Informe o instante da consulta em ISO 8601 UTC.');
    const semPreco = {
        product_id: produtoId,
        price_cents: null,
        base_cents: null,
        on_promotion: false,
        promotion_id: null,
        promotion_ends_at: null,
        price_table_id: null,
        source: null,
        sellable: false,
        reason: 'sem_preco',
        notice: ctx.tabela_cliente_id ? MENSAGEM_SEM_PRECO_CLIENTE : MENSAGEM_SEM_PRECO,
    };
    let escolhido = null;
    if (ctx.tabela_condicao_id) {
        const i = escolherItem(itens, produtoId, ctx.tabela_condicao_id, agora);
        if (i)
            escolhido = { item: i, source: 'condicao' };
    }
    if (!escolhido) {
        if (ctx.tabela_cliente_id) {
            const i = escolherItem(itens, produtoId, ctx.tabela_cliente_id, agora);
            if (i)
                escolhido = { item: i, source: 'cliente' };
        }
        else {
            const i = escolherItem(itens, produtoId, null, agora);
            if (i)
                escolhido = { item: i, source: 'padrao' };
        }
    }
    if (!escolhido)
        return semPreco;
    const base = escolhido.item.price_cents;
    const tabela = escolhido.item.price_table_id;
    let melhor = null;
    for (const p of promocoes) {
        if (p.product_id !== produtoId || !vigente(p.valid_from, p.valid_to, agora))
            continue;
        if (p.price_table_id !== null && p.price_table_id !== tabela)
            continue;
        const preco = precoDaPromocao(base, p);
        if (preco === null)
            continue;
        if (!melhor || preco < melhor.preco || (preco === melhor.preco && p.id < melhor.promo.id))
            melhor = { promo: p, preco };
    }
    return {
        product_id: produtoId,
        price_cents: melhor ? melhor.preco : base,
        base_cents: base,
        on_promotion: melhor !== null,
        promotion_id: melhor ? melhor.promo.id : null,
        promotion_ends_at: melhor ? new Date(Date.parse(melhor.promo.valid_to)).toISOString() : null,
        price_table_id: tabela,
        source: escolhido.source,
        sellable: true,
        reason: null,
        notice: null,
    };
}
