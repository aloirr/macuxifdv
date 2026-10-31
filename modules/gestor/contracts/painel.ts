/**
 * Read-model `gestor.painel_vendedor_dia` (RF-GES-01/02/10): uma linha por (usuário de campo, dia civil no fuso do
 * tenant). Seções `null` = módulo opcional desativado OU seção que não se aplica ao perfil: o painel continua válido
 * (RN-CORE-03). Dinheiro em centavos; percentuais com 2 casas (4.5 = 4,5%).
 */
import { z } from 'zod';
import { CentsNaoNeg, ContagemNaoNeg, InstanteUtc, IsoDate, PctNumero, PctOuNulo, PerfilContrato, Uuid } from './base';

export const STATUS_DIA = ['sem_checkin', 'em_rota', 'em_visita'] as const;
export const StatusDia = z.enum(STATUS_DIA);
export type StatusDia = z.infer<typeof StatusDia>;

/** Visitas do dia (Core; sempre presente). RN-CORE-20: realizadas = clientes distintos com check-in no dia. */
export const PainelVisitas = z
  .object({
    planejadas: ContagemNaoNeg,
    /** Todos os clientes distintos com check-in (da rota ou não). */
    realizadas: ContagemNaoNeg,
    /** RN-GES-05: clientes DA ROTA com check-in no dia da rota. */
    planejadas_realizadas: ContagemNaoNeg,
    /** RN-GES-05: clientes visitados fora da rota do dia; `null` sem rota planejada (sem dado). */
    visitas_extras: ContagemNaoNeg.nullable(),
    em_andamento: ContagemNaoNeg,
    /** RN-GES-05: planejadas_realizadas ÷ planejadas × 100, no máximo 100; `null` sem rota planejada. */
    cobertura_pct: PctNumero.min(0).max(100).nullable(),
    tempo_total_min: z.number().nonnegative(),
    tempo_medio_min: z.number().nonnegative().nullable(),
    /** RN-PRO-07 (só promotor): visitas encerradas abaixo da permanência mínima, sinalizadas ao gestor. */
    curtas: ContagemNaoNeg,
    /** Visitas com pedido ÷ visitas realizadas × 100 (RF-GES-02); `null` sem Vendedor ou sem visita. */
    conversao_pedido_pct: PctOuNulo,
  })
  .strict();
export type PainelVisitas = z.infer<typeof PainelVisitas>;

/** Vendas do dia (Vendedor). Pedido em nome conta para o vendedor (RN-CORE-21, RN-VEN-35). */
export const PainelVendas = z
  .object({
    vendas_cents: CentsNaoNeg,
    pedidos: ContagemNaoNeg,
    /** RN-CORE-20: clientes distintos com ≥ 1 pedido apurado no dia. */
    clientes_positivados: ContagemNaoNeg,
    ticket_medio_cents: CentsNaoNeg.nullable(),
    /** RN-VEN-03 ponderado: 1 − Σ total final ÷ Σ total pela tabela; `null` sem total de tabela. */
    desconto_medio_pct: PctOuNulo,
  })
  .strict();
export type PainelVendas = z.infer<typeof PainelVendas>;

/**
 * RN-GES-06: os dois números do painel. `vendido` = valor dos pedidos CRIADOS no período (líquido de cancelados e
 * rejeitados; orçamento não entra); `faturado` = quanto o ERP já faturou DESSES pedidos (parcial pelos itens);
 * `a_faturar` = vendido − faturado.
 */
export const PainelFaturamento = z
  .object({
    vendido_cents: CentsNaoNeg,
    faturado_cents: CentsNaoNeg,
    a_faturar_cents: CentsNaoNeg,
  })
  .strict()
  .refine((f) => f.a_faturar_cents === f.vendido_cents - f.faturado_cents, { path: ['a_faturar_cents'], message: 'RN-GES-06: a faturar = vendido − faturado.' });
export type PainelFaturamento = z.infer<typeof PainelFaturamento>;

/** Acumulado do mês até o dia + meta (RN-CORE-21/22). `meta_cents` nulo = meta não definida. */
export const PainelMes = z
  .object({
    mes: z.string().regex(/^\d{4}-\d{2}$/),
    vendas_cents: CentsNaoNeg,
    pedidos: ContagemNaoNeg,
    clientes_positivados: ContagemNaoNeg,
    ticket_medio_cents: CentsNaoNeg.nullable(),
    meta_cents: CentsNaoNeg.nullable(),
    atingimento_pct: PctOuNulo,
    /** max(0, meta − realizado). */
    falta_cents: CentsNaoNeg.nullable(),
    /** Dias úteis do mês de hoje em diante (hoje conta se for útil). */
    dias_uteis_restantes: ContagemNaoNeg,
    /** RN-CORE-22: falta ÷ dias úteis restantes; `null` sem meta ou sem dia útil restante. */
    necessidade_diaria_cents: CentsNaoNeg.nullable(),
    /** Realizado até ontem ÷ (meta × dias úteis decorridos ÷ dias úteis do mês) × 100. */
    ritmo_pct: PctOuNulo,
    /** RN-GES-06: vendido × faturado do mês até o dia. */
    faturamento: PainelFaturamento,
  })
  .strict();
export type PainelMes = z.infer<typeof PainelMes>;

/** Trade do promotor (RF-GES-10; RN-PRO-02/03/05/07/11). Só visitas que contam (permanência mínima). */
export const PainelTrade = z
  .object({
    lojas_visitadas: ContagemNaoNeg,
    conformidade_pct: PctOuNulo,
    conformidade_parciais: ContagemNaoNeg,
    share_medio_pct: PctOuNulo,
    meta_share_media_pct: PctOuNulo,
    atingimento_share_pct: PctOuNulo,
    ruptura_pct: PctOuNulo,
    falha_reposicao_pct: PctOuNulo,
    indice_preco_medio: PctOuNulo,
    tarefas_concluidas: ContagemNaoNeg,
    /** RN-PRO-02: do dia inteiro (todas as visitas); `null` quando o Promotor não informou as fotos. */
    fotos_total: ContagemNaoNeg.nullable(),
    fotos_sem_gps: ContagemNaoNeg.nullable(),
    fotos_sem_gps_pct: PctOuNulo,
  })
  .strict();
export type PainelTrade = z.infer<typeof PainelTrade>;

export const PainelPesquisa = z.object({ respostas: ContagemNaoNeg, suspeitas: ContagemNaoNeg }).strict();
export type PainelPesquisa = z.infer<typeof PainelPesquisa>;

export const PainelTreinamento = z
  .object({ licoes_concluidas: ContagemNaoNeg, trilhas_concluidas: ContagemNaoNeg, xp_ganho: ContagemNaoNeg, medalhas: ContagemNaoNeg })
  .strict();
export type PainelTreinamento = z.infer<typeof PainelTreinamento>;

export const PainelDia = z
  .object({
    usuario_id: Uuid,
    perfil: PerfilContrato,
    /** Data civil no fuso do tenant. */
    data: IsoDate,
    status_dia: StatusDia,
    visitas: PainelVisitas,
    vendas: PainelVendas.nullable(),
    /** RN-GES-06: vendido × faturado do dia; `null` sem Vendedor ou perfil que não vende. */
    faturamento: PainelFaturamento.nullable(),
    mes: PainelMes.nullable(),
    trade: PainelTrade.nullable(),
    pesquisa: PainelPesquisa.nullable(),
    treinamento: PainelTreinamento.nullable(),
    calculado_em: InstanteUtc,
  })
  .strict();
export type PainelDia = z.infer<typeof PainelDia>;

/** Agregado de uma equipe (RF-GES-01): soma dos vendedores/promotores abaixo do nó. */
export const ResumoEquipe = z
  .object({
    gestor_id: Uuid,
    membros: ContagemNaoNeg,
    sem_checkin: ContagemNaoNeg,
    em_rota: ContagemNaoNeg,
    em_visita: ContagemNaoNeg,
    vendas_cents: CentsNaoNeg.nullable(),
    pedidos: ContagemNaoNeg.nullable(),
    meta_cents: CentsNaoNeg.nullable(),
    /** Vendas do mês ÷ meta, só dos vendedores que têm meta; `null` sem meta. */
    atingimento_pct: PctOuNulo,
    visitas_realizadas: ContagemNaoNeg,
    visitas_planejadas: ContagemNaoNeg,
    /** RN-GES-05: soma dos clientes da rota visitados. */
    visitas_planejadas_realizadas: ContagemNaoNeg,
    /** RN-GES-05: soma das visitas fora da rota; `null` se ninguém tinha rota. */
    visitas_extras: ContagemNaoNeg.nullable(),
    /** RN-GES-05: Σ planejadas realizadas ÷ Σ planejadas (máximo 100). */
    cobertura_pct: PctNumero.min(0).max(100).nullable(),
    /** RN-GES-06: somas do dia; `null` sem nenhuma linha com Vendedor. */
    vendido_cents: CentsNaoNeg.nullable(),
    faturado_cents: CentsNaoNeg.nullable(),
    a_faturar_cents: CentsNaoNeg.nullable(),
  })
  .strict();
export type ResumoEquipe = z.infer<typeof ResumoEquipe>;
