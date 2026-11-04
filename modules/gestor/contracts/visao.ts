/**
 * Respostas e consultas das rotas do Gestor (`/v1/gestor`, T-0055): visão da equipe, ficha, ranking, fila de aprovação,
 * alertas e regras de alerta. Fonte da verdade para a API, o app Gestão (cache offline) e o BKO.
 * Escopo (RN-CORE-04) e licença (RN-CORE-02) são aplicados pela API; aqui só o formato.
 */
import { z } from 'zod';
import { Alerta, RegraAlerta, StatusAlerta } from './alerta';
import { ItemFilaAprovacao, ResumoFila } from './aprovacao';
import { InstanteUtc, IsoDate, PeriodoRanking, TipoAlerta, Uuid } from './base';
import { MembroEquipe } from './equipe';
import { PainelDia, ResumoEquipe } from './painel';
import { DisponibilidadeEmNome } from './pedido-em-nome';
import { IndicadorRanking } from './ranking';

/** Caminhos das rotas (relativos a `/v1`), usados pelo app e pelo BKO. */
export const ROTAS_GESTOR = {
  equipe: '/gestor/equipe',
  ficha: (usuarioId: string) => `/gestor/equipe/${usuarioId}`,
  ranking: '/gestor/ranking',
  aprovacoes: '/gestor/aprovacoes',
  alertas: '/gestor/alertas',
  dispensarAlerta: (alertaId: string) => `/gestor/alertas/${alertaId}/dispensar`,
  regras: '/gestor/alertas/regras',
  regra: (tipo: string) => `/gestor/alertas/regras/${tipo}`,
  pedidoEmNome: '/gestor/pedido-em-nome/disponibilidade',
} as const;

// ---------- consultas (query string) ----------
/** `data` = dia civil no fuso do tenant; ausente = hoje. */
export const DataQuery = z.object({ data: IsoDate.optional() }).strict();
export type DataQuery = z.infer<typeof DataQuery>;

export const RankingQuery = z
  .object({ indicador: IndicadorRanking.default('vendas_cents'), periodo: PeriodoRanking.default('mensal'), data: IsoDate.optional() })
  .strict();
export type RankingQuery = z.infer<typeof RankingQuery>;

/** `status` filtra; sem ele vêm os ATIVOS (abertos e dispensados), que é o que a tela mostra. */
export const AlertasQuery = z.object({ status: StatusAlerta.optional() }).strict();
export type AlertasQuery = z.infer<typeof AlertasQuery>;

export const DisponibilidadeEmNomeQuery = z.object({ vendedor_id: Uuid }).strict();
export type DisponibilidadeEmNomeQuery = z.infer<typeof DisponibilidadeEmNomeQuery>;

// ---------- respostas ----------
export const MembroComPainel = z.object({ membro: MembroEquipe, painel: PainelDia }).strict();
export type MembroComPainel = z.infer<typeof MembroComPainel>;

/** RF-GES-01: resumo de quem consulta (gestor_id = ele), um resumo por equipe abaixo (gerente) e cada pessoa de campo. */
export const VisaoEquipe = z
  .object({
    data: IsoDate,
    resumo: ResumoEquipe,
    equipes: z.array(ResumoEquipe),
    /** Quem lidera cada equipe de `equipes` (nome para a tela), na mesma ordem. */
    gestores: z.array(MembroEquipe),
    membros: z.array(MembroComPainel),
    /** T-0073 (aditivo): limite do "parado" do tenant (`inicio.parado_min`); ausente = 60. */
    parado_min: z.number().int().positive().optional(),
    calculado_em: InstanteUtc,
  })
  .strict();
export type VisaoEquipe = z.infer<typeof VisaoEquipe>;

/** RF-GES-02/10: ficha do vendedor ou promotor no dia + se o pedido em nome aparece (RF-GES-05). */
export const FichaMembro = z.object({ membro: MembroEquipe, painel: PainelDia, pedido_em_nome: DisponibilidadeEmNome }).strict();
export type FichaMembro = z.infer<typeof FichaMembro>;

/** RF-GES-04: fila de quem consulta, já ordenada por prazo, com o resumo do topo da tela. */
export const FilaAprovacao = z.object({ itens: z.array(ItemFilaAprovacao), resumo: ResumoFila, calculado_em: InstanteUtc }).strict();
export type FilaAprovacao = z.infer<typeof FilaAprovacao>;

export const ListaAlertas = z.object({ itens: z.array(Alerta), calculado_em: InstanteUtc }).strict();
export type ListaAlertas = z.infer<typeof ListaAlertas>;

export const RegrasAlertaResposta = z.object({ regras: z.array(RegraAlerta) }).strict();
export type RegrasAlertaResposta = z.infer<typeof RegrasAlertaResposta>;

/** Ajuste de uma regra (BKO, `alerta_regra.gerenciar`): só os campos enviados mudam; `tipo` vem no caminho. */
export const AjusteRegraAlerta = RegraAlerta.omit({ tipo: true }).partial().strict();
export type AjusteRegraAlerta = z.infer<typeof AjusteRegraAlerta>;

export const ParamsTipoAlerta = z.object({ tipo: TipoAlerta }).strict();
export const ParamsId = z.object({ id: Uuid }).strict();
export const ParamsUsuario = z.object({ usuario_id: Uuid }).strict();

/** Ajustes guardados por tenant (parciais por tipo), entrada de `resolverRegras`. */
export const AjustesRegras = z.record(TipoAlerta, AjusteRegraAlerta);
export type AjustesRegras = z.infer<typeof AjustesRegras>;
