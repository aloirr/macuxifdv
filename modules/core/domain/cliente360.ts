/**
 * Resumo do Cliente 360 (RF-CORE-04; desenho T-0016 §3.1). Funções puras sobre as linhas locais:
 * rodam no app offline e na API com o mesmo resultado. `hoje` é a data civil no fuso do tenant.
 * O desconto dos pedidos aprovados ainda não faturados no crédito é do Vendedor (RN-VEN-12), não daqui.
 */
import { diffDays, yearMonthOf } from '@macuxi/comum';

export interface TituloLike {
  vencimento: string;
  saldo_cents: number;
  situacao: 'aberto' | 'liquidado' | 'cancelado';
}

export type SituacaoTitulo = 'a_vencer' | 'vencido' | 'liquidado' | 'cancelado';

/** Título vence "hoje" ainda é a vencer; vencido só a partir do dia seguinte. */
export function situacaoTitulo(t: TituloLike, hoje: string): { situacao: SituacaoTitulo; dias_atraso: number } {
  if (t.situacao !== 'aberto') return { situacao: t.situacao, dias_atraso: 0 };
  const atraso = diffDays(t.vencimento, hoje);
  return atraso > 0 ? { situacao: 'vencido', dias_atraso: atraso } : { situacao: 'a_vencer', dias_atraso: 0 };
}

export interface FinanceiroLike {
  limite_cents: number;
  saldo_aberto_cents: number;
  credito_disponivel_cents?: number | null;
  bloqueado: boolean;
  motivo_bloqueio?: string | null;
}

export interface ResumoFinanceiroCalculado {
  limite_cents: number;
  saldo_aberto_cents: number;
  credito_disponivel_cents: number;
  bloqueado: boolean;
  motivo_bloqueio: string | null;
  vencidos_qtd: number;
  vencidos_cents: number;
  a_vencer_qtd: number;
  a_vencer_cents: number;
  maior_atraso_dias: number;
}

/** Crédito disponível = o do ERP quando vier; senão limite − saldo (negativo = limite estourado). */
export function resumoFinanceiro(f: FinanceiroLike | null | undefined, titulos: TituloLike[], hoje: string): ResumoFinanceiroCalculado | null {
  if (!f) return null;
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
    } else if (s.situacao === 'a_vencer') {
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

export interface HistoricoLike {
  ano_mes: string;
  valor_cents: number;
  pedidos: number;
  ultima_compra_em?: string | null;
}

export interface ResumoComprasCalculado {
  ultima_compra_em: string | null;
  dias_sem_compra: number | null;
  ticket_medio_cents: number;
  frequencia_media_dias: number | null;
  total_12m_cents: number;
}

/** Primeiro mês (AAAA-MM) da janela de 12 meses que termina no mês de `hoje`. */
function inicioJanela12(hoje: string): string {
  const [a, m] = yearMonthOf(hoje).split('-').map(Number) as [number, number];
  const idx = a * 12 + (m - 1) - 11;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/**
 * Compras dos 12 meses até o mês de `hoje`. Ticket médio = total ÷ pedidos (centavos, arredondado).
 * Frequência média = dias desde o 1º dia do 1º mês com compra até `hoje`, ÷ pedidos (1 casa decimal).
 */
export function resumoCompras(historico: HistoricoLike[], hoje: string): ResumoComprasCalculado {
  const ini = inicioJanela12(hoje);
  const mes = yearMonthOf(hoje);
  const janela = historico.filter((h) => h.ano_mes >= ini && h.ano_mes <= mes);
  const total = janela.reduce((s, h) => s + h.valor_cents, 0);
  const pedidos = janela.reduce((s, h) => s + h.pedidos, 0);
  const ultima = janela.reduce<string | null>((m, h) => (h.ultima_compra_em && (!m || h.ultima_compra_em > m) ? h.ultima_compra_em : m), null);
  const primeiroMes = janela.filter((h) => h.pedidos > 0).map((h) => h.ano_mes).sort()[0];
  return {
    ultima_compra_em: ultima,
    dias_sem_compra: ultima ? Math.max(0, diffDays(ultima, hoje)) : null,
    ticket_medio_cents: pedidos > 0 ? Math.round(total / pedidos) : 0,
    frequencia_media_dias: pedidos > 0 && primeiroMes ? Math.round((diffDays(`${primeiroMes}-01`, hoje) / pedidos) * 10) / 10 : null,
    total_12m_cents: total,
  };
}

function digitos(n: string | null | undefined): string {
  return (n ?? '').replace(/\D/g, '');
}

/** Número nacional com DDI 55 (não duplica se já veio). */
function comDdi(n: string | null | undefined): string | null {
  const d = digitos(n);
  if (!d) return null;
  return d.startsWith('55') && d.length >= 12 ? d : `55${d}`;
}

/** `tel:` e link do WhatsApp com DDI 55 e só dígitos. */
export function linksDeContato(c: { telefone?: string | null; whatsapp?: string | null }): { tel: string | null; whatsapp: string | null } {
  const tel = comDdi(c.telefone);
  const wa = comDdi(c.whatsapp);
  return { tel: tel ? `tel:+${tel}` : null, whatsapp: wa ? `https://wa.me/${wa}` : null };
}
