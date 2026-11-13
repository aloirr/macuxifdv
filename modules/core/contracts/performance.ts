/**
 * Performance: Resultados e Produtividade (T-0170; desenho `docs/desenho/performance-produtividade.md` §7.4).
 * RN-CORE-41 (calendário), RN-CORE-42 (resultados), RN-CORE-43/44 (produtividade, almoço e jornada), RN-CORE-45 (metas de
 * produtividade) e RN-CORE-46 (km), no texto proposto no §8 do desenho.
 *
 * Unidades (§1.5), sempre inteiros: dinheiro em centavos; contagens em inteiro; itens por pedido em centésimos (640 = 6,40);
 * % em pontos-base (10000 = 100%); hora do dia em minuto do dia (0 a 1439, no fuso do tenant); durações em minutos; visitas
 * por dia em décimos (107 = 10,7); distâncias em metros. A tela só formata.
 */
import { z } from 'zod';
import { ehDataCivil } from '@macuxi/comum/calendar';

const Id = z.string().uuid();
const Data = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(ehDataCivil, 'Data inexistente. Use AAAA-MM-DD.');
const AnoMes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
/** Instante UTC; o Postgres serializa com deslocamento (`+00:00`), por isso o offset é aceito. */
const Instante = z.string().datetime({ offset: true });
const Inteiro = z.number().int();
const NaoNeg = Inteiro.nonnegative();

// ---- Indicadores ----
export const INDICADORES_RESULTADO = ['venda_cents', 'positivacao', 'visitas', 'itens_por_pedido'] as const;
export type IndicadorResultado = (typeof INDICADORES_RESULTADO)[number];

export const INDICADORES_PRODUTIVIDADE = [
  'primeiro_checkin',
  'ultimo_checkin',
  'tma',
  'tmd',
  'almoco',
  'jornada_liquida',
  'fora_rota',
  'visitas_dia',
  'cobertura_rota',
  'raio_checkin',
  'km_dia',
  'km_cliente',
] as const;
export type IndicadorProdutividade = (typeof INDICADORES_PRODUTIVIDADE)[number];

export const UNIDADES_PRODUTIVIDADE = {
  primeiro_checkin: 'minuto_do_dia',
  ultimo_checkin: 'minuto_do_dia',
  tma: 'minutos',
  tmd: 'minutos',
  almoco: 'minutos',
  jornada_liquida: 'minutos',
  fora_rota: 'pontos_base',
  visitas_dia: 'decimos',
  cobertura_rota: 'pontos_base',
  raio_checkin: 'metros',
  km_dia: 'metros',
  km_cliente: 'metros',
} as const satisfies Record<IndicadorProdutividade, string>;

export type SentidoProdutividade = 'ate' | 'a_partir_de';
/** 'ate' = dentro quando valor ≤ meta; 'a_partir_de' = dentro quando valor ≥ meta (igual é dentro). */
export const SENTIDO_PRODUTIVIDADE = {
  primeiro_checkin: 'ate',
  ultimo_checkin: 'a_partir_de',
  tma: 'ate',
  tmd: 'ate',
  almoco: 'ate',
  jornada_liquida: 'a_partir_de',
  fora_rota: 'ate',
  visitas_dia: 'a_partir_de',
  cobertura_rota: 'a_partir_de',
  raio_checkin: 'ate',
  km_dia: 'ate',
  km_cliente: 'ate',
} as const satisfies Record<IndicadorProdutividade, SentidoProdutividade>;

/** RN-CORE-45 (§6.4): faixa aceita da meta, na unidade do indicador. */
export const FAIXA_META_PRODUTIVIDADE = {
  primeiro_checkin: [0, 1439],
  ultimo_checkin: [0, 1439],
  tma: [1, 480],
  tmd: [1, 480],
  almoco: [0, 240],
  jornada_liquida: [60, 960],
  fora_rota: [0, 10000],
  visitas_dia: [1, 1000],
  cobertura_rota: [0, 10000],
  raio_checkin: [1, 5000],
  km_dia: [1000, 2_000_000],
  km_cliente: [100, 500_000],
} as const satisfies Record<IndicadorProdutividade, readonly [number, number]>;

/** D5: padrão do FDV quando não há meta do usuário, da equipe nem do tenant. */
export const META_PRODUTIVIDADE_PADRAO = {
  primeiro_checkin: 480,
  ultimo_checkin: 1020,
  tma: 30,
  tmd: 25,
  almoco: 90,
  jornada_liquida: 480,
  fora_rota: 1000,
  visitas_dia: 110,
  cobertura_rota: 9000,
  raio_checkin: 100,
  km_dia: 120_000,
  km_cliente: 12_000,
} as const satisfies Record<IndicadorProdutividade, number>;

// ---- Metas de produtividade: linha do sync e do BKO ----
export const ESCOPOS_META_PRODUTIVIDADE = ['tenant', 'equipe', 'usuario'] as const;
export type EscopoMetaProdutividade = (typeof ESCOPOS_META_PRODUTIVIDADE)[number];

const dentroDaFaixa = (v: { indicador: IndicadorProdutividade; valor: number }, ctx: z.RefinementCtx) => {
  const [min, max] = FAIXA_META_PRODUTIVIDADE[v.indicador];
  if (v.valor < min || v.valor > max)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['valor'],
      message: `Meta fora da faixa aceita (${min} a ${max}).`,
    });
};
const alvoCoerente = (
  v: { escopo: string; equipe_id?: string | null; usuario_id?: string | null },
  ctx: z.RefinementCtx,
) => {
  if ((v.escopo === 'equipe') !== Boolean(v.equipe_id))
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['equipe_id'],
      message: 'Equipe só e sempre no escopo equipe.',
    });
  if ((v.escopo === 'usuario') !== Boolean(v.usuario_id))
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['usuario_id'],
      message: 'Usuário só e sempre no escopo usuário.',
    });
};

export const MetaProdutividadeSchema = z
  .object({
    id: Id,
    escopo: z.enum(ESCOPOS_META_PRODUTIVIDADE),
    equipe_id: Id.nullable(),
    usuario_id: Id.nullable(),
    indicador: z.enum(INDICADORES_PRODUTIVIDADE),
    valor: NaoNeg,
    vigencia_inicio: AnoMes,
    updated_at: Instante,
    deleted_at: Instante.nullable(),
  })
  .superRefine(alvoCoerente);
export type MetaProdutividade = z.infer<typeof MetaProdutividadeSchema>;

export const MetasProdutividadePutSchema = z
  .object({
    escopo: z.enum(ESCOPOS_META_PRODUTIVIDADE),
    equipe_id: Id.nullable().default(null),
    usuario_id: Id.nullable().default(null),
    vigencia_inicio: AnoMes,
    metas: z
      .array(
        z
          .object({ indicador: z.enum(INDICADORES_PRODUTIVIDADE), valor: NaoNeg })
          .strict()
          .superRefine(dentroDaFaixa),
      )
      .min(1)
      .max(INDICADORES_PRODUTIVIDADE.length)
      .refine((l) => new Set(l.map((m) => m.indicador)).size === l.length, 'Indicador repetido.'),
  })
  .strict()
  .superRefine(alvoCoerente);
export type MetasProdutividadePut = z.infer<typeof MetasProdutividadePutSchema>;

// ---- Performance ----
export const PerformanceQuerySchema = z
  .object({ de: Data, ate: Data, usuario_id: Id.optional() })
  .strict()
  .refine((q) => q.de <= q.ate, { path: ['ate'], message: 'O fim vem antes do início.' })
  .refine((q) => Date.parse(q.ate) - Date.parse(q.de) <= 365 * 86_400_000, {
    path: ['ate'],
    message: 'Período de no máximo 366 dias.',
  });
export type PerformanceQuery = z.infer<typeof PerformanceQuerySchema>;

export const CalendarioPeriodoSchema = z
  .object({ du_total: NaoNeg, du_decorridos: NaoNeg, du_restantes: NaoNeg, du_hoje: NaoNeg.nullable() })
  .strict();
export type CalendarioPeriodo = z.infer<typeof CalendarioPeriodoSchema>;

export const SITUACOES_RESULTADO = ['a_cumprir', 'batida', 'sem_meta', 'sem_dado'] as const;
export const ResultadoIndicadorSchema = z
  .object({
    indicador: z.enum(INDICADORES_RESULTADO),
    situacao: z.enum(SITUACOES_RESULTADO),
    /** Unidades da §1.5: centavos, inteiro ou centésimos (itens). */
    meta: NaoNeg.nullable(),
    realizado: NaoNeg.nullable(),
    atingimento_pb: NaoNeg.nullable(),
    gap: NaoNeg.nullable(),
    /** Meta/dia; em itens_por_pedido, Meta/pedido em centésimos (múltiplo de 10). Nula: período encerrado, sem restantes ou batida. */
    meta_dia: NaoNeg.nullable(),
    /** Real/dia; em itens_por_pedido, nulo (o "Real" é o próprio realizado). */
    real_dia: NaoNeg.nullable(),
  })
  .strict();
export type ResultadoIndicador = z.infer<typeof ResultadoIndicadorSchema>;

export const SITUACOES_PRODUTIVIDADE = ['dentro', 'fora', 'sem_meta', 'sem_dado'] as const;
export const ORIGENS_META_PRODUTIVIDADE = ['usuario', 'equipe', 'tenant', 'padrao_fdv'] as const;
export type OrigemMetaProdutividade = (typeof ORIGENS_META_PRODUTIVIDADE)[number];
export const ProdutividadeIndicadorSchema = z
  .object({
    indicador: z.enum(INDICADORES_PRODUTIVIDADE),
    situacao: z.enum(SITUACOES_PRODUTIVIDADE),
    valor: NaoNeg.nullable(),
    meta: NaoNeg.nullable(),
    meta_origem: z.enum(ORIGENS_META_PRODUTIVIDADE).nullable(),
    /** Base da média: dias, visitas ou intervalos usados (para o teste e o BKO; o app não mostra). */
    amostra: NaoNeg,
  })
  .strict();
export type ProdutividadeIndicador = z.infer<typeof ProdutividadeIndicadorSchema>;

/** O que só o servidor sabe; o aparelho guarda e recalcula o resto (§7.1). */
export const RealizadoServidorSchema = z
  .object({
    tipo_meta_venda: z.enum(['pedido', 'faturamento']),
    /** Nulos = fonte indisponível (Vendedor desligado e sem notas, ou promotor). */
    venda_cents: NaoNeg.nullable(),
    positivacao: NaoNeg.nullable(),
    /** Positivação até ontem, para a meta do dia de "Hoje" (RN-CORE-26). */
    positivacao_ate_ontem: NaoNeg.nullable(),
    venda_ate_ontem_cents: NaoNeg.nullable(),
    pedidos: NaoNeg.nullable(),
    itens_distintos: NaoNeg.nullable(),
    /**
     * Pedidos e itens distintos do mês até ontem, para a meta do dia de Itens por pedido em Hoje e Esta semana (RN-CORE-42,
     * A-4). Nulos sem fonte; ausentes na cópia guardada antes deles = nulos.
     */
    pedidos_ate_ontem: NaoNeg.nullable().optional(),
    itens_distintos_ate_ontem: NaoNeg.nullable().optional(),
    /** Em período de vários meses: positivação somada por mês (§2.3). */
    por_mes: z
      .array(
        z
          .object({
            periodo: AnoMes,
            venda_cents: NaoNeg.nullable(),
            positivacao: NaoNeg.nullable(),
            pedidos: NaoNeg.nullable(),
            itens_distintos: NaoNeg.nullable(),
          })
          .strict(),
      )
      .max(13),
  })
  .strict();
export type RealizadoServidor = z.infer<typeof RealizadoServidorSchema>;

export const PerformanceSchema = z
  .object({
    usuario_id: Id,
    de: Data,
    ate: Data,
    hoje: Data,
    /** Instante (UTC) da base do servidor; o app mostra "base de …" quando o dia virou sem sinal. */
    base_em: Instante,
    calendario: CalendarioPeriodoSchema,
    realizado_servidor: RealizadoServidorSchema,
    resultados: z.array(ResultadoIndicadorSchema).max(INDICADORES_RESULTADO.length),
    produtividade: z.array(ProdutividadeIndicadorSchema).max(INDICADORES_PRODUTIVIDADE.length),
  })
  .strict();
export type Performance = z.infer<typeof PerformanceSchema>;

// ---- Km (T-0156) ----
export const DeslocamentoDiaSchema = z
  .object({
    id: Id,
    usuario_id: Id,
    data: Data,
    metros: NaoNeg,
    pontos: NaoNeg,
    origem: z.enum(['rastreamento']),
    updated_at: Instante,
    deleted_at: Instante.nullable(),
    /** Campo comum da linha (CLAUDE.md, regra 5); o pull o manda junto. */
    external_id: z.string().nullable().optional(),
  })
  .strict();
export type DeslocamentoDia = z.infer<typeof DeslocamentoDiaSchema>;
