import { diasUteisDoPeriodo } from '@macuxi/comum';
import { situacaoDoPeriodo } from './apuracao';
import { computeIncentive, validateBands, validatePlanWeights, } from './incentive';
const INDICADORES = ['venda_cents', 'positivacao', 'cobertura_pct', 'visitas'];
/** Venda e visitas seguem o ritmo dos dias úteis; positivação e cobertura pagam pelo realizado. */
const PROJETAVEL = { venda_cents: true, visitas: true, positivacao: false, cobertura_pct: false };
const MODO = { zero: 'zero', proporcional: 'proportional', fixo: 'fixed' };
function faixasParaMotor(faixas) {
    return faixas.map((f) => ({ from_pct: f.de_pct, mode: MODO[f.modo], payout_pct: f.pagamento_pct }));
}
/** RN-CORE-30: erros em português (lista vazia = válido). */
export function validarPlanoRv(plano) {
    const erros = [];
    if (!Number.isInteger(plano.valor_maximo_cents) || plano.valor_maximo_cents <= 0)
        erros.push('O valor da RV com 100% em tudo deve ser maior que zero.');
    if (plano.perfis.length === 0)
        erros.push('Informe ao menos um perfil para o plano.');
    if (plano.regras.length === 0)
        erros.push('Informe ao menos um indicador.');
    const vistos = new Set();
    for (const r of plano.regras) {
        if (!INDICADORES.includes(r.indicador))
            erros.push(`Indicador desconhecido: ${r.indicador}.`);
        if (vistos.has(r.indicador))
            erros.push(`O indicador ${r.indicador} aparece mais de uma vez.`);
        vistos.add(r.indicador);
        if (r.gatilho)
            continue;
        const erroFaixas = validateBands(faixasParaMotor(r.faixas));
        if (erroFaixas)
            erros.push(`${r.indicador}: ${erroFaixas}`);
        for (const f of r.faixas) {
            if (f.de_pct < 0 || f.de_pct > 300 || f.pagamento_pct < 0 || f.pagamento_pct > 300) {
                erros.push(`${r.indicador}: faixas e pagamentos vão de 0% a 300%.`);
                break;
            }
        }
    }
    if (plano.regras.length > 0 && plano.regras.every((r) => r.gatilho))
        erros.push('Informe ao menos um indicador que não seja gatilho.');
    const pesos = validatePlanWeights(plano.regras.map((r) => ({ weight_pct: r.peso_pct, is_trigger: r.gatilho })));
    if (!pesos.ok && plano.regras.some((r) => !r.gatilho))
        erros.push(`Os pesos devem somar 100% (hoje somam ${pesos.sum}%).`);
    return erros;
}
/** Plano de maior início ≤ período para o perfil; o plano vale até o mês anterior ao próximo início. */
export function planoVigente(planos, periodo, perfil) {
    let achado = null;
    for (const p of planos) {
        if (!p.perfis.includes(perfil) || p.vigencia_inicio > periodo)
            continue;
        if (!achado || p.vigencia_inicio > achado.vigencia_inicio)
            achado = p;
    }
    return achado;
}
/** RN-CORE-30: o plano já valeu para algum mês fechado? (início ≤ mês fechado < início do próximo plano) */
export function planoJaValeuEmMesFechado(planos, plano, mesesFechados) {
    const proximos = planos.filter((p) => p.id !== plano.id && p.vigencia_inicio > plano.vigencia_inicio).map((p) => p.vigencia_inicio);
    const fim = proximos.length > 0 ? proximos.reduce((a, b) => (a < b ? a : b)) : null;
    return mesesFechados.some((m) => m >= plano.vigencia_inicio && (fim === null || m < fim));
}
/** RN-CORE-30: o plano `novo` passaria a valer sobre algum mês fechado que hoje já tem plano de um dos seus perfis? */
export function vigenciaReescreveMesFechado(planos, novo, mesesFechados) {
    const outros = planos.filter((p) => p.id !== novo.id);
    const proximos = outros.filter((p) => p.vigencia_inicio > novo.vigencia_inicio).map((p) => p.vigencia_inicio);
    const fim = proximos.length > 0 ? proximos.reduce((a, b) => (a < b ? a : b)) : null;
    return mesesFechados.some((m) => m >= novo.vigencia_inicio && (fim === null || m < fim) && novo.perfis.some((perfil) => planoVigente(outros, m, perfil) !== null));
}
/** RN-CORE-30: validação de criar/editar. `atual` = versão gravada (null se for novo). */
export function validarEdicaoPlanoRv(planos, atual, novo, mesesFechados) {
    const erros = validarPlanoRv(novo);
    if (planos.some((p) => p.id !== novo.id && p.vigencia_inicio === novo.vigencia_inicio)) {
        erros.push('Já existe um plano com esse mês de início.');
    }
    if ((!atual || atual.vigencia_inicio !== novo.vigencia_inicio) && vigenciaReescreveMesFechado(planos, novo, mesesFechados)) {
        erros.push('Essa vigência mudaria um mês já fechado. Escolha o mês aberto ou um mês futuro como início.');
    }
    if (atual && planoJaValeuEmMesFechado(planos, atual, mesesFechados) && JSON.stringify(atual) !== JSON.stringify(novo)) {
        erros.push('Este plano já valeu para um mês fechado e não pode mudar. Crie uma versão nova com vigência a partir do mês aberto.');
    }
    return erros;
}
/**
 * RN-CORE-29: RV de uma pessoa no mês. `parcial` paga pela projeção em dias úteis (venda e visitas);
 * `fechado` paga pelo realizado. Meta ausente ou ≤ 0 = sem meta (comum paga 0; gatilho não bloqueia).
 */
export function calcularRvDaPessoa(plano, metas, realizados, dias, situacao) {
    const incentivo = {
        max_amount_cents: plano.valor_maximo_cents,
        rules: plano.regras.map((r) => ({
            kpi_code: r.indicador,
            weight_pct: r.peso_pct,
            is_trigger: r.gatilho,
            bands: faixasParaMotor(r.faixas),
        })),
    };
    const entradas = [];
    for (const r of plano.regras) {
        const meta = metas[r.indicador];
        if (meta === undefined || meta <= 0)
            continue;
        entradas.push({
            kpi_code: r.indicador,
            direction: 'higher_is_better',
            target: meta,
            actual: realizados[r.indicador] ?? 0,
            projectable: PROJETAVEL[r.indicador],
        });
    }
    const res = computeIncentive(incentivo, entradas, dias, situacao === 'parcial' ? 'projected' : 'actual');
    const porCodigo = new Map(res.kpis.map((k) => [k.kpi_code, k]));
    const indicadores = plano.regras.map((r) => {
        const k = porCodigo.get(r.indicador);
        const realizado = realizados[r.indicador] ?? 0;
        if (!k) {
            return {
                indicador: r.indicador, meta: null, realizado, atingimento_pct: 0, projetado_pct: 0,
                pagamento_pct: 0, valor_cents: 0, gatilho: r.gatilho, gatilho_ok: null, sem_meta: true,
            };
        }
        return {
            indicador: r.indicador, meta: k.target, realizado, atingimento_pct: k.achievement_pct, projetado_pct: k.projected_pct,
            pagamento_pct: k.payout_pct, valor_cents: k.incentive_cents, gatilho: r.gatilho, gatilho_ok: k.trigger_ok, sem_meta: false,
        };
    });
    // No mês aberto, o gatilho de indicador projetável (venda e visitas) vale pela projeção, não pelo realizado até hoje (RN-CORE-29).
    if (situacao === 'parcial') {
        for (const l of indicadores) {
            if (l.gatilho && l.gatilho_ok !== null && PROJETAVEL[l.indicador])
                l.gatilho_ok = l.projetado_pct >= 100;
        }
    }
    const bloqueadaPor = indicadores.filter((l) => l.gatilho && l.gatilho_ok === false).map((l) => l.indicador);
    return {
        rv_cents: bloqueadaPor.length > 0 ? 0 : res.gross_incentive_cents,
        rv_bruta_cents: res.gross_incentive_cents,
        bloqueada_por: bloqueadaPor,
        indicadores,
    };
}
/** RN-CORE-29: dias úteis do mês pelo calendário do tenant (`metas.dias_uteis_semana`, 0 = domingo); encerrados = úteis antes de `hoje`. */
export function diasUteisDoMes(periodo, hoje, diasUteisSemana) {
    return diasUteisDoPeriodo(periodo, hoje, undefined, diasUteisSemana);
}
/** RN-CORE-21/30: meses fechados (2º dia útil do mês seguinte já passou) de `primeiro` até o mês de `hoje`, em ordem. */
export function mesesFechadosDesde(primeiro, hoje) {
    const fim = hoje.slice(0, 7);
    const saida = [];
    let [ano, mes] = [Number(primeiro.slice(0, 4)), Number(primeiro.slice(5, 7))];
    while (`${ano}-${String(mes).padStart(2, '0')}` <= fim) {
        const ym = `${ano}-${String(mes).padStart(2, '0')}`;
        if (situacaoDoPeriodo(ym, hoje) === 'fechado')
            saida.push(ym);
        mes += 1;
        if (mes > 12) {
            mes = 1;
            ano += 1;
        }
    }
    return saida;
}
