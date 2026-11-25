import { aplicarPendentesVisita, compraMediaMesCents, haversineKm, mesNaJanela12, statusDasParadas } from '../../domain';
const num = (v) => {
    if (v === null || v === undefined || v === '')
        return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};
const diasEntre = (de, ate) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);
/** Resumo do cliente para as telas de rota e check-in, calculado das linhas locais (campos sem fonte no Sprint 1 ficam neutros). */
export function resumoDoCliente(c, fin, titulos, historico, hoje) {
    const abertos = titulos.filter((t) => t.situacao === 'aberto');
    const vencidos = abertos.filter((t) => t.vencimento < hoje);
    const ultima = historico.filter((h) => mesNaJanela12(h.ano_mes, hoje)).map((h) => h.ultima_compra_em).filter((d) => Boolean(d)).sort().at(-1) ?? null;
    const mesAtual = hoje.slice(0, 7);
    const endereco = [c.logradouro, c.numero].filter(Boolean).join(', ');
    return {
        id: c.id,
        erp_code: c.documento ?? '',
        trade_name: c.nome_fantasia?.trim() || c.razao_social,
        legal_name: c.razao_social,
        cnpj: c.documento ?? '',
        segment: c.segmento ?? '',
        abc_curve: 'C',
        address: endereco,
        city: c.cidade ?? '',
        district: c.bairro ?? '',
        lat: num(c.latitude),
        lng: num(c.longitude),
        phone: c.telefone ?? '',
        email: c.email ?? '',
        seller_id: '',
        seller_name: '',
        customer_since: c.updated_at.slice(0, 10),
        credit_limit_cents: fin?.limite_cents ?? 0,
        open_receivables_cents: fin?.saldo_aberto_cents ?? abertos.reduce((s, t) => s + t.saldo_cents, 0),
        available_credit_cents: fin?.credito_disponivel_cents ?? Math.max(0, (fin?.limite_cents ?? 0) - (fin?.saldo_aberto_cents ?? 0)),
        overdue_count: vencidos.length,
        overdue_cents: vencidos.reduce((s, t) => s + t.saldo_cents, 0),
        last_purchase_at: ultima,
        days_since_purchase: ultima ? Math.max(0, diasEntre(ultima, hoje)) : null,
        avg_monthly_cents: compraMediaMesCents([...historico], hoje), // RN-CORE-40: total da janela de 12 meses ÷ 12
        positivated_this_month: historico.some((h) => h.ano_mes === mesAtual && h.pedidos > 0),
        price_table_id: null,
    };
}
/** Itens `visita` e `visita_checkout` pendentes e aceitos ainda não trazidos pelo pull (ADR 0009 §3, D-3), na ordem da fila, vistos como pendentes da sobreposição. */
export function pendentesDaFila(fila) {
    const saida = [];
    for (const i of fila) {
        if (i.situacao !== 'pendente' && i.situacao !== 'falhou' && i.situacao !== 'aceito')
            continue;
        const p = (i.payload ?? {});
        if (i.entidade === 'visita' && typeof p.id === 'string' && typeof p.cliente_id === 'string' && typeof p.checkin_em === 'string') {
            saida.push({
                tipo: 'checkin',
                id: p.id,
                cliente_id: p.cliente_id,
                checkin_em: p.checkin_em,
                extra: Boolean(p.extra),
                rota_parada_id: p.rota_parada_id ?? null,
                sem_gps: p.lat == null || p.lng == null,
            });
        }
        else if (i.entidade === 'visita_checkout' && typeof p.visita_id === 'string' && typeof p.checkout_em === 'string' && typeof p.resultado === 'string') {
            saida.push({
                tipo: 'checkout',
                id: i.id,
                visita_id: p.visita_id,
                checkout_em: p.checkout_em,
                resultado: p.resultado,
                pedido_id: p.pedido_id ?? null,
                motivo_id: p.motivo_id ?? null,
                motivo_texto: p.motivo_texto ?? null,
                foto_fachada_id: p.foto_fachada_id ?? null,
            });
        }
    }
    return saida;
}
function paraLocal(v, nomes, motivos) {
    const pedido = v.resultado === 'pedido';
    const motivo = v.motivo_id ? motivos.get(v.motivo_id) : undefined;
    const fechada = Boolean(v.checkout_em);
    return {
        id: v.id,
        seller_id: v.usuario_id,
        customer_id: v.cliente_id,
        customer_name: nomes.get(v.cliente_id) ?? '',
        route_stop_id: v.rota_parada_id ?? null,
        checkin_at: v.checkin_em,
        lat: num(v.checkin_lat),
        lng: num(v.checkin_lng),
        outcome: pedido ? 'order' : v.resultado === 'sem_pedido' || v.resultado === 'cliente_fechado' ? 'no_order' : null,
        no_order_reason: pedido ? '' : (motivo?.descricao ?? v.motivo_texto ?? ''),
        order_id: v.pedido_id ?? null,
        order_total_cents: null,
        checkout_at: v.checkout_em ?? null,
        closed_by: fechada ? (v.fechada_por === 'auto' ? 'auto' : 'seller') : null,
        resultado: v.resultado ?? null,
        motivo_id: v.motivo_id ?? null,
        foto_fachada_id: v.foto_fachada_id ?? null,
        ...(v.etapas_pendentes ? { etapas_pendentes: v.etapas_pendentes } : {}),
    };
}
function paraVisit(v) {
    return {
        id: v.id,
        seller_id: v.seller_id,
        customer_id: v.customer_id,
        route_stop_id: v.route_stop_id,
        checkin_at: v.checkin_at,
        received_at: v.checkin_at,
        lat: v.lat,
        lng: v.lng,
        outcome: v.outcome,
        no_order_reason: v.no_order_reason,
        order_id: v.order_id,
        checkout_at: v.checkout_at,
        closed_by: v.closed_by,
        ...(v.etapas_pendentes ? { etapas_pendentes: v.etapas_pendentes } : {}),
    };
}
const STATUS = { feita: 'done', em_atendimento: 'in_progress', proxima: 'next', pendente: 'pending' };
/**
 * Estado do Core no aparelho a partir das linhas e da fila. Só do usuário (`usuarioId`): uma visita de outro usuário
 * (supervisor vê a equipe) não vira "meu atendimento aberto". Cliente que saiu da carteira some da rota.
 */
export function montarEstadoLocal(l, fila, o) {
    const por = (xs) => {
        const m = new Map();
        for (const x of xs)
            m.set(x.cliente_id, [...(m.get(x.cliente_id) ?? []), x]);
        return m;
    };
    const tit = por(l.titulos);
    const his = por(l.historico);
    const fin = new Map(l.financeiros.map((f) => [f.cliente_id, f]));
    const clientes = l.clientes.filter((c) => c.ativo !== false).map((c) => resumoDoCliente(c, fin.get(c.id) ?? null, tit.get(c.id) ?? [], his.get(c.id) ?? [], o.hoje));
    const nomes = new Map(clientes.map((c) => [c.id, c.trade_name]));
    const porId = new Map(clientes.map((c) => [c.id, c]));
    const motivos = new Map(l.motivos.map((m) => [m.id, m]));
    const minhas = l.visitas.filter((v) => v.usuario_id === o.usuarioId);
    const aplicadas = aplicarPendentesVisita([...minhas], pendentesDaFila(fila), { usuario_id: o.usuarioId, fuso: o.fuso });
    const visitas = aplicadas.map((v) => paraLocal(v, nomes, motivos));
    const rota = l.rotas.find((r) => r.usuario_id === o.usuarioId && r.data === o.hoje && r.situacao !== 'cancelada') ?? null;
    let dia = null;
    if (rota) {
        const paradas = l.paradas.filter((p) => p.rota_id === rota.id && porId.has(p.cliente_id));
        const comStatus = statusDasParadas(paradas, aplicadas, o.agora, o.fuso);
        let totalKm = 0;
        let anterior = null;
        const stops = comStatus.map((p) => {
            const customer = porId.get(p.cliente_id);
            const km = anterior ? Math.round(haversineKm({ lat: anterior.lat, lng: anterior.lng }, { lat: customer.lat, lng: customer.lng }) * 10) / 10 : 0;
            totalKm += km;
            anterior = customer;
            const v = p.visita_id ? visitas.find((x) => x.id === p.visita_id) : undefined;
            return {
                id: p.id,
                sequence: p.sequencia,
                window_start: p.janela_inicio ?? '',
                window_end: p.janela_fim ?? '',
                status: STATUS[p.status],
                distance_km: km,
                customer,
                visit: v ? paraVisit(v) : null,
                order_total_cents: null,
            };
        });
        dia = { id: rota.id, seller_id: o.usuarioId, date: rota.data, status: rota.situacao, region: rota.regiao ?? '', total_km: Math.round(totalKm * 10) / 10, stops, done_count: stops.filter((s) => s.status === 'done').length };
    }
    return { clientes, rota: dia, visitas };
}
