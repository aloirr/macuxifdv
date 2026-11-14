/**
 * Parâmetros do Início por tenant (RN-CORE-26; T-0073 passo 7): `GET|PUT /v1/core/parametros/inicio` (ação `parametro.inicio`).
 * Guardados em `plataforma.parametro` (modulo `core`), uma linha por chave, sem tabela nova. Ausente = padrão do domain.
 * O pull `parametro` leva as linhas ao aparelho (sem mudança no contrato de sync). Os limites e as mensagens moram no domain.
 */
import { definirConsulta } from '@macuxi/platform-sdk';
import { z } from 'zod';

export const PARAMETRO_DIAS_UTEIS = 'metas.dias_uteis_semana';
export const PARAMETRO_PARADO_MIN = 'inicio.parado_min';

/** Faixa e padrão de `inicio.parado_min` em minutos (RN-CORE-26). Única fonte: o domain, o BKO e o Gestão leem daqui. */
export const PARADO_MIN_MIN = 15;
export const PARADO_MIN_MAX = 480;
export const PARADO_MIN_PADRAO = 60;

/** Inteiro dentro da faixa 15..480 (RN-CORE-26). */
export const paradoMinValido = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= PARADO_MIN_MIN && n <= PARADO_MIN_MAX;

/**
 * Valor efetivo de `inicio.parado_min` a partir das linhas da entidade de sync `parametro` (`motor.linhas('parametro')`);
 * sem linha viva do módulo `core`, ou valor fora da faixa, vale o padrão (60). Mesmo molde de `promotorVePedidosDasLinhas`.
 */
export function paradoMinDasLinhas(linhas: readonly { modulo: string; chave: string; valor?: unknown; deleted_at?: string | null }[]): number {
  const l = linhas.find((x) => x.modulo === 'core' && x.chave === PARAMETRO_PARADO_MIN && !x.deleted_at);
  return paradoMinValido(l?.valor) ? l.valor : PARADO_MIN_PADRAO;
}

/** Forma do parâmetro (só o formato; a regra de faixa é do domain: `validarParametrosInicio`). */
export const ParametrosInicioPutSchema = z
  .object({
    /** 0 = domingo … 6 = sábado. */
    dias_uteis_semana: z.array(z.number()),
    parado_min: z.number(),
  })
  .strict();
export type ParametrosInicioPut = z.infer<typeof ParametrosInicioPutSchema>;

/** Valor efetivo (com os padrões aplicados) devolvido pela API. */
export const ParametrosInicioSchema = z
  .object({
    dias_uteis_semana: z.array(z.number().int().min(0).max(6)).min(1),
    parado_min: z.number().int().positive(),
  })
  .strict();
export type ParametrosInicio = z.infer<typeof ParametrosInicioSchema>;

/** Campo do formulário a que um erro de validação pertence (RN-CORE-26); a tela liga a mensagem ao campo por esta chave. */
export const CAMPOS_PARAMETROS_INICIO = ['dias_uteis_semana', 'parado_min'] as const;
export const ErroParametroInicioSchema = z.object({ campo: z.enum(CAMPOS_PARAMETROS_INICIO), mensagem: z.string().min(1) }).strict();
export type ErroParametroInicio = z.infer<typeof ErroParametroInicioSchema>;

/**
 * Consulta `core.calendario_metas@1` (RN-CORE-26; T-0124): a semana de dias úteis do tenant (`metas.dias_uteis_semana`,
 * 0 = domingo … 6 = sábado, padrão segunda a sábado) e os feriados do tenant (datas civis AAAA-MM-DD; vazia até existir
 * o cadastro de feriados). Os feriados NACIONAIS não vêm na lista e, pela RN-CORE-26, só entram na conta
 * quando a lista do tenant é informada (não vazia) à função `diasUteisDoPeriodo` de `@macuxi/comum`; lista vazia = só a
 * semana de dias úteis conta. Configuração do tenant, igual para qualquer usuário
 * (ADR 0025 §4.1); o Gestor a lê em `carregarContexto`.
 */
export const CalendarioMetasSchema = z
  .object({
    dias_uteis_semana: z.array(z.number().int().min(0).max(6)).min(1),
    feriados: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  })
  .strict();
export type CalendarioMetas = z.infer<typeof CalendarioMetasSchema>;
export const CONSULTA_CALENDARIO_METAS = definirConsulta({
  nome: 'core.calendario_metas@1',
  entrada: z.object({}).strict(),
  saida: CalendarioMetasSchema,
  configuracaoDoTenant: true,
});
