/**
 * RN-CORE-43: indicadores de produtividade (T-0170 §3), com o almoço e a jornada da RN-CORE-44 e o km da RN-CORE-46.
 * Função pura: o aparelho calcula offline com as visitas, as paradas e os resumos de km que ele tem (mais a fila local ainda
 * não enviada); a API e o BKO chamam a mesma função sobre o banco.
 *
 * - Médias por dia trabalhado (dia com check-in); TMA e raio por visita; TMD por intervalo.
 * - Só o check-out feito pelo usuário entra em TMA, TMD, almoço e jornada (o fechamento da virada do dia, RN-CORE-11, não).
 * - Indicadores de fim de dia (último check-in, almoço, jornada líquida, visitas por dia, km por dia) só com dias encerrados
 *   (antes de hoje), salvo no período Hoje, que usa só hoje até agora.
 * - Km só do resumo diário do rastreamento (`core.deslocamento_dia`); sem resumo, `sem_dado`. Nunca há estimativa.
 * Unidades da §1.5, em inteiros, meio para cima. Divisão por zero = nulo (`sem_dado`), nunca 0.
 */
import { INDICADORES_PRODUTIVIDADE, SENTIDO_PRODUTIVIDADE, } from '../../contracts/performance';
import { intervaloDoAlmoco, intervalosDoDia, ordenarPorCheckin, temCheckoutReal, } from './almoco';
import { emMs, menorData, minutoDoDia } from './tempo';
const MS_MIN = 60_000;
const media = (soma, n) => (n > 0 ? Math.round(soma / n) : null);
const chave = (cliente, data) => `${cliente}|${data}`;
function montarDias(e) {
    const fim = menorData(e.ate, e.hoje);
    const modoHoje = e.de === e.hoje && e.ate === e.hoje;
    const porData = new Map();
    for (const v of e.visitas) {
        if (v.deleted_at || v.data_local < e.de || v.data_local > fim)
            continue;
        const l = porData.get(v.data_local) ?? [];
        l.push(v);
        porData.set(v.data_local, l);
    }
    const metros = new Map();
    for (const d of e.deslocamentos)
        if (!d.deleted_at && !metros.has(d.data))
            metros.set(d.data, d.metros);
    return [...porData.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([data, l]) => {
        const visitas = ordenarPorCheckin(l);
        const checkins = visitas.map((v) => emMs(v.checkin_em));
        const checkouts = visitas.filter(temCheckoutReal).map((v) => emMs(v.checkout_em));
        const almoco = intervaloDoAlmoco(visitas, e.fuso, e.almoco);
        return {
            data,
            encerrado: modoHoje || data < e.hoje,
            visitas,
            clientes: new Set(visitas.map((v) => v.cliente_id)),
            atendidos: new Set(visitas
                .filter((v) => temCheckoutReal(v) && v.resultado !== 'cliente_fechado')
                .map((v) => v.cliente_id)),
            primeiroMs: checkins[0],
            ultimoCheckinMs: checkins[checkins.length - 1],
            fimMs: Math.max(...checkins, ...checkouts),
            almoco,
            almocoMs: almoco ? almoco.fim_ms - almoco.inicio_ms : null,
            metros: metros.get(data) ?? null,
        };
    });
}
function calcular(e) {
    const dias = montarDias(e);
    const encerrados = dias.filter((d) => d.encerrado);
    const soma = (l, f) => l.reduce((s, x) => s + f(x), 0);
    const visitas = dias.flatMap((d) => d.visitas);
    // TMA: por visita com check-out real, sem cliente fechado.
    const tma = visitas
        .filter((v) => temCheckoutReal(v) && v.resultado !== 'cliente_fechado')
        .map((v) => emMs(v.checkout_em) - emMs(v.checkin_em))
        .filter((ms) => ms >= 0);
    // TMD: intervalos do dia, sem o almoço.
    const tmd = dias.flatMap((d) => intervalosDoDia(d.visitas)
        .filter((i) => !d.almoco || i.inicio_ms !== d.almoco.inicio_ms || i.fim_ms !== d.almoco.fim_ms)
        .map((i) => i.fim_ms - i.inicio_ms));
    const comAlmoco = encerrados.filter((d) => d.almocoMs !== null);
    const jornadas = encerrados.map((d) => Math.max(0, d.fimMs - d.primeiroMs - (d.almocoMs ?? 0)));
    // Planejadas: pares (cliente, data) de paradas vivas de rota não cancelada.
    const rotaInvalida = new Set(e.rotas.filter((r) => r.deleted_at || r.situacao === 'cancelada').map((r) => r.id));
    const planejadas = new Set(e.paradas
        .filter((x) => !x.deleted_at && !rotaInvalida.has(x.rota_id))
        .map((x) => chave(x.cliente_id, x.data)));
    const contadas = new Set(dias.flatMap((d) => [...d.clientes].map((c) => chave(c, d.data))));
    const fora = [...contadas].filter((k) => !planejadas.has(k)).length;
    // Cobertura: planejadas até ontem + as de hoje já visitadas, dentro do período. No período Hoje, todas as paradas de hoje
    // (A-2): a cobertura mostra o andamento da rota do dia.
    const fim = menorData(e.ate, e.hoje);
    const modoHoje = e.de === e.hoje && e.ate === e.hoje;
    const consideradas = [...planejadas].filter((k) => {
        const data = k.slice(k.lastIndexOf('|') + 1);
        if (data < e.de || data > fim)
            return false;
        return data < e.hoje || modoHoje || contadas.has(k);
    });
    const visitadas = consideradas.filter((k) => contadas.has(k)).length;
    const comDistancia = visitas.filter((v) => !v.sem_gps && v.distancia_m !== null && v.distancia_m !== undefined && Number.isFinite(v.distancia_m));
    const kmEncerrados = encerrados.filter((d) => d.metros !== null);
    const kmDias = dias.filter((d) => d.metros !== null);
    const atendidos = soma(kmDias, (d) => d.atendidos.size);
    const visitasEncerradas = soma(encerrados, (d) => d.clientes.size);
    return {
        primeiro_checkin: {
            valor: media(soma(dias, (d) => minutoDoDia(d.primeiroMs, e.fuso)), dias.length),
            amostra: dias.length,
        },
        ultimo_checkin: {
            valor: media(soma(encerrados, (d) => minutoDoDia(d.ultimoCheckinMs, e.fuso)), encerrados.length),
            amostra: encerrados.length,
        },
        tma: {
            valor: media(soma(tma, (x) => x), tma.length * MS_MIN),
            amostra: tma.length,
        },
        tmd: {
            valor: media(soma(tmd, (x) => x), tmd.length * MS_MIN),
            amostra: tmd.length,
        },
        almoco: {
            valor: media(soma(comAlmoco, (d) => d.almocoMs), comAlmoco.length * MS_MIN),
            amostra: comAlmoco.length,
        },
        jornada_liquida: {
            valor: media(soma(jornadas, (x) => x), jornadas.length * MS_MIN),
            amostra: jornadas.length,
        },
        fora_rota: { valor: media(10_000 * fora, contadas.size), amostra: contadas.size },
        visitas_dia: { valor: media(10 * visitasEncerradas, encerrados.length), amostra: encerrados.length },
        cobertura_rota: { valor: media(10_000 * visitadas, consideradas.length), amostra: consideradas.length },
        raio_checkin: {
            valor: media(soma(comDistancia, (v) => v.distancia_m), comDistancia.length),
            amostra: comDistancia.length,
        },
        km_dia: {
            valor: media(soma(kmEncerrados, (d) => d.metros), kmEncerrados.length),
            amostra: kmEncerrados.length,
        },
        km_cliente: {
            valor: media(soma(kmDias, (d) => d.metros), atendidos),
            amostra: atendidos,
        },
    };
}
/** RN-CORE-43/45: os 12 indicadores de produtividade, na ordem de `INDICADORES_PRODUTIVIDADE`, com a situação de cada um. */
export function produtividadeDoPeriodo(e) {
    if (e.ate < e.de)
        throw new RangeError(`Período invertido: ${e.de} a ${e.ate}.`);
    const c = calcular(e);
    return INDICADORES_PRODUTIVIDADE.map((indicador) => {
        const { valor, amostra } = c[indicador];
        const meta = e.metas[indicador] ?? null;
        let situacao;
        if (valor === null)
            situacao = 'sem_dado';
        else if (meta === null)
            situacao = 'sem_meta';
        else
            situacao = (SENTIDO_PRODUTIVIDADE[indicador] === 'ate' ? valor <= meta.valor : valor >= meta.valor)
                ? 'dentro'
                : 'fora';
        return {
            indicador,
            situacao,
            valor,
            meta: meta?.valor ?? null,
            meta_origem: meta?.origem ?? null,
            amostra,
        };
    });
}
