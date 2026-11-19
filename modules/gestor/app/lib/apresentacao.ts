/**
 * Textos e tons das telas do Gestor (app e BKO). Só APRESENTAÇÃO: prazos, indicadores e alertas já chegam calculados
 * pelo domain/API (RN-GES-03, RF-GES-03/07); aqui eles viram rótulo em português e cor.
 */
import type { TomEstado } from '@macuxi/ui/mobile/puro';
import { ROTULO_INDICADOR_META } from '@macuxi/core/contracts';
import type { IndicadorRanking, ItemFilaAprovacao, MotivoAprovacao, PeriodoRanking, Severidade, StatusDia, TipoAlerta, VisaoEquipe } from '../../contracts';

export type Tom = 'success' | 'warning' | 'danger' | 'accent' | 'neutral';

/** Tom do `ChipEstado` (T-0072) para um tom do Gestor: a cor nunca vai sem o texto do chip. */
export const TOM_PARA_CHIP: Readonly<Record<Tom, TomEstado>> = { success: 'sucesso', warning: 'aviso', danger: 'erro', accent: 'destaque', neutral: 'neutro' };

export const STATUS_DIA_ROTULO: Readonly<Record<StatusDia, { label: string; tom: Tom }>> = {
  em_visita: { label: 'Em visita', tom: 'success' },
  em_rota: { label: 'Em rota', tom: 'accent' },
  sem_checkin: { label: 'Sem check-in', tom: 'warning' },
};

export const MOTIVO_ROTULO: Readonly<Record<MotivoAprovacao, string>> = {
  desconto: 'Desconto',
  credito: 'Crédito do cliente',
  inadimplencia: 'Inadimplente',
  estoque: 'Estoque',
  preco_minimo: 'Acima do desconto máximo',
};

/** `Inadimplente há 12 dias` (RN-VEN-13); sem o atraso, só o rótulo. */
function rotuloInadimplente(dias: number | null | undefined): string {
  return dias === null || dias === undefined ? MOTIVO_ROTULO.inadimplencia : `${MOTIVO_ROTULO.inadimplencia} há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

/**
 * Motivos da fila numa linha (RN-VEN-10/42: a alçada nunca aparece em tela; "uma informação, um lugar"). O desconto entra
 * uma vez só: na frente quando é motivo ("Desconto 8%"), depois dos motivos quando é só informação ("Crédito do cliente ·
 * desconto 3%"). Com motivo crédito e saldo conhecido, o saldo substitui o rótulo ("Crédito disponível R$ 1.200"); com
 * motivo inadimplência e atraso conhecido, vira "Inadimplente há 12 dias" (T-0184, RN-VEN-13).
 */
export function linhaDeMotivos(motivos: readonly MotivoAprovacao[], descontoPct: number, pct: (n: number) => string, creditoDisponivel?: string, atrasoDias?: number | null): string {
  const partes = motivos
    .filter((m) => m !== 'desconto')
    .map((m) => (m === 'credito' && creditoDisponivel ? `Crédito disponível ${creditoDisponivel}` : m === 'inadimplencia' ? rotuloInadimplente(atrasoDias) : MOTIVO_ROTULO[m]));
  if (motivos.includes('desconto')) partes.unshift(`${MOTIVO_ROTULO.desconto} ${pct(descontoPct)}`);
  else if (descontoPct > 0) partes.push(`desconto ${pct(descontoPct)}`);
  return partes.join(' · ');
}

/**
 * Texto do cartão de UM motivo da fila (P3 B): `Nº 000021 · Crédito disponível R$ 1.880,00`, `Nº 000021 · Inadimplente há 12
 * dias`, `Nº 000020 · Desconto 12%`. O desconto só aparece no cartão do motivo desconto.
 */
export function linhaDoCartao(i: Pick<ItemFilaAprovacao, 'pedido_numero' | 'desconto_efetivo_pct' | 'credito' | 'inadimplencia'>, motivo: MotivoAprovacao, pct: (n: number) => string, brl: (cents: number) => string): string {
  const motivoTexto = linhaDeMotivos([motivo], motivo === 'desconto' ? i.desconto_efetivo_pct : 0, pct, i.credito ? brl(i.credito.disponivel_cents) : undefined, i.inadimplencia?.maior_atraso_dias ?? null);
  return i.pedido_numero ? `Nº ${i.pedido_numero} · ${motivoTexto}` : motivoTexto;
}

export const TIPO_ALERTA_ROTULO: Readonly<Record<TipoAlerta, string>> = {
  cliente_sem_visita: 'Cliente sem visita',
  ritmo_abaixo_meta: 'Ritmo abaixo da meta',
  pedido_aguardando_aprovacao: 'Pedido aguardando aprovação',
  ruptura_recorrente: 'Ruptura recorrente',
  visita_curta: 'Visita curta',
  fotos_sem_gps: 'Fotos sem GPS',
  parado_entre_visitas: 'Parado',
  sem_checkin_inicio: 'Sem check-in',
};

export const SEVERIDADE_TOM: Readonly<Record<Severidade, Tom>> = { info: 'neutral', atencao: 'warning', critica: 'danger' };

/** RD-0250: indicador que também é de meta usa o nome do Core (`ROTULO_INDICADOR_META`); os demais são só do ranking. */
export const INDICADOR_ROTULO: Readonly<Record<IndicadorRanking, string>> = {
  vendas_cents: ROTULO_INDICADOR_META.venda_cents,
  pedidos: 'Pedidos',
  positivados: 'Positivados',
  ticket_medio_cents: 'Ticket médio',
  atingimento_meta_pct: 'Meta',
  cobertura_pct: ROTULO_INDICADOR_META.cobertura_pct,
  conformidade_pct: 'Gôndola',
  ruptura_pct: 'Ruptura',
};

export const PERIODO_ROTULO: Readonly<Record<PeriodoRanking, string>> = { diario: 'Hoje', semanal: 'Semana', mensal: 'Mês' };

/** Valor do ranking como texto (`null` = sem dado). Dinheiro chega em centavos; percentuais com 2 casas. */
export function valorDoIndicador(indicador: IndicadorRanking, valor: number | null, brl: (cents: number) => string): string {
  if (valor === null) return '—';
  if (indicador.endsWith('_cents')) return brl(valor);
  if (indicador.endsWith('_pct')) return `${valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  return valor.toLocaleString('pt-BR');
}

const horas = (h: number) => {
  const n = Math.round(Math.abs(h));
  return n < 1 ? 'menos de 1 h útil' : `${n} h ${n === 1 ? 'útil' : 'úteis'}`;
};

/** RN-GES-03: o prazo como a tela mostra (a situação vem da API: no_prazo / vencendo / vencido). */
export function rotuloDoPrazo(item: Pick<ItemFilaAprovacao, 'situacao' | 'horas_restantes'>): { label: string; tom: Tom } {
  if (item.situacao === 'vencido') return { label: `Vencido há ${horas(item.horas_restantes)}`, tom: 'danger' };
  if (item.situacao === 'vencendo') return { label: `Vence em ${horas(item.horas_restantes)}`, tom: 'warning' };
  return { label: `No prazo · ${horas(item.horas_restantes)}`, tom: 'success' };
}

/** Nome de cada pessoa da visão (para a fila e os alertas, que trazem só ids). */
export function nomesDaVisao(visao: Pick<VisaoEquipe, 'membros'> | null | undefined): Map<string, string> {
  return new Map((visao?.membros ?? []).map((m) => [m.membro.id, m.membro.nome]));
}

/** "3 de 5" com proteção para zero; usado em visitas e em cobertura. */
export function fracao(parte: number, total: number): string {
  return total > 0 ? `${parte} de ${total}` : `${parte}`;
}
