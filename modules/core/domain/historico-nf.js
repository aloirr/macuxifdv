import { creditoDisponivel } from '../../vendedor/contracts';
import { situacaoTitulo } from './cliente360';
/** P8/P17: o aparelho guarda 90 dias de linhas; além disso só se consulta o servidor. */
export const JANELA_APARELHO_DIAS = 90;
const ROTULOS = {
    em_atraso: 'Em atraso',
    em_aberto: 'Em aberto',
    pago: 'Pago',
    devolvido: 'Devolvido',
    devolvido_parcial: 'Devolvido parcial',
};
const TONS = { em_atraso: 'danger', em_aberto: 'warning', pago: 'success', devolvido: 'neutral', devolvido_parcial: 'accent' };
/** Texto do chip de status, sem data. */
export const rotuloStatusNf = (s) => ROTULOS[s];
export const tomStatusNf = (s) => TONS[s];
/** Parcela aberta, com saldo e vencida (vence hoje ainda não está vencida). */
const parcelaVencida = (p, hoje) => p.saldo_cents > 0 && situacaoTitulo(p, hoje).situacao === 'vencido';
/** R-20261119-0530: a NF está em atraso se alguma parcela aberta, com saldo, venceu. Só o fato, sem a data. */
export const nfEmAtraso = (parcelas, hoje) => parcelas.some((p) => parcelaVencida(p, hoje));
/**
 * RN-CORE-40 / P3: enquanto houver saldo em parcela aberta, o status é "Em atraso" (alguma vencida) ou "Em aberto". Sem saldo:
 * devolvido ≥ valor da nota = "Devolvido"; devolvido > 0 = "Devolvido parcial"; senão "Pago" (nota sem parcela no ERP = à vista, paga).
 */
export function statusDaNf(nota, parcelas, hoje) {
    const comSaldo = parcelas.filter((p) => p.situacao === 'aberto' && p.saldo_cents > 0);
    if (comSaldo.length > 0)
        return nfEmAtraso(comSaldo, hoje) ? 'em_atraso' : 'em_aberto';
    if (nota.devolvido_cents > 0)
        return nota.devolvido_cents >= nota.valor_cents ? 'devolvido' : 'devolvido_parcial';
    return 'pago';
}
/** Parcela da NF: "Em atraso" (mesmo destaque da linha da nota), "Em aberto", "Paga" ou "Cancelada". Sem data de atraso. */
export function statusDaParcela(p) {
    if (p.situacao === 'liquidado')
        return { rotulo: 'Paga', tom: 'success' };
    if (p.situacao === 'cancelado')
        return { rotulo: 'Cancelada', tom: 'neutral' };
    return p.em_atraso ? { rotulo: 'Em atraso', tom: 'danger' } : { rotulo: 'Em aberto', tom: 'warning' };
}
/** P4: valor devolvido da NF = soma das devoluções vivas (não canceladas) cuja NF original é esta, por número E série (série ausente = vazia, como nas parcelas). */
export function devolvidoDaNota(numeroNf, serieNf, devolucoes) {
    return devolucoes.filter((d) => !d.cancelada && d.nf_original === numeroNf && (d.nf_original_serie ?? '') === (serieNf ?? '')).reduce((s, d) => s + d.total_cents, 0);
}
/** Spec §3.2 (conta do crédito: `creditoDisponivel` do Vendedor, RN-VEN-12): o cartão do Resumo só tem Limite, Saldo disponível e Prazo médio; o motivo entra só com o cliente bloqueado. Sem linha financeira = `null`. */
export function limiteEDisponivelDoResumo(f, pedidosAprovados, prazoMedioDias) {
    if (!f)
        return null;
    const bloqueado = f.bloqueado ?? false;
    return {
        limite_cents: f.limite_cents,
        saldo_disponivel_cents: creditoDisponivel({ financeiro: f, pedidos: pedidosAprovados }).disponivel_cents,
        prazo_medio_dias: prazoMedioDias,
        bloqueado,
        motivo_bloqueio: bloqueado ? (f.motivo_bloqueio ?? null) : null,
    };
}
const MS_DIA = 86_400_000;
const somarDias = (data, dias) => new Date(Date.parse(`${data}T00:00:00Z`) + dias * MS_DIA).toISOString().slice(0, 10);
/** P8: início do período do filtro, contado de `hoje` (12 meses = mesmo dia do ano anterior). */
export function inicioDoPeriodoNf(p, hoje) {
    if (p === '12m') {
        const ano = Number(hoje.slice(0, 4)) - 1;
        const mmdd = hoje.slice(5);
        // 29/02 sem ano bissexto anterior: último dia do mês.
        const ok = mmdd !== '02-29' || (ano % 4 === 0 && (ano % 100 !== 0 || ano % 400 === 0));
        return ok ? `${ano}-${mmdd}` : `${ano}-02-28`;
    }
    return somarDias(hoje, -(p === '30d' ? 30 : JANELA_APARELHO_DIAS));
}
/** P17: o início pedido cai além da janela do aparelho = só online. */
export const periodoPrecisaDoServidor = (de, hoje) => de < somarDias(hoje, -JANELA_APARELHO_DIAS);
/** P14: filtra as linhas e as devolve da mais recente para a mais antiga. */
export function filtrarNotas(linhas, f) {
    const busca = f.numero_nf?.trim();
    return linhas
        .filter((l) => (!f.de || l.data >= f.de) &&
        (!f.ate || l.data <= f.ate) &&
        (!f.status?.length || f.status.includes(l.status)) &&
        (!f.forma_pagamento?.length || (l.forma_pagamento !== null && f.forma_pagamento.includes(l.forma_pagamento))) &&
        (!busca || l.numero_nf.includes(busca)))
        .sort((a, b) => (a.data === b.data ? b.numero_nf.localeCompare(a.numero_nf) : b.data.localeCompare(a.data)));
}
