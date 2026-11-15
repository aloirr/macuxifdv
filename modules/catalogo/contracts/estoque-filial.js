/**
 * Regra única "quais depósitos valem e quanto sobra na filial" (RN-VEN-20, RN-CORE-39; RD-0126). Funções puras: a API de
 * `catalogo.estoque_filial@1` e o app do Vendedor usam estas mesmas, sem cópia. Mora em `contracts` para o Vendedor poder
 * importá-la; o `domain` do Catálogo reexporta.
 */
/**
 * Depósitos que valem para o pedido:
 * - tenant sem nenhum depósito ligado a filial (legado), ou pedido sem filial: todos;
 * - tenant com depósito ligado a filial: só os da filial do pedido (filial sem depósito = conjunto vazio, disponível 0).
 */
export function depositosDaFilial(depositos, filialId) {
    const comFilial = depositos.some((d) => !!d.filial_id);
    if (!filialId || !comFilial)
        return new Set(depositos.map((d) => d.id));
    return new Set(depositos.filter((d) => d.filial_id === filialId).map((d) => d.id));
}
/**
 * Disponível por produto na unidade base (nunca negativo). Recebe os saldos de TODOS os depósitos do tenant: produto sem
 * nenhuma linha de saldo é sem controle e fica fora da saída; produto com saldo só em outra filial sai com 0.
 */
export function saldoPorProdutoDaFilial(produtoIds, depositosValidos, saldos) {
    const soma = new Map();
    for (const s of saldos) {
        const parcela = depositosValidos.has(s.deposito_id) && Number.isFinite(s.quantidade) ? s.quantidade : 0;
        soma.set(s.produto_id, (soma.get(s.produto_id) ?? 0) + parcela);
    }
    return [...new Set(produtoIds)].filter((id) => soma.has(id)).map((id) => ({ produto_id: id, quantidade_base: Math.max(0, soma.get(id)) }));
}
