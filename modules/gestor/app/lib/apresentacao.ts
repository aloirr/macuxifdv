/**
 * Textos e tons das telas do Gestor (app e BKO). Só APRESENTAÇÃO: prazos, indicadores e alertas já chegam calculados
 * pelo domain/API (RN-GES-03, RF-GES-03/07); aqui eles viram rótulo em português e cor.
 */
import type { IndicadorRanking, ItemFilaAprovacao, MotivoAprovacao, PeriodoRanking, Severidade, StatusDia, TipoAlerta, VisaoEquipe } from '../../contracts';

export type Tom = 'success' | 'warning' | 'danger' | 'accent' | 'neutral';

export const STATUS_DIA_ROTULO: Readonly<Record<StatusDia, { label: string; tom: Tom }>> = {
  em_visita: { label: 'Em visita', tom: 'success' },
  em_rota: { label: 'Em rota', tom: 'accent' },
  sem_checkin: { label: 'Sem check-in', tom: 'warning' },
};

export const MOTIVO_ROTULO: Readonly<Record<MotivoAprovacao, string>> = {
  desconto: 'Desconto acima da alçada',
  credito: 'Crédito do cliente',
  estoque: 'Estoque',
  preco_minimo: 'Preço abaixo do mínimo',
};

export const TIPO_ALERTA_ROTULO: Readonly<Record<TipoAlerta, string>> = {
  cliente_sem_visita: 'Cliente sem visita',
  ritmo_abaixo_meta: 'Ritmo abaixo da meta',
  pedido_aguardando_aprovacao: 'Pedido aguardando aprovação',
  ruptura_recorrente: 'Ruptura recorrente',
  visita_curta: 'Visita curta',
  fotos_sem_gps: 'Fotos sem GPS',
};

export const SEVERIDADE_TOM: Readonly<Record<Severidade, Tom>> = { info: 'neutral', atencao: 'warning', critica: 'danger' };

export const INDICADOR_ROTULO: Readonly<Record<IndicadorRanking, string>> = {
  vendas_cents: 'Vendas',
  pedidos: 'Pedidos',
  positivados: 'Positivados',
  ticket_medio_cents: 'Ticket médio',
  atingimento_meta_pct: 'Meta',
  cobertura_pct: 'Cobertura',
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
