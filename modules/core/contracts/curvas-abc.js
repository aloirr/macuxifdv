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
const pct = z.number();
export const FaixaCurvaAbcSchema = z.object({ a_min_pct: pct, b_min_pct: pct }).strict();
export const ParametrosCurvaAbcSchema = z.object({ faturamento: FaixaCurvaAbcSchema, volume: FaixaCurvaAbcSchema, frequencia: FaixaCurvaAbcSchema }).strict();
/** Forma do PUT (só o formato; a regra de faixa é do domain: `validarParametrosCurvaAbc`). */
export const ParametrosCurvaAbcPutSchema = ParametrosCurvaAbcSchema;
export const DIMENSOES_CURVA_ABC = ['faturamento', 'volume', 'frequencia'];
/** Campo do formulário (`<dimensao>.<a_min_pct|b_min_pct>`) a que um erro pertence. */
export const ErroParametroCurvaAbcSchema = z.object({ campo: z.string().regex(/^(faturamento|volume|frequencia)\.(a_min_pct|b_min_pct)$/), mensagem: z.string().min(1) }).strict();
