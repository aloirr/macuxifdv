/**
 * Filtros das páginas do Gestor no BKO, sempre na URL (padrão do BKO): data, indicador, período e status do alerta.
 * Valor inválido na URL cai no padrão (nunca quebra a página); o contrato da rota valida de novo na API.
 */
import { IsoDate, IndicadorRanking, PeriodoRanking, StatusAlerta, type IndicadorRanking as Indicador, type PeriodoRanking as Periodo, type StatusAlerta as Status } from '../../contracts';

interface Busca {
  get(chave: string): string | null;
}

export interface FiltrosPainel {
  data: string | null;
}
export interface FiltrosRanking {
  indicador: Indicador;
  periodo: Periodo;
  data: string | null;
}
export interface FiltrosAlertas {
  status: Status | null;
}

const ou = <T>(r: { success: boolean; data?: T }, padrao: T): T => (r.success ? (r.data as T) : padrao);

export function lerFiltrosPainel(p: Busca): FiltrosPainel {
  return { data: ou(IsoDate.safeParse(p.get('data')), null) };
}

export function lerFiltrosRanking(p: Busca): FiltrosRanking {
  return {
    indicador: ou(IndicadorRanking.safeParse(p.get('indicador')), 'vendas_cents' as Indicador),
    periodo: ou(PeriodoRanking.safeParse(p.get('periodo')), 'mensal' as Periodo),
    data: ou(IsoDate.safeParse(p.get('data')), null),
  };
}

export function lerFiltrosAlertas(p: Busca): FiltrosAlertas {
  return { status: ou(StatusAlerta.safeParse(p.get('status')), null) };
}

/** Query da lista de alertas: os filtros da URL mais `produtividade=1`, para os alertas de produtividade (T-0180) aparecerem. */
export function queryAlertas(f: FiltrosAlertas): Record<string, string> {
  return { ...paraQuery(f), produtividade: '1' };
}

/** Query string sem os vazios (para `router.replace` e para a chamada da API). */
export function paraQuery(f: object): Record<string, string> {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => [k, String(v)]));
}
