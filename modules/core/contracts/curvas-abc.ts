/**
 * Curvas ABC do cliente por dimensão (RN-CORE-49; decisão do dono do produto, 14/11/2026 6h18: as faixas de volume,
 * faturamento e frequência são configurações no BKO). `GET|PUT /v1/core/parametros/curvas-abc` (ação `parametro.curva_abc`).
 * Guardado em `plataforma.parametro` (modulo `core`), UMA linha por dimensão, valor `{ a_min_pct, b_min_pct }`:
 * `cliente.curva_abc.faturamento`, `cliente.curva_abc.volume`, `cliente.curva_abc.frequencia`. Sem tabela nova.
 * Regra: A se a variação sobre a média dos 3 meses anteriores é ≥ a_min_pct; B se ≥ b_min_pct; senão C.
 */
import { z } from 'zod';

export const PARAMETRO_CURVA_ABC_FATURAMENTO = 'cliente.curva_abc.faturamento';
export const PARAMETRO_CURVA_ABC_VOLUME = 'cliente.curva_abc.volume';
export const PARAMETRO_CURVA_ABC_FREQUENCIA = 'cliente.curva_abc.frequencia';
export const CURVA_ABC_PCT_MIN = -100;
export const CURVA_ABC_PCT_MAX = 1000;

const pct = z.number().min(CURVA_ABC_PCT_MIN, 'Use um percentual de −100 a 1000.').max(CURVA_ABC_PCT_MAX, 'Use um percentual de −100 a 1000.');

export const FaixaCurvaAbcSchema = z
  .object({ a_min_pct: pct, b_min_pct: pct })
  .strict()
  .refine((f) => f.a_min_pct > f.b_min_pct, { message: 'A curva A deve começar acima da curva B. Aumente o valor de A ou diminua o de B.', path: ['a_min_pct'] });
export type FaixaCurvaAbc = z.infer<typeof FaixaCurvaAbcSchema>;

export const ParametrosCurvaAbcSchema = z.object({ faturamento: FaixaCurvaAbcSchema, volume: FaixaCurvaAbcSchema, frequencia: FaixaCurvaAbcSchema }).strict();
export type ParametrosCurvaAbc = z.infer<typeof ParametrosCurvaAbcSchema>;

/** Forma do PUT (só o formato; a regra de faixa é do domain: `validarParametrosCurvaAbc`). */
export const ParametrosCurvaAbcPutSchema = z
  .object({ faturamento: z.object({ a_min_pct: z.number(), b_min_pct: z.number() }).strict(), volume: z.object({ a_min_pct: z.number(), b_min_pct: z.number() }).strict(), frequencia: z.object({ a_min_pct: z.number(), b_min_pct: z.number() }).strict() })
  .strict();
export type ParametrosCurvaAbcPut = z.infer<typeof ParametrosCurvaAbcPutSchema>;

export const DIMENSOES_CURVA_ABC = ['faturamento', 'volume', 'frequencia'] as const;
export type DimensaoCurvaAbc = (typeof DIMENSOES_CURVA_ABC)[number];

/** Campo do formulário (`<dimensao>.<a_min_pct|b_min_pct>`) a que um erro pertence. */
export const ErroParametroCurvaAbcSchema = z.object({ campo: z.string().regex(/^(faturamento|volume|frequencia)\.(a_min_pct|b_min_pct)$/), mensagem: z.string().min(1) }).strict();
export type ErroParametroCurvaAbc = z.infer<typeof ErroParametroCurvaAbcSchema>;
