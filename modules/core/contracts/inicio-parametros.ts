/**
 * Parâmetros do Início por tenant (RN-CORE-26; T-0073 passo 7): `GET|PUT /v1/core/parametros/inicio` (ação `parametro.inicio`).
 * Guardados em `plataforma.parametro` (modulo `core`), uma linha por chave, sem tabela nova. Ausente = padrão do domain.
 * O pull `parametro` leva as linhas ao aparelho (sem mudança no contrato de sync). Os limites e as mensagens moram no domain.
 */
import { z } from 'zod';

export const PARAMETRO_DIAS_UTEIS = 'metas.dias_uteis_semana';
export const PARAMETRO_RECADO_PADRAO = 'inicio.recado_do_dia_padrao';
export const PARAMETRO_PARADO_MIN = 'inicio.parado_min';

/** Forma do parâmetro (só o formato; a regra de faixa é do domain: `validarParametrosInicio`). */
export const ParametrosInicioPutSchema = z
  .object({
    /** 0 = domingo … 6 = sábado. */
    dias_uteis_semana: z.array(z.number()),
    recado_do_dia_padrao: z.string(),
    parado_min: z.number(),
  })
  .strict();
export type ParametrosInicioPut = z.infer<typeof ParametrosInicioPutSchema>;

/** Valor efetivo (com os padrões aplicados) devolvido pela API. */
export const ParametrosInicioSchema = z
  .object({
    dias_uteis_semana: z.array(z.number().int().min(0).max(6)).min(1),
    recado_do_dia_padrao: z.string().min(1),
    parado_min: z.number().int().positive(),
  })
  .strict();
export type ParametrosInicio = z.infer<typeof ParametrosInicioSchema>;
