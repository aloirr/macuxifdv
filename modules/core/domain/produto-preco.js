/**
 * Custo, preço de venda e desconto máximo do produto (RN-CORE-18; RN-VEN-11; T-0062). Funções puras.
 * - Margem (%) = (preço − custo) ÷ preço; markup (%) = (preço − custo) ÷ custo; lucro = preço − custo. Calculados, nunca digitados.
 * - Produto sem preço de venda não é vendável; sem custo é vendável, mas "custo não informado".
 * - Preço mínimo = preço de venda × (1 − desconto máximo aplicável); desconto do produto vazio = padrão do tenant
 *   `desconto_maximo_produto_pct` (15%).
 * Dinheiro em centavos; percentuais com 2 casas. O CUSTO É DADO INTERNO: estas funções só rodam no BKO e na API (admin,
 * analista, gerente) e o custo nunca entra no pull do app nem no PDF do cliente.
 */
export const DESCONTO_MAXIMO_PRODUTO_PADRAO_PCT = 15;
const duasCasas = (n) => Math.round(n * 100) / 100;
const inteiroNaoNegativo = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
/** Produto com preço de venda positivo é vendável (RN-CORE-18). */
export function produtoVendavel(p) {
    return inteiroNaoNegativo(p.preco_venda_cents) && p.preco_venda_cents > 0;
}
/** Custo ausente (nulo) aparece como "custo não informado" no BKO e no monitor; custo zero é um valor informado. */
export function custoNaoInformado(p) {
    return !inteiroNaoNegativo(p.custo_cents);
}
/** Margem (%) = (preço − custo) ÷ preço; `null` sem preço positivo ou sem custo. Custo maior que o preço dá negativa. */
export function margemPct(precoCents, custoCents) {
    if (!inteiroNaoNegativo(precoCents) || precoCents <= 0 || !inteiroNaoNegativo(custoCents))
        return null;
    return duasCasas(((precoCents - custoCents) / precoCents) * 100);
}
/** Markup (%) = (preço − custo) ÷ custo; `null` sem custo, com custo zero (indefinido) ou sem preço. */
export function markupPct(precoCents, custoCents) {
    if (!inteiroNaoNegativo(precoCents) || !inteiroNaoNegativo(custoCents) || custoCents <= 0)
        return null;
    return duasCasas(((precoCents - custoCents) / custoCents) * 100);
}
/** Lucro (centavos) = preço − custo; `null` sem preço ou sem custo. Pode ser negativo. */
export function lucroCents(precoCents, custoCents) {
    if (!inteiroNaoNegativo(precoCents) || !inteiroNaoNegativo(custoCents))
        return null;
    return precoCents - custoCents;
}
const descontoValido = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
/** RN-VEN-11: desconto máximo aplicável = o do produto; vazio (ou inválido) = padrão do tenant (15% se o tenant não definir). */
export function descontoMaximoAplicavel(descontoDoProdutoPct, padraoDoTenantPct) {
    if (descontoValido(descontoDoProdutoPct))
        return descontoDoProdutoPct;
    return descontoValido(padraoDoTenantPct) ? padraoDoTenantPct : DESCONTO_MAXIMO_PRODUTO_PADRAO_PCT;
}
/** RN-VEN-11: preço mínimo (centavos) = preço de venda × (1 − desconto máximo aplicável), arredondado para cima ao centavo. */
export function precoMinimoCents(precoVendaCents, descontoDoProdutoPct, padraoDoTenantPct) {
    const centesimos = Math.round(descontoMaximoAplicavel(descontoDoProdutoPct, padraoDoTenantPct) * 100);
    return Math.ceil((precoVendaCents * (10_000 - centesimos)) / 10_000);
}
/** RN-VEN-11: o preço final do item não pode ficar abaixo do preço mínimo do produto. */
export function precoFinalRespeitaMinimo(precoFinalCents, precoVendaCents, descontoDoProdutoPct, padraoDoTenantPct) {
    return precoFinalCents >= precoMinimoCents(precoVendaCents, descontoDoProdutoPct, padraoDoTenantPct);
}
/**
 * RN-VEN-11: teto do desconto do item sobre o preço da TABELA do cliente, para o app travar o campo (nunca acima do
 * possível: trunca na 2ª casa). Tabela abaixo do preço mínimo = 0.
 */
export function limiteDeDescontoSobreTabela(precoTabelaCents, precoVendaCents, descontoDoProdutoPct, padraoDoTenantPct) {
    const minimo = precoMinimoCents(precoVendaCents, descontoDoProdutoPct, padraoDoTenantPct);
    if (precoTabelaCents <= 0 || precoTabelaCents <= minimo)
        return 0;
    return Math.floor(((precoTabelaCents - minimo) * 10_000) / precoTabelaCents) / 100;
}
/** Margem (%) vendendo no preço mínimo: quanto o desconto máximo consome da margem; `null` sem custo. */
export function margemNoMinimoPct(precoVendaCents, custoCents, descontoDoProdutoPct, padraoDoTenantPct) {
    return margemPct(precoMinimoCents(precoVendaCents, descontoDoProdutoPct, padraoDoTenantPct), custoCents);
}
