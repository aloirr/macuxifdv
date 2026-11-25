/**
 * Check-in da visita (desenho T-0016 §4): raio e justificativa (RN-CORE-10), GPS só no check-in/checkout
 * (RN-CORE-13), um atendimento aberto por vez e fechamento na virada do dia (RN-CORE-11).
 * Funções puras; a mesma regra roda no app (offline) e na API (que sempre revalida).
 */
import { localDate } from '@macuxi/comum';
import { haversineKm } from './route';
import { autoCheckoutAt } from './visit';
/** Raio padrão do parâmetro `core.checkin.raio_m` (RN-CORE-10). */
export const RAIO_CHECKIN_PADRAO_M = 200;
/** Tamanho mínimo da justificativa fora do raio (espelha `CheckinVisitaSchema`). */
export const JUSTIFICATIVA_MIN = 3;
/** Data civil (AAAA-MM-DD) de um instante no fuso do tenant. */
export function dataLocal(instante, fuso) {
    return localDate(typeof instante === 'string' ? new Date(instante) : instante, fuso);
}
/** RN-CORE-10 e RN-CORE-13. Sem GPS ou sem coordenada do cliente não bloqueia o atendimento. */
export function avaliarCheckin(e) {
    const semGps = e.posicao === null;
    const clienteSemCoord = e.cliente.lat === null || e.cliente.lng === null;
    if (semGps || clienteSemCoord) {
        return { distancia_m: null, fora_do_raio: false, exige_justificativa: false, sugere_coordenada: !semGps && clienteSemCoord, sem_gps: semGps, pode: true, pendencias: [] };
    }
    const distancia = Math.round(haversineKm(e.cliente, e.posicao) * 1000);
    const fora = distancia > e.raio_m;
    const justificado = (e.justificativa ?? '').trim().length >= JUSTIFICATIVA_MIN;
    const pendencias = fora && !justificado ? ['justificativa'] : [];
    return { distancia_m: distancia, fora_do_raio: fora, exige_justificativa: fora, sugere_coordenada: false, sem_gps: false, pode: pendencias.length === 0, pendencias };
}
/**
 * RN-CORE-11: ao entrar um check-in, decide o que fecha sozinho. A referência de tempo é o `checkin_em` do novo
 * (push atrasado não pode fechar a anterior depois do novo check-in); sem ele usa-se `agora` (tela).
 * - aberta de um dia anterior (no fuso, em relação à referência): fecha na virada do dia, `nao_finalizado`;
 * - aberta hoje em outro cliente: fecha na referência (nunca antes do próprio check-in), `nao_finalizado`;
 * - aberta hoje com o MESMO `id` do novo: reenvio idempotente, retorna o id em `reaproveitar` e não fecha nada;
 * - aberta hoje no mesmo cliente: sem `id` no novo (tela), reaproveita a aberta para evitar 2º check-in;
 *   com `id` diferente (servidor), fecha a anterior como `auto` e aceita a nova (o checkout seguinte usa o id novo);
 * - mais de uma aberta hoje (dado antigo): só a mais recente do mesmo cliente é reaproveitada na tela, as outras fecham.
 */
export function resolverCheckin(abertas, novo, agora, fuso) {
    const fechar = [];
    const ref = novo.checkin_em ? new Date(novo.checkin_em) : agora;
    const hoje = dataLocal(ref, fuso);
    const doDia = [];
    for (const v of abertas) {
        if (v.checkout_em)
            continue;
        if (dataLocal(v.checkin_em, fuso) < hoje) {
            fechar.push({ id: v.id, checkout_em: autoCheckoutAt(v.checkin_em, fuso), resultado: 'nao_finalizado', fechada_por: 'auto', motivo: 'dia_virou' });
        }
        else
            doDia.push(v);
    }
    const reenvio = novo.id ? doDia.find((v) => v.id === novo.id) : undefined;
    const mesmoCliente = doDia.filter((v) => v.cliente_id === novo.cliente_id).sort((a, b) => b.checkin_em.localeCompare(a.checkin_em));
    const reaproveitar = reenvio?.id ?? (novo.id ? null : (mesmoCliente[0]?.id ?? null));
    for (const v of doDia) {
        if (v.id === reaproveitar)
            continue;
        const instante = ref.getTime() >= Date.parse(v.checkin_em) ? ref.toISOString() : v.checkin_em;
        fechar.push({ id: v.id, checkout_em: instante, resultado: 'nao_finalizado', fechada_por: 'auto', motivo: 'outro_cliente' });
    }
    return { fechar, reaproveitar };
}
/**
 * ADR 0009 §3: a tela lê `linhas do pull + itens pendentes da fila`; o pendente vence até ser aceito e o
 * pull nunca reabre uma visita cujo checkout ainda está na fila. Os pendentes entram NA ORDEM da fila:
 * um check-in pendente fecha, como `auto`/`nao_finalizado`, as visitas ainda abertas (RN-CORE-11, `resolverCheckin`),
 * para a tela nunca mostrar duas abertas. Devolve o mesmo tipo das linhas (campos extras ficam).
 */
export function aplicarPendentesVisita(linhas, pendentes, ctx) {
    const porId = new Map(linhas.map((l) => [l.id, { ...l }]));
    for (const p of pendentes) {
        if (p.tipo === 'checkin') {
            if (porId.has(p.id))
                continue;
            const abertas = [...porId.values()].filter((v) => !v.checkout_em).map((v) => ({ id: v.id, cliente_id: v.cliente_id, checkin_em: v.checkin_em, checkout_em: null }));
            const { fechar } = resolverCheckin(abertas, { id: p.id, cliente_id: p.cliente_id, checkin_em: p.checkin_em }, new Date(p.checkin_em), ctx.fuso);
            for (const f of fechar) {
                const v = porId.get(f.id);
                porId.set(f.id, { ...v, checkout_em: f.checkout_em, resultado: f.resultado, fechada_por: f.fechada_por });
            }
            porId.set(p.id, {
                id: p.id,
                usuario_id: ctx.usuario_id,
                cliente_id: p.cliente_id,
                rota_parada_id: p.rota_parada_id ?? null,
                data_local: dataLocal(p.checkin_em, ctx.fuso),
                checkin_em: p.checkin_em,
                sem_gps: p.sem_gps ?? false,
                fora_do_raio: p.fora_do_raio ?? false,
                sugere_coordenada: false,
                extra: p.extra ?? false,
                checkout_em: null,
                resultado: null,
                fechada_por: null,
            });
            continue;
        }
        const v = porId.get(p.visita_id);
        if (!v)
            continue;
        if (p.id && v.checkout_id === p.id)
            continue; // o servidor já aplicou este checkout
        porId.set(p.visita_id, {
            ...v,
            checkout_em: p.checkout_em,
            resultado: p.resultado,
            fechada_por: 'usuario',
            pedido_id: p.pedido_id ?? v.pedido_id ?? null,
            motivo_id: p.motivo_id ?? v.motivo_id ?? null,
            motivo_texto: p.motivo_texto ?? v.motivo_texto ?? null,
            foto_fachada_id: p.foto_fachada_id ?? v.foto_fachada_id ?? null,
        });
    }
    return [...porId.values()];
}
