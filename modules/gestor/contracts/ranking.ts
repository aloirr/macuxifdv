/** Ranking da equipe por indicador e período (RF-GES-03). Desempate total e documentado em docs/modulos/gestor/regras.md. */
import { z } from 'zod';
import { InstanteUtc, IsoDate, PerfilContrato, PeriodoRanking, Uuid } from './base';

export const INDICADORES_RANKING = [
  'vendas_cents',
  'pedidos',
  'positivados',
  'ticket_medio_cents',
  'atingimento_meta_pct',
  'cobertura_pct',
  'conformidade_pct',
  'ruptura_pct',
] as const;
export const IndicadorRanking = z.enum(INDICADORES_RANKING);
export type IndicadorRanking = z.infer<typeof IndicadorRanking>;

export const LinhaRanking = z
  .object({
    /** 1, 2, 3… sem repetir (o desempate é total); `null` = sem dado no período (listado no fim). */
    posicao: z.number().int().positive().nullable(),
    usuario_id: Uuid,
    nome: z.string().min(1).max(200),
    perfil: PerfilContrato,
    valor: z.number().nullable(),
    vendas_cents: z.number().int().nonnegative(),
    pedidos: z.number().int().nonnegative(),
  })
  .strict();
export type LinhaRanking = z.infer<typeof LinhaRanking>;

export const RankingEquipe = z
  .object({
    indicador: IndicadorRanking,
    periodo: PeriodoRanking,
    /** Primeiro e último dia (datas civis no fuso do tenant). */
    inicio: IsoDate,
    fim: IsoDate,
    /** `maior` = quanto maior, melhor; `menor` = quanto menor, melhor (ex.: ruptura). */
    sentido: z.enum(['maior', 'menor']),
    linhas: z.array(LinhaRanking),
    calculado_em: InstanteUtc,
  })
  .strict();
export type RankingEquipe = z.infer<typeof RankingEquipe>;
