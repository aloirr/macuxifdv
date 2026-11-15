/** Metas e indicadores básicos (desenho T-0016 §6.2; RN-CORE-20 a 22). */
import { z } from 'zod';
import { INDICADORES_META, TIPOS_META } from './sync';
const AnoMes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const PutMetaSchema = z.object({ indicador: z.enum(INDICADORES_META), valor: z.number().int().min(0), tipo: z.enum(TIPOS_META).optional() }).strict();
export const IndicadoresSchema = z.object({
    periodo: AnoMes,
    usuario_id: z.string().uuid(),
    planejados: z.number().int(),
    visitados: z.number().int(),
    /** Pontos-base (8500 = 85,00%). */
    cobertura_pct: z.number().int(),
    positivados: z.number().int().nullable().optional(),
    realizado_cents: z.number().int().nullable().optional(),
    meta_cents: z.number().int().nullable().optional(),
    dias_uteis_restantes: z.number().int(),
    necessidade_diaria_cents: z.number().int().nullable().optional(),
});
export const MetasQuerySchema = z.object({ periodo: AnoMes.optional(), usuario_id: z.string().uuid().optional() }).strict();
export const MetaParamsSchema = z.object({ usuarioId: z.string().uuid(), periodo: AnoMes });
export const MetasListaSchema = z.object({
    periodo: AnoMes,
    itens: z.array(z.object({ usuario_id: z.string().uuid(), indicador: z.enum(INDICADORES_META), valor: z.number().int(), tipo: z.enum(TIPOS_META) })),
});
export const LinhaPainelSchema = z.object({
    indicador: z.enum(INDICADORES_META),
    meta: z.number().int(),
    realizado: z.number().int().nullable(),
    /** Pontos-base (10000 = 100,00%). */
    atingimento_pct: z.number().int().nullable(),
});
export const PainelMetasSchema = z.object({
    usuario_id: z.string().uuid(),
    usuario_nome: z.string(),
    indicadores: IndicadoresSchema,
    metas: z.array(LinhaPainelSchema),
});
export const IndicadoresListaSchema = z.object({
    periodo: AnoMes,
    /** Base de apuração do tenant (`metas.base_apuracao`); vale para pedidos individuais, o read-model diário já vem apurado. */
    base_apuracao: z.enum(['aprovado', 'faturado']),
    /** RN-CORE-21: `parcial` até o 2º dia útil do mês seguinte (`fechamento_em`), depois `fechado`. */
    situacao: z.enum(['parcial', 'fechado']).optional(),
    fechamento_em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    itens: z.array(PainelMetasSchema),
});
// ---------- BKO de metas (T-0068; RN-CORE-20, RN-CORE-21) ----------
export const PainelMetasBkoQuerySchema = z
    .object({ periodo: AnoMes.optional(), equipe_id: z.string().uuid().optional(), usuario_id: z.string().uuid().optional() })
    .strict();
/** Uma linha por usuário de campo e indicador. `meta` 0 = sem meta definida (atingimento nulo). */
export const LinhaMetaBkoSchema = z.object({
    usuario_id: z.string().uuid(),
    usuario_nome: z.string(),
    equipe_id: z.string().uuid().nullable(),
    indicador: z.enum(INDICADORES_META),
    tipo: z.enum(TIPOS_META),
    /** Centavos (`venda_cents`), contagem ou pontos-base (`cobertura_pct`). */
    meta: z.number().int(),
    realizado: z.number().int().nullable(),
    /** Pontos-base (10000 = 100,00%). */
    atingimento_pct: z.number().int().nullable(),
    /** O usuário logado pode editar esta meta (RN-CORE-20, domínio `podeEditarMetaDe`). */
    editavel: z.boolean(),
});
export const PainelMetasBkoSchema = z.object({
    periodo: AnoMes,
    base_apuracao: z.enum(['aprovado', 'faturado']),
    situacao: z.enum(['parcial', 'fechado']).optional(),
    fechamento_em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    linhas: z.array(LinhaMetaBkoSchema),
});
/** Meta por equipe: o mesmo corpo da meta individual, aplicado a cada vendedor/promotor ativo da equipe. */
export const MetaEquipeSchema = PutMetaSchema;
export const MetaEquipeParamsSchema = z.object({ equipeId: z.string().uuid(), periodo: AnoMes });
export const MetaEquipeRespostaSchema = z.object({
    equipe_id: z.string().uuid(),
    periodo: AnoMes,
    indicador: z.enum(INDICADORES_META),
    valor: z.number().int(),
    tipo: z.enum(TIPOS_META),
    usuarios: z.array(z.string().uuid()),
    alterados: z.number().int(),
});
/** Copiar do mês anterior (T-0068): não sobrescreve meta já definida no mês de destino. */
export const CopiarMetasSchema = z.object({ de: AnoMes, para: AnoMes, equipe_id: z.string().uuid().optional() }).strict();
export const CopiarMetasRespostaSchema = z.object({ de: AnoMes, para: AnoMes, copiadas: z.number().int(), ignoradas: z.number().int() });
