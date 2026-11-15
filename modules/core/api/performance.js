/**
 * `GET /v1/core/performance?de&ate[&usuario_id]` (RN-CORE-41 a 46; T-0170; desenho `docs/desenho/performance-produtividade.md` §7.3).
 * Devolve o que só o servidor sabe (`realizado_servidor`: venda, positivação, pedidos e itens) e, com as MESMAS funções puras que o
 * aparelho roda offline, os resultados e a produtividade do período: o app, o BKO e a API dão os mesmos números.
 * Escopo (RN-CORE-04, `usuariosVisiveis`): vendedor e promotor só a si (outro `usuario_id` = 404); supervisor e gerente, a equipe;
 * analista, assistente e admin, o tenant. Promotor não vende (RN-PRO-01): a consulta do Vendedor nunca é chamada para ele.
 * Fonte de pedidos: consulta `vendedor.pedidos_da_meta@1` (opcional, ADR 0019). Sem ela: notas do ERP (Vendedor desligado e
 * Integração ativa, RN-CORE-27) ou o read-model `indicador_diario` (só venda); sem fonte nenhuma, `sem_dado` — nunca zero.
 * Sem dado pessoal em log.
 */
import { ConsultaIndisponivel, definirConsulta, ErroNaoEncontrado, ErroRegraNegocio } from '@macuxi/platform-sdk';
import { localDate, yearMonthOf } from '@macuxi/comum';
import { somarDiasCivis } from '@macuxi/comum/relogio';
import { z } from 'zod';
import { Cents, Id, IsoDateTime } from '../contracts';
import { PerformanceQuerySchema, PerformanceSchema } from '../contracts/performance';
import { almocoDoUsuario, almocoPadraoDasLinhas, dataLocal } from '../domain';
import { realizadoPorTipo, STATUS_APROVADOS } from '../domain/apuracao';
import { CALENDARIO_PADRAO, calendarioDoTenant } from '../domain/meta-do-dia';
import { calendarioDoPeriodo } from '../domain/performance/calendario';
import { metasProdutividadeVigentes } from '../domain/performance/metas-produtividade';
import { produtividadeDoPeriodo } from '../domain/performance/produtividade';
import { resultadosDoPeriodo } from '../domain/performance/resultados';
import { mesesDoIntervalo, menorData, ultimoDiaDoMes } from '../domain/performance/tempo';
import { licencaDoTenant } from './licenca-tenant';
const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
/**
 * Espelho da consulta `vendedor.pedidos_da_meta@1` com o campo novo `itens_distintos` (opcional: Vendedor antigo não manda e o card
 * de Itens por pedido fica `sem_dado`). O Core não importa o pacote do Vendedor; o nome é a chave de ligação.
 */
export const CONSULTA_PEDIDOS_DA_META_PERFORMANCE = definirConsulta({
    nome: 'vendedor.pedidos_da_meta@1',
    entrada: z.object({ usuario_ids: z.array(Id).max(500), periodo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }),
    saida: z.object({
        pedidos: z.array(z.object({
            vendedor_id: Id,
            criado_por: Id.nullable(),
            cliente_id: Id.nullable(),
            emitido_em: IsoDateTime,
            aprovado_em: IsoDateTime.nullable(),
            status: z.enum(['aprovado', 'integrado', 'faturado']),
            total_cents: Cents,
            frete_cents: Cents.nullable(),
            cancelado_cents: Cents.nullable(),
            itens_distintos: z.number().int().nonnegative().optional(),
        })),
        faturamentos: z.array(z.object({ vendedor_id: Id, cliente_id: Id.nullable(), faturado_em: IsoDateTime, valor_cents: Cents, cancelado_cents: Cents.nullable(), devolvido_cents: Cents.nullable() })),
    }),
});
export const AGREGADO_VAZIO = { venda_cents: null, positivacao: null, pedidos: null, itens_distintos: null };
const contaComoAprovado = (status) => STATUS_APROVADOS.includes(status);
/**
 * RN-CORE-21/42: totais do vendedor entre `de` e `ate` (datas civis no fuso do tenant, inclusive) sobre os fatos da consulta.
 * Venda pelo tipo da meta (pedido: emissão; faturamento: data do ERP); positivação = clientes distintos com pedido aprovado no
 * intervalo; pedidos e itens distintos sobre os mesmos pedidos que contam (itens: soma dos produtos distintos de cada pedido;
 * nulo se algum pedido veio sem o campo). Intervalo invertido = nada no intervalo (zeros).
 */
export function agregarFatos(fatos, o) {
    const dentro = (instante) => {
        const d = localDate(new Date(instante), o.fuso);
        return d >= o.de && d <= o.ate;
    };
    const pedidos = fatos.pedidos.filter((p) => p.vendedor_id === o.usuario_id && contaComoAprovado(p.status) && dentro(p.emitido_em));
    const faturamentos = fatos.faturamentos.filter((f) => f.vendedor_id === o.usuario_id && dentro(f.faturado_em));
    let venda = 0;
    for (const mes of new Set([...pedidos.map((p) => yearMonthOf(localDate(new Date(p.emitido_em), o.fuso))), ...faturamentos.map((f) => yearMonthOf(localDate(new Date(f.faturado_em), o.fuso)))])) {
        venda += realizadoPorTipo(o.tipo, { pedidos, faturamentos }, { usuario_id: o.usuario_id, periodo: mes, fuso: o.fuso });
    }
    const clientes = new Set(pedidos.map((p) => p.cliente_id).filter((c) => Boolean(c)));
    const comItens = pedidos.every((p) => p.itens_distintos !== undefined);
    return {
        venda_cents: venda,
        positivacao: clientes.size,
        pedidos: pedidos.length,
        itens_distintos: comItens ? pedidos.reduce((s, p) => s + (p.itens_distintos ?? 0), 0) : null,
    };
}
/** Calendário do tenant com os feriados cadastrados (`metas.feriados`, datas AAAA-MM-DD); inválido ou ausente = sem feriado do tenant. */
export function calendarioComFeriados(parametros) {
    const base = calendarioDoTenant(parametros);
    const f = parametros.find((x) => x.modulo === 'core' && x.chave === 'metas.feriados' && !x.deleted_at)?.valor;
    const feriados = Array.isArray(f) ? f.filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
    return feriados.length > 0 ? { ...base, feriados } : { ...CALENDARIO_PADRAO, ...base };
}
async function fatosDaConsulta(tx, usuarioId, meses) {
    if (typeof tx?.consultar !== 'function')
        return null;
    const por = new Map();
    try {
        for (const periodo of meses) {
            // decidida pela licença do tenant (ADR 0025): leitura agregada do próprio usuário, rota GET
            const r = await tx.consultar(CONSULTA_PEDIDOS_DA_META_PERFORMANCE, { usuario_ids: [usuarioId], periodo }, { licenca: 'tenant' });
            por.set(periodo, { pedidos: r.pedidos, faturamentos: r.faturamentos });
        }
    }
    catch (e) {
        if (e instanceof ConsultaIndisponivel)
            return null;
        throw e;
    }
    return por;
}
/**
 * Escolhe a fonte do realizado de venda (RN-CORE-21/27): a consulta do Vendedor; senão as notas do ERP (Vendedor desligado e
 * Integração com notas do usuário); senão o read-model `indicador_diario` (só venda); senão nada (`sem_dado`).
 */
async function fonteDoRealizado(db, tx, o) {
    const fatos = o.lic.vendedorNoTenant || !o.lic.integracaoNoTenant ? await fatosDaConsulta(tx, o.usuario_id, o.meses) : null;
    if (fatos) {
        return async (de, ate) => {
            let venda = 0;
            let pedidos = 0;
            let itens = 0;
            const clientes = new Set();
            for (const mes of mesesDoIntervalo(de, ate)) {
                const f = fatos.get(mes);
                if (!f)
                    continue;
                const ini = maiorMes(de, `${mes}-01`);
                const fim = menorData(ate, ultimoDiaDoMes(mes));
                const a = agregarFatos(f, { usuario_id: o.usuario_id, tipo: o.tipo, fuso: o.fuso, de: ini, ate: fim });
                venda += a.venda_cents ?? 0;
                pedidos += a.pedidos ?? 0;
                itens = itens === null || a.itens_distintos === null ? null : itens + a.itens_distintos;
                for (const p of f.pedidos) {
                    const d = localDate(new Date(p.emitido_em), o.fuso);
                    if (p.vendedor_id === o.usuario_id && contaComoAprovado(p.status) && p.cliente_id && d >= ini && d <= fim)
                        clientes.add(p.cliente_id);
                }
            }
            return { venda_cents: venda, positivacao: clientes.size, pedidos, itens_distintos: itens };
        };
    }
    if (!o.lic.vendedorNoTenant && o.lic.integracaoNoTenant) {
        const temNotas = (await db.query('select 1 from core.nota_erp where deleted_at is null and usuario_id = $1 limit 1', [o.usuario_id])).rows.length > 0;
        if (temNotas) {
            return async (de, ate) => {
                const r = await db.query(`select coalesce(sum(case when tipo = 'faturamento' and not cancelada then total_cents when tipo = 'devolucao' then -total_cents else 0 end), 0)::float8 as venda,
                  count(distinct cliente_id) filter (where tipo = 'faturamento' and not cancelada)::int as positivacao
             from core.nota_erp
            where deleted_at is null and usuario_id = $1 and (emitida_em at time zone $4::text)::date between $2::date and $3::date`, [o.usuario_id, de, ate, o.fuso]);
                return { venda_cents: Math.max(0, Number(r.rows[0]?.venda ?? 0)), positivacao: Number(r.rows[0]?.positivacao ?? 0), pedidos: null, itens_distintos: null };
            };
        }
    }
    const temDiario = (await db.query('select 1 from core.indicador_diario where deleted_at is null and usuario_id = $1 limit 1', [o.usuario_id])).rows.length > 0;
    if (!temDiario)
        return async () => AGREGADO_VAZIO;
    return async (de, ate) => {
        const r = await db.query('select coalesce(sum(greatest(0, vendido_cents - cancelado_cents)), 0)::float8 as venda from core.indicador_diario where deleted_at is null and usuario_id = $1 and data between $2::date and $3::date', [o.usuario_id, de, ate]);
        return { venda_cents: Number(r.rows[0]?.venda ?? 0), positivacao: null, pedidos: null, itens_distintos: null };
    };
}
const maiorMes = (a, b) => (a > b ? a : b);
/** Monta o `realizado_servidor` (RealizadoServidorSchema) do período. Intervalo vazio (futuro) = zeros quando há fonte. */
export async function realizadoDoServidor(calc, o) {
    const fim = menorData(o.ate, o.hoje);
    const periodo = o.de > fim ? await zeradoSeHaFonte(calc, o.hoje) : await calc(o.de, fim);
    const mesHoje = o.hoje.slice(0, 7);
    const ateOntem = o.hoje.slice(8) === '01' ? await zeradoSeHaFonte(calc, o.hoje) : await calc(`${mesHoje}-01`, somarDiasCivis(o.hoje, -1));
    const por_mes = [];
    for (const m of mesesDoIntervalo(o.de, o.ate)) {
        if (m > mesHoje)
            continue;
        const a = await calc(maiorMes(o.de, `${m}-01`), menorData(menorData(o.ate, o.hoje), ultimoDiaDoMes(m)));
        por_mes.push({ periodo: m, venda_cents: a.venda_cents, positivacao: a.positivacao, pedidos: a.pedidos, itens_distintos: a.itens_distintos });
    }
    return {
        tipo_meta_venda: o.tipo,
        venda_cents: periodo.venda_cents,
        positivacao: periodo.positivacao,
        positivacao_ate_ontem: ateOntem.positivacao,
        venda_ate_ontem_cents: ateOntem.venda_cents,
        pedidos: periodo.pedidos,
        itens_distintos: periodo.itens_distintos,
        pedidos_ate_ontem: ateOntem.pedidos,
        itens_distintos_ate_ontem: ateOntem.itens_distintos,
        por_mes,
    };
}
/** Sem dia decorrido no intervalo: os campos que a fonte sabe dar valem 0; os que ela não tem seguem nulos. */
async function zeradoSeHaFonte(calc, hoje) {
    const a = await calc(hoje, hoje);
    return vazioComFonte(a);
}
const vazioComFonte = (a) => ({
    venda_cents: a.venda_cents === null ? null : 0,
    positivacao: a.positivacao === null ? null : 0,
    pedidos: a.pedidos === null ? null : 0,
    itens_distintos: a.itens_distintos === null ? null : 0,
});
/** Cálculo da Performance sobre o banco da transação (exportado para o teste com banco). */
export async function calcularPerformance(db, tx, e) {
    const hoje = dataLocal(e.agora, e.fuso);
    const mesHoje = hoje.slice(0, 7);
    const u = (await db.query('select id, perfil, equipe_id, ativo, almoco_inicio_min, almoco_fim_min from core.usuario where id = $1 and deleted_at is null', [e.usuario_id])).rows[0];
    if (!u)
        throw new ErroNaoEncontrado('USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado na sua equipe. Atualize a lista e tente de novo.');
    if (u.perfil !== 'vendedor' && u.perfil !== 'promotor') {
        throw new ErroRegraNegocio('PERFORMANCE_USUARIO_INVALIDO', 'A Performance é de vendedor ou promotor. Escolha um deles.');
    }
    const perfil = u.perfil;
    const parametros = (await db.query("select modulo, chave, valor, null::text as deleted_at from plataforma.parametro where modulo = 'core' and chave in ('metas.dias_uteis_semana', 'metas.feriados', 'jornada.almoco_padrao') and deleted_at is null")).rows;
    const calendario = calendarioComFeriados(parametros);
    const meses = [...new Set([...mesesDoIntervalo(e.de, e.ate), mesHoje])];
    const metas = (await db.query('select periodo, indicador, valor::float8 as valor, tipo from core.meta where deleted_at is null and usuario_id = $1 and periodo = any($2::text[])', [e.usuario_id, meses])).rows;
    const tipoVenda = (await db.query("select tipo from core.meta where deleted_at is null and usuario_id = $1 and indicador = 'venda_cents' and periodo <= $2 order by periodo desc limit 1", [e.usuario_id, e.ate.slice(0, 7) > mesHoje ? mesHoje : e.ate.slice(0, 7)])).rows[0]?.tipo === 'faturamento'
        ? 'faturamento'
        : 'pedido';
    const visitasDe = e.de < `${mesHoje}-01` ? e.de : `${mesHoje}-01`;
    const visitas = (await db.query(`select cliente_id, to_char(data_local, 'YYYY-MM-DD') as data_local, to_char(checkin_em at time zone 'UTC', ${UTC}) as checkin_em,
              to_char(checkout_em at time zone 'UTC', ${UTC}) as checkout_em, resultado, fechada_por, sem_gps, distancia_m::float8 as distancia_m
         from core.visita where deleted_at is null and usuario_id = $1 and data_local between $2::date and $3::date order by checkin_em, id`, [e.usuario_id, visitasDe, e.ate])).rows;
    const paradas = (await db.query("select cliente_id, to_char(data, 'YYYY-MM-DD') as data, rota_id from core.rota_parada where deleted_at is null and usuario_id = $1 and data between $2::date and $3::date", [e.usuario_id, e.de, e.ate])).rows;
    const rotas = (await db.query('select id, situacao from core.rota where deleted_at is null and usuario_id = $1 and data between $2::date and $3::date', [e.usuario_id, e.de, e.ate])).rows;
    const deslocamentos = (await db.query("select to_char(data, 'YYYY-MM-DD') as data, metros from core.deslocamento_dia where deleted_at is null and usuario_id = $1 and data between $2::date and $3::date", [e.usuario_id, e.de, e.ate])).rows;
    const linhasMeta = (await db.query('select escopo, equipe_id, usuario_id, indicador, valor, vigencia_inicio from core.meta_produtividade where deleted_at is null')).rows;
    const equipes = (await db.query('select id, equipe_pai_id from core.equipe where deleted_at is null')).rows;
    const metasProdutividade = metasProdutividadeVigentes({ linhas: linhasMeta, equipes, alvo: { usuario_id: e.usuario_id, equipe_id: u.equipe_id }, mes: e.ate.slice(0, 7) });
    // RN-PRO-01: o promotor não vende; a consulta do Vendedor nunca é chamada para ele
    let realizado;
    if (perfil === 'promotor') {
        realizado = { tipo_meta_venda: tipoVenda, venda_cents: null, positivacao: null, positivacao_ate_ontem: null, venda_ate_ontem_cents: null, pedidos: null, itens_distintos: null, pedidos_ate_ontem: null, itens_distintos_ate_ontem: null, por_mes: [] };
    }
    else {
        const mesesComFatos = meses.filter((m) => m <= mesHoje);
        const calc = await fonteDoRealizado(db, tx, { usuario_id: e.usuario_id, tipo: tipoVenda, fuso: e.fuso, meses: mesesComFatos, lic: await licencaDoTenant(db) });
        realizado = await realizadoDoServidor(calc, { de: e.de, ate: e.ate, hoje, tipo: tipoVenda });
    }
    const resultados = resultadosDoPeriodo({ de: e.de, ate: e.ate, hoje, calendario, perfil, metas, realizado, visitas });
    const produtividade = produtividadeDoPeriodo({ de: e.de, ate: e.ate, hoje, fuso: e.fuso, visitas, paradas, rotas, deslocamentos, metas: metasProdutividade, almoco: almocoDoUsuario(u, almocoPadraoDasLinhas(parametros)) });
    return PerformanceSchema.parse({
        usuario_id: e.usuario_id,
        de: e.de,
        ate: e.ate,
        hoje,
        base_em: e.agora.toISOString(),
        calendario: calendarioDoPeriodo(e.de, e.ate, hoje, calendario),
        realizado_servidor: realizado,
        resultados,
        produtividade,
    });
}
export const rotasDePerformance = [
    {
        metodo: 'GET',
        caminho: 'performance',
        acao: 'meta.ver',
        carteira: 'filtrar_no_dominio',
        query: PerformanceQuerySchema,
        executar: async (ctx) => {
            const q = ctx.query;
            const visiveis = await ctx.usuariosVisiveis();
            const alvo = q.usuario_id ?? ctx.usuario.id;
            // fora do escopo é 404: não revela quem existe fora da equipe (RN-CORE-04)
            if (visiveis !== 'tenant' && !visiveis.has(alvo))
                throw new ErroNaoEncontrado('USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado na sua equipe. Atualize a lista e tente de novo.');
            return ctx.comTenant(async (db, tx) => {
                const r = await calcularPerformance(db, tx, { usuario_id: alvo, de: q.de, ate: q.ate, agora: ctx.agora(), fuso: ctx.fuso() });
                ctx.log.info({ usuario_id: alvo, de: q.de, ate: q.ate }, 'performance calculada');
                return r;
            });
        },
    },
];
