/**
 * Indicador do dia do promotor (RF-PRO-12): lojas visitadas × planejadas, tempo médio, % conformidade,
 * share médio × meta, % ruptura e índice de preço. RN-PRO-07: só entram visitas com a permanência mínima;
 * as coletas de visitas que não contam ficam fora dos indicadores.
 */
import { CONFORMIDADES, pctConformidade, type Conformidade } from './gondola';
import { arredondar, media, percentual } from './numeros';
import { resolverParametros, type ParametrosPromotor } from './parametros';
import { visitaConta, visitaCurta } from './permanencia';
import { resumirRuptura, type StatusPresenca } from './ruptura';
import { mediaShare } from './share';

export interface VisitaDoDia {
  visita_id: string;
  cliente_id: string;
  /** `null` = visita ainda aberta (sem checkout). */
  permanencia_min: number | null;
}

export interface EntradaIndicadorDia {
  lojas_planejadas: number;
  visitas: readonly VisitaDoDia[];
  conformidades: readonly { visita_id: string; conformidade: Conformidade }[];
  shares: readonly { visita_id: string; share_pct: number | null; meta_pct: number | null }[];
  presencas: readonly { visita_id: string; status: StatusPresenca }[];
  indices_preco: readonly { visita_id: string; indice_preco: number | null }[];
}

export interface IndicadorDia {
  lojas_planejadas: number;
  lojas_visitadas: number;
  /** lojas visitadas ÷ planejadas × 100 */
  cobertura_pct: number | null;
  visitas_curtas: number;
  visitas_abertas: number;
  tempo_medio_min: number | null;
  conformidade_pct: number | null;
  share_medio_pct: number | null;
  meta_share_media_pct: number | null;
  atingimento_share_pct: number | null;
  ruptura_pct: number | null;
  falha_reposicao_pct: number | null;
  indice_preco_medio: number | null;
}

export function consolidarIndicadorDia(e: EntradaIndicadorDia, parametros: Partial<ParametrosPromotor> = {}): IndicadorDia {
  const p = resolverParametros(parametros);
  const validas = e.visitas.filter((v) => visitaConta(v.permanencia_min, p.permanencia_min_min));
  const idsValidos = new Set(validas.map((v) => v.visita_id));
  const lojas = new Set(validas.map((v) => v.cliente_id));
  const dasValidas = <T extends { visita_id: string }>(xs: readonly T[]) => xs.filter((x) => idsValidos.has(x.visita_id));

  const conf = dasValidas(e.conformidades).map((c) => c.conformidade).filter((c) => (CONFORMIDADES as readonly string[]).includes(c));
  const shares = mediaShare(dasValidas(e.shares));
  const ruptura = resumirRuptura(dasValidas(e.presencas));
  const indices = dasValidas(e.indices_preco).flatMap((i) => (i.indice_preco === null ? [] : [i.indice_preco]));

  return {
    lojas_planejadas: e.lojas_planejadas,
    lojas_visitadas: lojas.size,
    cobertura_pct: percentual(lojas.size, e.lojas_planejadas),
    visitas_curtas: e.visitas.filter((v) => visitaCurta(v.permanencia_min, p.permanencia_min_min)).length,
    visitas_abertas: e.visitas.filter((v) => v.permanencia_min === null).length,
    tempo_medio_min: media(validas.map((v) => v.permanencia_min as number), 1),
    conformidade_pct: pctConformidade(conf),
    share_medio_pct: shares.share_medio_pct,
    meta_share_media_pct: shares.meta_media_pct,
    atingimento_share_pct: shares.atingimento_pct === null ? null : arredondar(shares.atingimento_pct),
    ruptura_pct: ruptura.ruptura_pct,
    falha_reposicao_pct: ruptura.falha_reposicao_pct,
    indice_preco_medio: media(indices),
  };
}
