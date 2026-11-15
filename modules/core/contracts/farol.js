/**
 * Farol de clientes no BKO (RN-CORE-28; T-0081; desenho docs/desenho/T-0081.md §4): `GET /v1/core/farol` e
 * `GET|PUT /v1/core/parametros/farol`. Contratos aditivos. Percentuais em pontos-base (10000 = 100,00%), como `metas/painel`.
 * Os parâmetros ficam em `plataforma.parametro` (modulo `core`); linha ausente = padrão do domain. Limites e mensagens: domain.
 */
import { z } from 'zod';
const Uuid = z.string().uuid();
const AnoMes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const PARAMETRO_FAROL_VERDE_DIAS = 'farol.verde_ate_dias';
export const PARAMETRO_FAROL_AMARELO_DIAS = 'farol.amarelo_ate_dias';
export const PARAMETRO_FAROL_POSITIVACAO_VERDE = 'farol.positivacao_verde_pct';
export const PARAMETRO_FAROL_POSITIVACAO_AMARELO = 'farol.positivacao_amarelo_pct';
export const CorFarolSchema = z.enum(['verde', 'amarelo', 'vermelho', 'sem_compra']);
export const CORES_FAROL = CorFarolSchema.options;
/** Forma dos parâmetros (inteiros); a regra de faixa é do domain (`validarParametrosFarol`). */
export const ParametrosFarolSchema = z
    .object({
    verde_ate_dias: z.number().int(),
    amarelo_ate_dias: z.number().int(),
    positivacao_verde_pct: z.number().int(),
    positivacao_amarelo_pct: z.number().int(),
})
    .strict();
/** O PUT leva os quatro (a tela sempre envia o conjunto). Números fora do formato são recusados pela regra, com mensagem por campo. */
export const ParametrosFarolPutSchema = z
    .object({ verde_ate_dias: z.number(), amarelo_ate_dias: z.number(), positivacao_verde_pct: z.number(), positivacao_amarelo_pct: z.number() })
    .strict();
export const CAMPOS_PARAMETROS_FAROL = ['verde_ate_dias', 'amarelo_ate_dias', 'positivacao_verde_pct', 'positivacao_amarelo_pct'];
export const ErroParametroFarolSchema = z.object({ campo: z.enum(CAMPOS_PARAMETROS_FAROL), mensagem: z.string().min(1) }).strict();
export const FAROL_LIMITE_PADRAO = 200;
export const FAROL_LIMITE_MAX = 500;
export const FarolQuerySchema = z
    .object({
    periodo: AnoMes.optional(),
    equipe_id: Uuid.optional(),
    usuario_id: Uuid.optional(),
    cor: CorFarolSchema.optional(),
    busca: z.string().max(60).optional(),
    limite: z.coerce.number().int().min(1).max(FAROL_LIMITE_MAX).optional(),
    cursor: z.string().max(20).optional(),
})
    .strict();
const PorCorSchema = z.object({ verde: z.number().int(), amarelo: z.number().int(), vermelho: z.number().int(), sem_compra: z.number().int() }).strict();
export const FarolResumoSchema = z
    .object({
    carteira: z.number().int(),
    positivados: z.number().int(),
    /** Pontos-base (10000 = 100,00%). */
    positivacao_pct: z.number().int(),
    cor: CorFarolSchema.nullable(),
    por_cor: PorCorSchema,
})
    .strict();
export const FarolVendedorSchema = FarolResumoSchema.extend({
    usuario_id: Uuid,
    nome: z.string(),
    equipe_id: Uuid.nullable(),
}).strict();
export const FarolClienteSchema = z
    .object({
    cliente_id: Uuid,
    nome: z.string(),
    documento_mascarado: z.string().nullable(),
    usuario_id: Uuid,
    ultima_compra_em: Dia.nullable(),
    dias_sem_compra: z.number().int().nullable(),
    positivado_mes: z.boolean(),
    cor: CorFarolSchema,
})
    .strict();
export const FarolSchema = z
    .object({
    periodo: AnoMes,
    hoje: Dia,
    /** `pedido` = RN-CORE-20 (lista diária do read-model); `nota_erp` = RN-CORE-27; null = sem fonte de positivação. */
    fonte_positivacao: z.enum(['pedido', 'nota_erp']).nullable(),
    parametros: ParametrosFarolSchema,
    resumo: FarolResumoSchema,
    vendedores: z.array(FarolVendedorSchema),
    clientes: z.array(FarolClienteSchema),
    proximo_cursor: z.string().nullable(),
})
    .strict();
