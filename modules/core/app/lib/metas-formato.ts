/**
 * Texto dos indicadores de metas (RN-CORE-20..22), igual no app e no BKO: quem formata é esta função pura,
 * então o mesmo painel vira as mesmas palavras e números nos dois lugares. Cobertura em pontos-base (8500 → "85,00%").
 */
import { formatBRL0 } from '@macuxi/comum';

import type { IndicadorMeta, LinhaDePainel } from '../../domain';

export const ROTULO_INDICADOR: Record<IndicadorMeta, string> = {
  venda_cents: 'Venda',
  visitas: 'Visitas',
  cobertura_pct: 'Cobertura de rota',
  positivacao: 'Positivação',
};

export const AGUARDANDO_PEDIDOS = 'Aguardando pedidos';

const pontosBase = (v: number): string => `${(v / 100).toFixed(2).replace('.', ',')}%`;

export function formatarIndicador(indicador: IndicadorMeta, v: number | null): string {
  if (v === null) return AGUARDANDO_PEDIDOS;
  if (indicador === 'venda_cents') return formatBRL0(v);
  if (indicador === 'cobertura_pct') return pontosBase(v);
  return String(v);
}

export function textoDaLinha(l: LinhaDePainel): { rotulo: string; meta: string; realizado: string; atingimento: string } {
  return {
    rotulo: ROTULO_INDICADOR[l.indicador],
    meta: formatarIndicador(l.indicador, l.meta),
    realizado: formatarIndicador(l.indicador, l.realizado),
    atingimento: l.atingimento_pct === null ? '—' : pontosBase(l.atingimento_pct),
  };
}

/** RN-CORE-22: "Precisa de R$ X por dia útil" / meta batida / sem dias úteis / sem meta de venda. */
export function textoNecessidadeDiaria(i: { meta_cents: number | null; necessidade_diaria_cents: number | null; dias_uteis_restantes: number; realizado_cents: number | null }): string {
  if (i.meta_cents === null) return 'Sem meta de venda definida para o mês.';
  if (i.realizado_cents === null) return AGUARDANDO_PEDIDOS;
  if (i.dias_uteis_restantes <= 0) return 'Sem dias úteis restantes no mês.';
  if ((i.necessidade_diaria_cents ?? 0) === 0) return 'Meta de venda batida.';
  return `Precisa de ${formatBRL0(i.necessidade_diaria_cents!)} por dia útil (${i.dias_uteis_restantes} restantes).`;
}
