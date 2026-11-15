/**
 * Filial do preço (RN-CORE-39, RN-CAT-06; T-0149, ADR 0040): a tabela de preço do cliente vale por filial. Função pura:
 * a API (SQL) e o aparelho (linhas locais) carregam "em quais filiais a tabela tem item vivo" e chamam esta função,
 * então decidem igual.
 */
/**
 * RN-CORE-39: fallback POR TABELA, não por item. A tabela do cliente com algum item na filial dele usa essa filial; sem
 * item nenhum nela, usa os itens da MESMA tabela na filial padrão. Escolhida a filial, produto sem item nela continua
 * "Sem preço para este cliente" (RN-CAT-06): nunca cai produto a produto na padrão.
 */
export function filialDoPreco(e) {
    if (e.tabelaId === null || e.filialCliente === e.filialPadrao || e.filiaisComItens.includes(e.filialCliente)) {
        return { filialId: e.filialCliente, origem: 'cliente' };
    }
    return { filialId: e.filialPadrao, origem: 'padrao' };
}
/**
 * RN-CORE-39 no aparelho (mesma regra de `filialEfetiva` do Core, sobre as linhas locais): a filial do cliente vale se está viva
 * e ativa; senão (nula, apagada, inativa) a padrão. `null` = o aparelho ainda não recebeu as filiais (primeiro sync ou servidor
 * antigo): quem chama não filtra por filial, como antes da T-0149.
 */
export function filialDoClienteLocal(filialIdDoCliente, filiais) {
    const vivas = filiais.filter((f) => !f.deleted_at);
    const padrao = vivas.find((f) => f.padrao);
    if (!padrao)
        return null;
    const propria = filialIdDoCliente ? vivas.find((f) => f.id === filialIdDoCliente && f.ativo) : undefined;
    return { filialCliente: (propria ?? padrao).id, filialPadrao: padrao.id, nomes: Object.fromEntries(vivas.map((f) => [f.id, f.nome])) };
}
/**
 * RN-CORE-39 no BKO (Tabelas de preço): a tela mostra os itens de UMA filial. Sem filial escolhida vale a padrão; filial que não é
 * do tenant é recusada (nunca mistura as linhas de filiais diferentes do mesmo produto).
 */
export function filialDaTelaDePreco(escolhida, padrao, existentes) {
    if (!escolhida)
        return { ok: true, filialId: padrao };
    return existentes.includes(escolhida) ? { ok: true, filialId: escolhida } : { ok: false };
}
/**
 * RN-VEN-01, "Catálogo sem cliente" (T-0173): o Catálogo aberto pelo menu mostra o preço da tabela da FILIAL PADRÃO do vendedor.
 * Entre as tabelas ativas com item vivo nessa filial vale a de mais itens nela (empate: menor código); sem nenhuma, não há tabela
 * e todo produto fica "Sem preço", nunca o valor de outra tabela. Quem chama filtra os itens à filial padrão.
 */
export function tabelaDaFilialSemCliente(tabelas, itensDaFilial) {
    const contagem = new Map();
    for (const i of itensDaFilial)
        contagem.set(i.tabela_preco_id, (contagem.get(i.tabela_preco_id) ?? 0) + 1);
    return tabelaPorContagem(tabelas, contagem);
}
/** Mesma escolha de `tabelaDaFilialSemCliente`, com a contagem de itens vivos por tabela já feita (SQL `group by`). */
export function tabelaPorContagem(tabelas, contagem) {
    const candidatas = tabelas.filter((t) => t.ativo && (contagem.get(t.id) ?? 0) > 0);
    candidatas.sort((a, b) => contagem.get(b.id) - contagem.get(a.id) || (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0));
    return candidatas[0]?.id ?? null;
}
/**
 * RN-VEN-01: os preços do Catálogo sem cliente, a partir dos itens vivos da FILIAL: só os da tabela escolhida por
 * `tabelaDaFilialSemCliente`, sem tabela no item (o domain de preço trata "sem tabela" como a padrão). O app e a API chamam esta função.
 */
export function precosDaFilialSemCliente(tabelas, itensDaFilial) {
    return precosDaTabelaSemCliente(tabelaDaFilialSemCliente(tabelas, itensDaFilial), itensDaFilial);
}
/** Só filtra e converte: os itens da tabela já escolhida (nula = nenhum), sem tabela no item. */
export function precosDaTabelaSemCliente(tabelaId, itensDaFilial) {
    if (tabelaId === null)
        return [];
    return itensDaFilial
        .filter((i) => i.tabela_preco_id === tabelaId)
        .map((i) => ({ price_table_id: null, product_id: i.produto_id, price_cents: i.preco_cents, valid_from: i.vigencia_inicio, valid_to: i.vigencia_fim }));
}
/** RN-CORE-04: a filial escolhida está entre as filiais da carteira do usuário? (`daCarteira` nulo = todas). */
export function filialNaCarteira(filialId, daCarteira) {
    return daCarteira === null || daCarteira.includes(filialId);
}
