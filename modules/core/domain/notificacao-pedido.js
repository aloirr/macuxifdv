const TEXTOS = {
    aprovado: { titulo: 'Pedido aprovado', prioridade: 'alta' },
    rejeitado: { titulo: 'Pedido rejeitado', prioridade: 'alta' },
    integrado_erp: { titulo: 'Pedido integrado ao ERP', prioridade: 'normal' },
    faturado_parcial: { titulo: 'Pedido faturado em parte', prioridade: 'normal' },
    faturado_total: { titulo: 'Pedido faturado', prioridade: 'normal' },
};
export function notificacaoDePedido(e) {
    const link = `/m/pedido?id=${e.pedidoId}`;
    if (e.tipo === 'aprovacao_solicitada') {
        const nA = numeroPedidoNoTitulo(e.numero);
        return { destino: 'aprovador', titulo: nA ? `Pedido ${nA} para aprovar` : 'Pedido para aprovar', corpo: '', link, prioridade: 'alta' };
    }
    const t = TEXTOS[e.para];
    if (!t)
        return null;
    const corpo = e.para === 'rejeitado' && e.motivo ? 'Motivo: ' + e.motivo : '';
    const n = numeroPedidoNoTitulo(e.numero);
    return { destino: 'vendedor', titulo: n ? t.titulo.replace('Pedido', `Pedido ${n}`) : t.titulo, corpo, link, prioridade: t.prioridade };
}
/** Rotas internas do app que identificam notificações de sistema com entidades próprias. */
export const LINK_METAS = '/m/metas';
export const LINK_ROTA = '/m/rota';
/**
 * Entidades do pull que mudam com a notificação (`data.entidades` do push, nomes de sync do manifesto).
 * Pedido: status e linha do tempo vêm de `pedido` e `pedido_evento`. Meta e rota do dia são notificações de `sistema`
 * identificadas pelo link. Só nomes, nunca dado pessoal.
 */
export function entidadesDoPush(tipo, link) {
    if (tipo === 'pedido')
        return ['pedido', 'pedido_evento', 'notificacao'];
    if (link === LINK_METAS)
        return ['meta', 'notificacao'];
    if (link === LINK_ROTA)
        return ['rota', 'rota_parada', 'notificacao'];
    return ['notificacao'];
}
/** Meta definida ou alterada no BKO (RN-CORE-20): avisa o dono da meta. */
export function notificacaoDeMeta(e) {
    return e.valorAnterior === null
        ? { titulo: 'Nova meta definida', corpo: '', link: LINK_METAS, prioridade: 'normal' }
        : { titulo: 'Meta atualizada', corpo: '', link: LINK_METAS, prioridade: 'normal' };
}
/** Rota do dia publicada ou alterada (hoje): avisa o vendedor. */
export function notificacaoDeRotaDoDia() {
    return { titulo: 'Rota do dia atualizada', corpo: '', link: LINK_ROTA, prioridade: 'normal' };
}
/** Número do pedido com 6 dígitos ("000010"); sem número, `null` (o título fica sem ele). */
export function numeroPedidoNoTitulo(numero) {
    if (numero === null || numero === undefined || numero === '')
        return null;
    const t = String(numero).trim();
    return /^\d+$/.test(t) ? t.padStart(6, '0') : t;
}
