/**
 * Resumo do Cliente 360 (RF-CORE-04; desenho T-0016 §3.1). Funções puras sobre as linhas locais:
 * rodam no app offline e na API com o mesmo resultado. `hoje` é a data civil no fuso do tenant.
 * O desconto dos pedidos aprovados ainda não faturados no crédito é do Vendedor (RN-VEN-12), não daqui.
 */
import { diffDays, yearMonthOf } from '@macuxi/comum';
/** Título vence "hoje" ainda é a vencer; vencido só a partir do dia seguinte. */
export function situacaoTitulo(t, hoje) {
    if (t.situacao !== 'aberto')
        return { situacao: t.situacao, dias_atraso: 0 };
    const atraso = diffDays(t.vencimento, hoje);
    return atraso > 0 ? { situacao: 'vencido', dias_atraso: atraso } : { situacao: 'a_vencer', dias_atraso: 0 };
}
/** Crédito disponível = o do ERP quando vier; senão limite − saldo (negativo = limite estourado). */
export function resumoFinanceiro(f, titulos, hoje) {
    if (!f)
        return null;
    let vencidos_qtd = 0;
    let vencidos_cents = 0;
    let a_vencer_qtd = 0;
    let a_vencer_cents = 0;
    let maior_atraso_dias = 0;
    for (const t of titulos) {
        const s = situacaoTitulo(t, hoje);
        if (s.situacao === 'vencido') {
            vencidos_qtd++;
            vencidos_cents += t.saldo_cents;
            maior_atraso_dias = Math.max(maior_atraso_dias, s.dias_atraso);
        }
        else if (s.situacao === 'a_vencer') {
            a_vencer_qtd++;
            a_vencer_cents += t.saldo_cents;
        }
    }
    return {
        limite_cents: f.limite_cents,
        saldo_aberto_cents: f.saldo_aberto_cents,
        credito_disponivel_cents: f.credito_disponivel_cents ?? f.limite_cents - f.saldo_aberto_cents,
        bloqueado: f.bloqueado,
        motivo_bloqueio: f.motivo_bloqueio ?? null,
        vencidos_qtd,
        vencidos_cents,
        a_vencer_qtd,
        a_vencer_cents,
        maior_atraso_dias,
    };
}
/** Primeiro mês (AAAA-MM) da janela de 12 meses que termina no mês de `hoje`. */
function inicioJanela12(hoje) {
    const [a, m] = yearMonthOf(hoje).split('-').map(Number);
    const idx = a * 12 + (m - 1) - 11;
    return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}
/** RN-CORE-40: o mês `ano_mes` (AAAA-MM) está na janela dos 12 meses que terminam no mês de `hoje`, inclusive. */
export function mesNaJanela12(ano_mes, hoje) {
    return ano_mes >= inicioJanela12(hoje) && ano_mes <= yearMonthOf(hoje);
}
/** RN-CORE-40: Compra média/mês = total da janela de 12 meses ÷ 12, sempre (centavos, meia para cima). */
export function compraMediaMesCents(historico, hoje) {
    return Math.round(historico.filter((h) => mesNaJanela12(h.ano_mes, hoje)).reduce((s, h) => s + h.valor_cents, 0) / 12);
}
/** RN-CORE-40: sem compra na janela (nenhum pedido nos 12 meses) a ficha mostra "Sem compras em 12 meses", sem zeros. */
export function semComprasNaJanela(historico, hoje) {
    return !historico.some((h) => mesNaJanela12(h.ano_mes, hoje) && h.pedidos > 0);
}
/** RN-CORE-40: o mesmo critério de `semComprasNaJanela`, sobre o resumo já calculado (frequência nula = nenhum pedido na janela). */
export function resumoSemCompras(r) {
    return r.frequencia_media_dias === null && r.ultima_compra_em === null && r.total_12m_cents === 0;
}
/**
 * Compras dos 12 meses até o mês de `hoje`. Ticket médio = total ÷ pedidos (centavos, arredondado).
 * Frequência média = dias desde o 1º dia do 1º mês com compra até `hoje`, ÷ pedidos (1 casa decimal).
 */
export function resumoCompras(historico, hoje) {
    const janela = historico.filter((h) => mesNaJanela12(h.ano_mes, hoje));
    const total = janela.reduce((s, h) => s + h.valor_cents, 0);
    const pedidos = janela.reduce((s, h) => s + h.pedidos, 0);
    const ultima = janela.reduce((m, h) => (h.ultima_compra_em && (!m || h.ultima_compra_em > m) ? h.ultima_compra_em : m), null);
    const primeiroMes = janela.filter((h) => h.pedidos > 0).map((h) => h.ano_mes).sort()[0];
    return {
        ultima_compra_em: ultima,
        dias_sem_compra: ultima ? Math.max(0, diffDays(ultima, hoje)) : null,
        ticket_medio_cents: pedidos > 0 ? Math.round(total / pedidos) : 0,
        frequencia_media_dias: pedidos > 0 && primeiroMes ? Math.round((diffDays(`${primeiroMes}-01`, hoje) / pedidos) * 10) / 10 : null,
        total_12m_cents: total,
    };
}
function digitos(n) {
    return (n ?? '').replace(/\D/g, '');
}
/** Número nacional com DDI 55 (não duplica se já veio). */
function comDdi(n) {
    const d = digitos(n);
    if (!d)
        return null;
    return d.startsWith('55') && d.length >= 12 ? d : `55${d}`;
}
/** `tel:` e link do WhatsApp com DDI 55 e só dígitos. */
export function linksDeContato(c) {
    const tel = comDdi(c.telefone);
    const wa = comDdi(c.whatsapp);
    return { tel: tel ? `tel:+${tel}` : null, whatsapp: wa ? `https://wa.me/${wa}` : null };
}
