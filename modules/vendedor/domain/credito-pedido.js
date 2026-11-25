/** O ERP informou limite ou disponível para o cliente (P4 A: sem isso, a prazo, o pedido vai para aprovação). */
export const limiteInformadoPeloErp = (f) => f.limite_cents > 0 || f.credito_disponivel_erp_cents != null;
const aVista = (prazo) => prazo === 0;
export function exigeAprovacaoPorCredito(i) {
    if (aVista(i.prazo_medio_dias) || i.total_cents <= 0)
        return false;
    return !i.limite_informado || i.total_cents > i.disponivel_cents;
}
export function exigeAprovacaoPorInadimplencia(i) {
    return i.maior_atraso_dias > i.limite_dias;
}
/** Os motivos financeiros do pedido, na ordem crédito, inadimplência (uma aprovação por motivo, P3 B). */
export function motivosFinanceirosDoPedido(i) {
    return [...(exigeAprovacaoPorCredito(i) ? ['credito'] : []), ...(exigeAprovacaoPorInadimplencia(i) ? ['inadimplencia'] : [])];
}
/** O disponível que alimenta o alerta "Limite de crédito excedido": `null` = sem alerta (à vista); sem limite informado = 0. */
export function disponivelParaAlerta(i) {
    if (aVista(i.prazo_medio_dias))
        return null;
    return i.limite_informado ? i.disponivel_cents : 0;
}
const reais = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
/**
 * RN-VEN-12 e RN-VEN-13 (T-0184): as aprovações financeiras do pedido, uma por motivo (P3 B), cada uma com o nível do parâmetro
 * (`niveisDosParametros`) e o texto que o aprovador lê. Ordem: crédito, inadimplência.
 */
export function aprovacoesFinanceiras(i) {
    const f = i.financeiro;
    if (!f)
        return [];
    const saida = [];
    if (exigeAprovacaoPorCredito({ prazo_medio_dias: i.prazo_medio_dias, total_cents: i.total_cents, limite_informado: f.limite_informado, disponivel_cents: f.disponivel_cents })) {
        const texto = f.limite_informado
            ? `Total de ${reais(i.total_cents)} acima do crédito disponível de ${reais(Math.max(0, f.disponivel_cents))}: aguardando ${i.niveis.credito}`
            : `Cliente sem limite de crédito informado pelo ERP: aguardando ${i.niveis.credito}`;
        saida.push({ motivo: 'credito', nivel: i.niveis.credito, texto });
    }
    if (exigeAprovacaoPorInadimplencia(f)) {
        saida.push({ motivo: 'inadimplencia', nivel: i.niveis.inadimplencia, texto: `Título vencido há ${f.maior_atraso_dias} dias (limite de ${f.limite_dias}): aguardando ${i.niveis.inadimplencia}` });
    }
    return saida;
}
