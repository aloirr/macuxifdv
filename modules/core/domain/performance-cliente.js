/**
 * Aba Performance da ficha do cliente (RN-CORE-50) e botões do rodapé (RN-CORE-51). Funções puras sobre as linhas que o aparelho
 * já tem (pedido, pedido_item, visita e o resumo `cliente_visita_resumo`): sem leitura de tabela de outro módulo.
 */
import { dataLocal } from './checkin';
const STATUS_FORA = new Set(['draft', 'cancelled', 'rejected']);
export const LIMITE_ITENS_PERFORMANCE = 20;
const vale = (p) => p.deleted_at === null && !STATUS_FORA.has(p.status);
/** RN-CORE-50: média, em dias, do prazo dos pedidos do cliente (inteiro); sem nenhum pedido com prazo, nulo. */
export function prazoMedioDoCliente(pedidos) {
    const prazos = pedidos.filter((p) => vale(p) && typeof p.prazo_medio_dias === 'number').map((p) => p.prazo_medio_dias);
    if (prazos.length === 0)
        return null;
    return Math.round(prazos.reduce((s, x) => s + x, 0) / prazos.length);
}
/** RN-CORE-50: itens só dos pedidos que valem (sem rascunho, cancelado, rejeitado ou apagado). */
export function itensDoPedidoVisiveis(pedidos, itens) {
    const ok = new Set(pedidos.filter(vale).map((p) => p.id));
    return itens.filter((i) => ok.has(i.pedido_id));
}
/** RN-CORE-50: um item por produto (a última compra dele), do mais recente ao mais antigo, até `limite` (20). */
export function ultimosItensComprados(itens, limite = LIMITE_ITENS_PERFORMANCE) {
    const ultimo = new Map();
    for (const i of itens) {
        const atual = ultimo.get(i.produto_id);
        if (!atual || i.data > atual.data)
            ultimo.set(i.produto_id, i);
    }
    return [...ultimo.values()].sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0)).slice(0, limite);
}
/**
 * RN-CORE-50: visitas do cliente. Com o resumo do servidor: total do servidor + check-ins do aparelho posteriores a ele, e a
 * última visita é a mais recente entre as duas fontes. Sem o resumo: só a contagem e a última visita do aparelho.
 */
export function resumoDeVisitas(visitas, fuso, servidor = null) {
    const ordenadas = [...visitas].sort((a, b) => (a.checkin_em < b.checkin_em ? 1 : -1));
    const topo = ordenadas[0];
    const dataTopo = topo ? dataLocal(topo.checkin_em, fuso) : null;
    const doAparelho = { total: visitas.length, ultima_data: dataTopo, ultimo_usuario_id: topo?.usuario_id ?? null, ultimo_usuario_nome: null };
    if (servidor) {
        const corte = servidor.ultima_visita_em ? Date.parse(servidor.ultima_visita_em) : -Infinity;
        const depois = visitas.filter((v) => Date.parse(v.checkin_em) > corte).length;
        const total = servidor.total_visitas + depois;
        if (depois > 0 || !servidor.ultima_visita_em)
            return { ...doAparelho, total };
        return { total, ultima_data: dataLocal(servidor.ultima_visita_em, fuso), ultimo_usuario_id: servidor.ultima_visita_usuario_id, ultimo_usuario_nome: servidor.ultima_visita_usuario_nome };
    }
    return doAparelho;
}
/** RN-CORE-50: "Você" quando o último check-in é do próprio usuário; senão o nome do resumo ou, sem ele, o `vendedor_nome` dos pedidos. */
export function quemVisitouPorUltimo(r, meuId, nomesPorUsuario) {
    if (!r.ultimo_usuario_id)
        return null;
    if (r.ultimo_usuario_id === meuId)
        return 'Você';
    return r.ultimo_usuario_nome ?? nomesPorUsuario.get(r.ultimo_usuario_id) ?? null;
}
/**
 * RN-CORE-51: rodapé da ficha. "Check-in" quando não há atendimento aberto neste cliente, o check-in é permitido (RN-CORE-52) e o
 * cliente não foi visitado hoje (RN-CORE-13); "Checkout" só com atendimento aberto neste cliente; "Pesquisa" só com a extensão presente.
 */
export function botoesDoRodapeCliente(e) {
    return { checkin: !e.atendimentoAqui && e.checkinPermitido && !e.visitadoHoje, checkout: e.atendimentoAqui, pesquisa: e.temPesquisa };
}
