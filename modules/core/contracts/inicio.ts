/**
 * `core.inicio@1` (T-0073; desenho docs/desenho/T-0073.md §1): rota `GET /v1/core/inicio` e visão da tela de boas-vindas.
 * A API traz só o que o aparelho não tem no pull (realizado de vendas e positivação até ontem × hoje, e nomes da equipe);
 * o resto o aparelho calcula com as MESMAS funções puras do domain (RN-CORE-26). Dinheiro em centavos; datas civis no fuso do tenant.
 */
import { z } from 'zod';
import { PerfilSchema } from './auth';
import { INDICADORES_META, TIPOS_META } from './sync';

const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const AnoMes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Inteiro = z.number().int().nonnegative();

/** Realizado do dia partido em "até ontem" e "hoje" (RN-CORE-26), pela regra do tipo da meta (RN-CORE-21). */
export const RealizadoPartidoSchema = z.object({ ate_ontem: Inteiro, hoje: Inteiro }).strict();
export type RealizadoPartido = z.infer<typeof RealizadoPartidoSchema>;

export const InicioQuerySchema = z.object({}).strict();

export const InicioUsuarioSchema = z
  .object({
    usuario_id: z.string().uuid(),
    nome: z.string(),
    perfil: z.enum(['vendedor', 'promotor']),
    equipe_id: z.string().uuid().nullable(),
    /** `core.meta.tipo` da meta venda_cents; sem meta = 'pedido'. */
    tipo_meta_venda: z.enum(TIPOS_META),
    /** Centavos; null = sem fonte (Vendedor desligado ou não instalado) ou promotor sem meta de venda. */
    venda_cents: RealizadoPartidoSchema.nullable(),
    /** Clientes distintos; positivados até hoje − até ontem = clientes novos no mês hoje. */
    positivacao: RealizadoPartidoSchema.nullable(),
  })
  .strict();
export type InicioUsuario = z.infer<typeof InicioUsuarioSchema>;

export const SITUACOES_META_DIA = ['a_cumprir', 'dia_batido', 'mes_batido', 'dia_nao_util', 'do_mes'] as const;
export type SituacaoMetaDia = (typeof SITUACOES_META_DIA)[number];
export const MetaDoDiaSchema = z
  .object({
    indicador: z.enum(INDICADORES_META),
    situacao: z.enum(SITUACOES_META_DIA),
    meta_mes: Inteiro,
    realizado_ate_ontem: Inteiro,
    realizado_hoje: Inteiro,
    /** null em dia_nao_util e do_mes. */
    meta_dia: Inteiro.nullable(),
    /** Pontos-base (10000 = 100%); null sem meta_dia > 0. */
    atingimento_hoje_pct: Inteiro.nullable(),
    /** Contando hoje se for útil. */
    dias_uteis_restantes: Inteiro,
    /** 1 no individual; pessoas COM meta no indicador na soma da equipe. */
    membros: Inteiro,
    membros_mes_batido: Inteiro,
  })
  .strict();
export type MetaDoDia = z.infer<typeof MetaDoDiaSchema>;

export const InicioSchema = z
  .object({
    /** Hoje no fuso do tenant na hora do cálculo. */
    dia: Data,
    periodo: AnoMes,
    calculado_em: z.string().datetime(),
    /** vendedor/promotor = proprio; supervisor/gerente = equipe. */
    escopo: z.enum(['proprio', 'equipe']),
    /** proprio: só ele; equipe: vendedores e promotores ATIVOS do escopo. */
    usuarios: z.array(InicioUsuarioSchema),
    /** Mesma conta do aparelho, sobre o banco (conferência app × API). */
    metas_do_dia: z.array(MetaDoDiaSchema),
  })
  .strict();
export type Inicio = z.infer<typeof InicioSchema>;

export const STATUS_AGORA = ['em_visita', 'em_rota', 'parado', 'sem_checkin', 'rota_concluida'] as const;
export type StatusAgoraContrato = (typeof STATUS_AGORA)[number];
export const MembroAgoraSchema = z
  .object({
    usuario_id: z.string().uuid(),
    nome: z.string(),
    status: z.enum(STATUS_AGORA),
    /** Instante UTC da última atividade. */
    desde: z.string().nullable(),
    cliente_id: z.string().uuid().nullable(),
    paradas_hoje: Inteiro,
    visitadas_hoje: Inteiro,
    vendas_hoje_cents: Inteiro.nullable(),
    minutos_sem_atividade: Inteiro.nullable(),
  })
  .strict();
export type MembroAgoraContrato = z.infer<typeof MembroAgoraSchema>;

/** Visão que o hook `useInicio()` entrega ao shell (desenho §1.3). */
export const VisaoInicioSchema = z
  .object({
    escopo: z.enum(['proprio', 'equipe']),
    hoje: Data,
    dia_util: z.boolean(),
    dias_uteis_restantes: Inteiro,
    recado: z
      .object({
        origem: z.enum(['recado', 'padrao']),
        texto: z.string(),
        titulo: z.string().nullable(),
        autor_nome: z.string().nullable(),
        autor_perfil: PerfilSchema.nullable(),
        notificacao_id: z.string().uuid().nullable(),
      })
      .strict(),
    /** Ordem: venda_cents, positivacao, visitas, cobertura_pct. */
    metas: z.array(MetaDoDiaSchema),
    notificacoes: z
      .object({
        nao_lidas: Inteiro,
        ultimas: z
          .array(
            z
              .object({
                id: z.string().uuid(),
                titulo: z.string(),
                tipo: z.string(),
                criada_em: z.string(),
                lida: z.boolean(),
                link: z.string().nullable(),
              })
              .strict(),
          )
          .max(3),
      })
      .strict(),
    /** null no escopo equipe. */
    rota: z
      .object({
        paradas_hoje: Inteiro,
        visitadas_hoje: Inteiro,
        restantes: Inteiro,
        proxima: z.object({ cliente_id: z.string().uuid(), nome: z.string() }).strict().nullable(),
        visita_aberta: z.object({ visita_id: z.string().uuid(), cliente_id: z.string().uuid(), nome: z.string() }).strict().nullable(),
      })
      .strict()
      .nullable(),
    /** null no escopo proprio. */
    equipe_agora: z.array(MembroAgoraSchema).nullable(),
    base: z.object({ dia: Data.nullable(), calculado_em: z.string().nullable(), defasado: z.boolean() }).strict(),
  })
  .strict();
export type VisaoInicio = z.infer<typeof VisaoInicioSchema>;
