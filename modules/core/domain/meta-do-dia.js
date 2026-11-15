/**
 * Meta do dia das boas-vindas (RN-CORE-26; T-0073 §2). Funções puras: o aparelho (offline) e a API fazem a mesma conta.
 * Meta do dia = ⌈(meta do mês − realizado até ontem) ÷ dias úteis restantes⌉, contando hoje. Na equipe é a SOMA das metas do
 * dia de cada pessoa (o excesso de quem já bateu não cobre a falta do outro). Cobertura é razão do mês e não se divide por dia.
 * Dinheiro em centavos; datas civis AAAA-MM-DD no fuso do tenant; quem chama passa `hoje` (não lê o relógio).
 */
import { diasUteisDoPeriodo, ehDiaUtilDoTenant } from '@macuxi/comum';
import { necessidadeDiaria } from '../contracts/necessidade-diaria';
/** Segunda a sábado, sem feriados (parâmetro `metas.dias_uteis_semana`, 0 = domingo). */
export const CALENDARIO_PADRAO = { dias_uteis_semana: [1, 2, 3, 4, 5, 6] };
const ehDiaSemana = (n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 6;
/** Lê `metas.dias_uteis_semana` (módulo core) do pull `parametro`; ausente, removido ou inválido = padrão. */
export function calendarioDoTenant(parametros) {
    const p = parametros.find((x) => x.modulo === 'core' && x.chave === 'metas.dias_uteis_semana' && !x.deleted_at);
    const v = p?.valor;
    if (!Array.isArray(v) || v.length === 0 || !v.every(ehDiaSemana))
        return CALENDARIO_PADRAO;
    return { dias_uteis_semana: [...new Set(v)].sort() };
}
/**
 * RN-CORE-26: dia útil pela função única de `@macuxi/comum`. Sem lista de feriados do tenant só a semana conta; com a lista
 * informada (não vazia), os feriados NACIONAIS entram na conta junto com os do tenant (a lista do tenant não os repete).
 */
const feriadosDoCalendario = (cal) => (cal.feriados?.length ? cal.feriados : undefined);
export function ehDiaUtil(data, cal) {
    return ehDiaUtilDoTenant(data, feriadosDoCalendario(cal), cal.dias_uteis_semana);
}
/** Dias úteis de `hoje` (inclusive, se for útil) até o fim de `periodo`; hoje antes do período = todos; depois = 0. */
export function diasUteisRestantes(periodo, hoje, cal) {
    return diasUteisDoPeriodo(periodo, hoje, feriadosDoCalendario(cal), cal.dias_uteis_semana).remaining;
}
const atingimento = (realizado, metaDia) => (metaDia !== null && metaDia > 0 ? Math.round((realizado / metaDia) * 10_000) : null);
/** RN-CORE-26: meta do dia de uma pessoa em um indicador (regra na ordem do desenho §2). */
export function metaDoDia(e) {
    const dias = diasUteisRestantes(e.periodo, e.hoje, e.calendario);
    const comum = { indicador: e.indicador, meta_mes: e.meta_mes, realizado_ate_ontem: e.realizado_ate_ontem, realizado_hoje: e.realizado_hoje, dias_uteis_restantes: dias, membros: 1 };
    if (e.indicador === 'cobertura_pct')
        return { ...comum, situacao: 'do_mes', meta_dia: null, atingimento_hoje_pct: null, membros_mes_batido: e.realizado_ate_ontem >= e.meta_mes ? 1 : 0 };
    if (e.realizado_ate_ontem >= e.meta_mes)
        return { ...comum, situacao: 'mes_batido', meta_dia: 0, atingimento_hoje_pct: null, membros_mes_batido: 1 };
    if (dias === 0 || !ehDiaUtil(e.hoje, e.calendario))
        return { ...comum, situacao: 'dia_nao_util', meta_dia: null, atingimento_hoje_pct: null, membros_mes_batido: 0 };
    const metaDia = necessidadeDiaria(e.meta_mes, e.realizado_ate_ontem, dias) ?? 0;
    return { ...comum, situacao: e.realizado_hoje >= metaDia ? 'dia_batido' : 'a_cumprir', meta_dia: metaDia, atingimento_hoje_pct: atingimento(e.realizado_hoje, metaDia), membros_mes_batido: 0 };
}
export function metaDoDiaDaEquipe(indicador, itens) {
    const l = itens.filter((i) => i.indicador === indicador);
    if (l.length === 0)
        return null;
    const soma = (f) => l.reduce((s, i) => s + f(i), 0);
    const membros = soma((i) => i.membros);
    const membrosBatido = soma((i) => i.membros_mes_batido);
    const dias = Math.max(...l.map((i) => i.dias_uteis_restantes));
    if (indicador === 'cobertura_pct') {
        const peso = (i) => Math.max(0, i.paradas_planejadas ?? 0);
        const pesoTotal = soma(peso);
        if (pesoTotal === 0)
            return null;
        const media = (f) => Math.round(soma((i) => f(i) * peso(i)) / pesoTotal);
        return { indicador, situacao: 'do_mes', meta_mes: media((i) => i.meta_mes), realizado_ate_ontem: media((i) => i.realizado_ate_ontem), realizado_hoje: media((i) => i.realizado_hoje), meta_dia: null, atingimento_hoje_pct: null, dias_uteis_restantes: dias, membros, membros_mes_batido: membrosBatido };
    }
    const metaMes = soma((i) => i.meta_mes);
    const ateOntem = soma((i) => i.realizado_ate_ontem);
    const hoje = soma((i) => i.realizado_hoje);
    const somaDia = soma((i) => i.meta_dia ?? 0);
    const comum = { indicador, meta_mes: metaMes, realizado_ate_ontem: ateOntem, realizado_hoje: hoje, dias_uteis_restantes: dias, membros, membros_mes_batido: membrosBatido };
    if (l.every((i) => i.situacao === 'mes_batido'))
        return { ...comum, situacao: 'mes_batido', meta_dia: 0, atingimento_hoje_pct: null };
    if (l.every((i) => i.situacao === 'mes_batido' || i.situacao === 'dia_nao_util'))
        return { ...comum, situacao: 'dia_nao_util', meta_dia: null, atingimento_hoje_pct: null };
    return { ...comum, situacao: somaDia > 0 && hoje >= somaDia ? 'dia_batido' : 'a_cumprir', meta_dia: somaDia, atingimento_hoje_pct: atingimento(hoje, somaDia) };
}
export function resumoMetaDeHoje(m) {
    const faltam = m.meta_dia === null ? null : Math.max(0, m.meta_dia - m.realizado_hoje);
    const mes = m.meta_mes > 0 ? Math.round(((m.realizado_ate_ontem + m.realizado_hoje) / m.meta_mes) * 10_000) : null;
    const realizadoMes = m.realizado_ate_ontem + m.realizado_hoje;
    const faltamMes = m.meta_mes > 0 ? Math.max(0, m.meta_mes - realizadoMes) : null;
    const porDia = m.indicador === 'cobertura_pct' || faltamMes === null || faltamMes === 0 || m.dias_uteis_restantes <= 0 ? null : necessidadeDiaria(m.meta_mes, realizadoMes, m.dias_uteis_restantes);
    return { indicador: m.indicador, situacao: m.situacao, realizado_hoje: m.realizado_hoje, meta_dia: m.meta_dia, faltam_hoje: faltam, mes_pct: mes, faltam_mes: faltamMes, por_dia_util: porDia, dias_uteis_por_dia: m.dias_uteis_restantes };
}
