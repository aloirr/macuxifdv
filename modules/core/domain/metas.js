/**
 * Indicadores básicos e meta × realizado (RF-CORE-08; RN-CORE-20 a 22). Funções puras: a mesma conta roda sobre as
 * linhas locais (app) e sobre as do banco (API), então o número é igual nos dois lugares.
 * Dinheiro em centavos; cobertura em pontos-base (8500 = 85,00%).
 */
import { yearMonthOf } from '@macuxi/comum';
import { CALENDARIO_PADRAO, diasUteisRestantes } from './meta-do-dia';
import { itensPorPedidoDoPeriodo, positivadosDoPeriodo, realizadoPorTipo } from './apuracao';
function naBase(p, base) {
    if (p.cancelado)
        return false;
    return base === 'faturado' ? p.faturado : p.aprovado || p.faturado;
}
function liquido(p) {
    return Math.max(0, p.total_cents - (p.cancelado_cents ?? 0));
}
/** RN-CORE-21: soma dos pedidos do vendedor no período na base de apuração, líquida de cancelamentos. */
export function realizadoDaMeta(pedidos, o) {
    return pedidos
        .filter((p) => p.vendedor_id === o.usuario_id && yearMonthOf(p.data) === o.periodo && naBase(p, o.base))
        .reduce((s, p) => s + liquido(p), 0);
}
import { necessidadeDiaria } from '../contracts/necessidade-diaria';
export { necessidadeDiaria };
/** RN-CORE-21: soma dos diários do usuário no período, líquida de cancelamentos (dia nunca negativo). */
export function realizadoDosDiarios(diarios, o) {
    return diarios
        .filter((d) => d.usuario_id === o.usuario_id && yearMonthOf(d.data) === o.periodo)
        .reduce((s, d) => s + Math.max(0, d.vendido_cents - d.cancelado_cents), 0);
}
/**
 * RN-CORE-20: visitado = check-in no dia da parada planejada (visita extra não entra); cobertura = visitados ÷ planejados;
 * positivado = cliente com ≥ 1 pedido na base de apuração no período.
 */
export function indicadoresDoPeriodo(e) {
    const base = e.base ?? 'aprovado';
    const doMes = e.paradas.filter((p) => yearMonthOf(p.data) === e.periodo);
    const planejadas = new Set(doMes.map((p) => `${p.cliente_id}|${p.data}`));
    const checkins = new Set(e.visitas.map((v) => `${v.cliente_id}|${v.data_local}`));
    const visitados = [...planejadas].filter((k) => checkins.has(k)).length;
    const cal = e.calendario ?? CALENDARIO_PADRAO;
    const dias = diasUteisRestantes(e.periodo, e.hoje, { ...cal, feriados: [...(cal.feriados ?? []), ...(e.feriados ?? [])] });
    let positivados = null;
    let realizado = null;
    if (e.apurado) {
        positivados = e.apurado.positivados;
        realizado = e.apurado.realizado_cents;
    }
    else if (e.pedidos) {
        const doPeriodo = e.pedidos.filter((p) => p.vendedor_id === e.usuario_id && yearMonthOf(p.data) === e.periodo && naBase(p, base));
        positivados = new Set(doPeriodo.map((p) => p.cliente_id).filter((c) => Boolean(c))).size;
        realizado = realizadoDaMeta(e.pedidos, { usuario_id: e.usuario_id, periodo: e.periodo, base });
    }
    else if (e.diarios) {
        realizado = realizadoDosDiarios(e.diarios, { usuario_id: e.usuario_id, periodo: e.periodo });
    }
    const meta = e.meta_cents ?? null;
    return {
        periodo: e.periodo,
        usuario_id: e.usuario_id,
        planejados: planejadas.size,
        visitados,
        cobertura_pct: planejadas.size > 0 ? Math.round((visitados / planejadas.size) * 10000) : 0,
        positivados,
        realizado_cents: realizado,
        meta_cents: meta,
        dias_uteis_restantes: dias,
        necessidade_diaria_cents: meta !== null && realizado !== null ? necessidadeDiaria(meta, realizado, dias) : null,
    };
}
const ORDEM_INDICADORES = ['venda_cents', 'visitas', 'cobertura_pct', 'positivacao', 'itens_por_pedido'];
/**
 * RN-CORE-20..22: indicadores do mês + cada meta (venda_cents, visitas, cobertura_pct, positivacao) contra o
 * realizado do mesmo indicador. A tela do app (linhas locais) e a API/BKO (linhas do banco) chamam esta função.
 */
export function painelDeMetas(e, metas) {
    const venda = metas.find((m) => m.indicador === 'venda_cents')?.valor ?? null;
    const indicadores = indicadoresDoPeriodo({ ...e, meta_cents: venda });
    const realizadoDe = {
        venda_cents: indicadores.realizado_cents,
        visitas: indicadores.visitados,
        cobertura_pct: indicadores.cobertura_pct,
        positivacao: indicadores.positivados,
        // T-0170 (A-4): só com os pedidos da consulta do Vendedor trazendo `itens_distintos`; sem eles, sem dado
        itens_por_pedido: e.apurado?.itens_por_pedido ?? null,
    };
    const linhas = [...metas]
        .sort((a, b) => ORDEM_INDICADORES.indexOf(a.indicador) - ORDEM_INDICADORES.indexOf(b.indicador))
        .map((m) => {
        const realizado = realizadoDe[m.indicador];
        return { indicador: m.indicador, meta: m.valor, realizado, atingimento_pct: realizado !== null && m.valor > 0 ? Math.round((realizado / m.valor) * 10000) : null };
    });
    return { indicadores, metas: linhas };
}
/**
 * Entrada ÚNICA do painel de metas: recebe as linhas no formato do sync (`rota_parada`, `visita`, `indicador_diario`,
 * `meta`) — as do aparelho no app, as do banco na API/BKO — descarta removidas e de outro usuário/mês e chama
 * `painelDeMetas`. Por isso o app (offline) e o BKO mostram os mesmos números a partir do mesmo dado (critério 2).
 */
export function painelDoUsuario(l) {
    const meu = (x) => !x.deleted_at && x.usuario_id === l.usuario_id;
    const a = l.apuracao;
    const o = a ? { usuario_id: l.usuario_id, periodo: l.periodo, fuso: a.fuso } : null;
    const apurado = a && o ? { realizado_cents: realizadoPorTipo(a.tipo, { pedidos: a.pedidos, faturamentos: a.faturamentos }, o), positivados: positivadosDoPeriodo(a.pedidos, o), itens_por_pedido: itensPorPedidoDoPeriodo(a.pedidos, o) } : undefined;
    return painelDeMetas({
        apurado,
        periodo: l.periodo,
        usuario_id: l.usuario_id,
        hoje: l.hoje,
        calendario: l.calendario,
        feriados: l.feriados,
        base: l.base,
        paradas: l.paradas.filter(meu).map((p) => ({ cliente_id: p.cliente_id, data: p.data })),
        visitas: l.visitas.filter(meu).map((v) => ({ cliente_id: v.cliente_id, data_local: v.data_local })),
        diarios: l.diarios.filter(meu),
    }, l.metas.filter((m) => meu(m) && m.periodo === l.periodo));
}
