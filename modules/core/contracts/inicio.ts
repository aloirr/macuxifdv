/**
 * `core.inicio@1` (T-0073; desenho docs/desenho/T-0073.md §1): rota `GET /v1/core/inicio` e visão da tela de boas-vindas.
 * A API traz só o que o aparelho não tem no pull (realizado de vendas e positivação até ontem × hoje, e nomes da equipe);
 * o resto o aparelho calcula com as MESMAS funções puras do domain (RN-CORE-26). Dinheiro em centavos; datas civis no fuso do tenant.
 */
import { z } from 'zod';
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
    /** T-0076 (aditivo): nome da equipe de quem pede (responsável ou membro); null = sem equipe. Cabeçalho da Gestão. */
    equipe_nome: z.string().nullable().optional(),
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
    /** T-0076 (aditivo): nome do cliente em visita ("Em visita · Atacado Boto Rosa"); null fora de em_visita ou sem cópia do cliente. */
    cliente_nome: z.string().nullable().optional(),
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
    /** Ordem: venda_cents, positivacao, visitas, cobertura_pct. */
    metas: z.array(MetaDoDiaSchema),
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
    /** T-0076 (RD-0012: obrigatórios; só visão local, sem payload de API): boas-vindas, recados, meta de hoje e sincronização do Início pela referência aprovada. */
    saudacao: z.enum(['Bom dia', 'Boa tarde', 'Boa noite']),
    /** Nome da equipe do usuário (cabeçalho da Gestão); null = sem equipe ou sem a cópia. */
    equipe_nome: z.string().nullable().optional(),
    /** 'Recados de hoje': até 3 itens, o recado do dia primeiro e destacado; novos = não lidas da caixa. */
    recados_hoje: z
      .object({
        novos: Inteiro,
        /** RD-0009: total de recados da caixa (o shell esconde "Ver todos" quando total ≤ itens mostrados). */
        total: Inteiro,
        itens: z
          .array(
            z
              .object({
                id: z.string().uuid(),
                titulo: z.string(),
                subtitulo: z.string(),
                tipo: z.string(),
                criada_em: z.string(),
                /** HH:mm no fuso do tenant. */
                hora: z.string(),
                lida: z.boolean(),
                link: z.string().nullable(),
                destaque: z.boolean(),
              })
              .strict(),
          )
          .max(3),
      })
      .strict(),
    /** Cartão 'Meta de hoje': a meta de venda (ou, sem ela, a primeira meta do usuário); null = sem meta/realizado. Pontos-base: 10000 = 100%. */
    meta_hoje: z
      .object({
        indicador: z.enum(INDICADORES_META),
        situacao: z.enum(SITUACOES_META_DIA),
        realizado_hoje: Inteiro,
        meta_dia: Inteiro.nullable(),
        faltam_hoje: Inteiro.nullable(),
        mes_pct: Inteiro.nullable(),
        /** RD-0002: max(0, meta do mês − realizado do mês) na unidade do indicador; null sem meta do mês. */
        faltam_mes: Inteiro.nullable(),
        /** RD-0002: necessidade diária (RN-CORE-22/26, a mesma de Metas); null sem dias úteis restantes, com o mês batido ou em indicador só do mês. */
        por_dia_util: Inteiro.nullable(),
        /** RD-0002: dias úteis restantes usados na divisão do `por_dia_util` (hoje conta se for útil). */
        dias_uteis_por_dia: Inteiro,
      })
      .strict()
      .nullable(),
    /** Indicadores COM meta no mês e SEM realizado na cópia ('Sincronize para ver as vendas'; não confundir com 'sem meta'). */
    sem_realizado: z.array(z.enum(INDICADORES_META)),
  })
  .strict();
export type VisaoInicio = z.infer<typeof VisaoInicioSchema>;
