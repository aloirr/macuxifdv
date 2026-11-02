/**
 * Respostas da API do BKO de trade (T-0056, RF-PRO-12): `GET /v1/promotor/relatorios/share` e
 * `GET /v1/promotor/relatorios/ruptura`, e o retorno das rotas REST de coleta. Só ids, números e instantes —
 * o nome da loja vem do Core (`core.cadastro_resumo@1`) e o da categoria do
 * cadastro de trade; nenhum dado pessoal.
 */
import { z } from 'zod';
import { IsoDate, Uuid } from './base';

const Pct = z.number().finite().nullable();

/** Filtros na URL (BKO): período em dias civis no fuso do tenant e loja opcional. Padrão: últimos 30 dias. */
export const FiltroRelatorio = z
  .object({
    de: IsoDate.optional(),
    ate: IsoDate.optional(),
    cliente_id: Uuid.optional(),
  })
  .strict()
  .refine((f) => !f.de || !f.ate || f.de <= f.ate, { path: ['ate'], message: 'A data final não pode ser anterior à inicial.' });
export type FiltroRelatorio = z.infer<typeof FiltroRelatorio>;

export const LinhaShareMetaApi = z.object({
  cliente_id: Uuid,
  /** Nome fantasia (ou razão social) da loja pelo Core; `null` se o cadastro não estiver disponível. */
  cliente_nome: z.string().nullable(),
  categoria_gondola_id: Uuid,
  categoria_nome: z.string().nullable(),
  share_pct: Pct,
  meta_pct: Pct,
  atingimento_pct: Pct,
  desvio_pp: Pct,
  situacao: z.enum(['atingiu', 'abaixo', 'sem_meta', 'sem_dados']),
  medido_em: z.string(),
});

export const RelatorioShareApi = z.object({
  de: IsoDate,
  ate: IsoDate,
  linhas: z.array(LinhaShareMetaApi),
  resumo: z.object({ share_medio_pct: Pct, meta_media_pct: Pct, atingimento_pct: Pct, categorias_medidas: z.number().int().nonnegative() }),
});
export type RelatorioShareApi = z.infer<typeof RelatorioShareApi>;

export const LinhaRupturaLojaApi = z.object({
  cliente_id: Uuid,
  cliente_nome: z.string().nullable(),
  visita_loja_id: Uuid,
  checkin_em: z.string(),
  total: z.number().int().nonnegative(),
  presentes: z.number().int().nonnegative(),
  ruptura_gondola: z.number().int().nonnegative(),
  ruptura_total: z.number().int().nonnegative(),
  em_ruptura: z.number().int().nonnegative(),
  ruptura_pct: Pct,
  ruptura_total_pct: Pct,
  falha_reposicao_pct: Pct,
  quantidade_reposta: z.number().int().nonnegative(),
});

export const RelatorioRupturaApi = z.object({ de: IsoDate, ate: IsoDate, linhas: z.array(LinhaRupturaLojaApi) });
export type RelatorioRupturaApi = z.infer<typeof RelatorioRupturaApi>;

/** Retorno das rotas REST de coleta: `criada` (1º envio), `repetida` (reenvio idêntico) ou `checkout` (visita fechada). */
export const ColetaRegistradaApi = z.object({ id: Uuid, situacao: z.enum(['criada', 'repetida', 'checkout']) });
export type ColetaRegistradaApi = z.infer<typeof ColetaRegistradaApi>;


