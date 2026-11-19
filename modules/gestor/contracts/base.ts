/**
 * Tipos básicos dos contratos do Gestor. Dinheiro em centavos inteiros (ADR 0002), instantes ISO 8601 em UTC
 * (`...Z`), datas civis `AAAA-MM-DD` no fuso do tenant (só a EXIBIÇÃO e o "dia" usam o fuso; o armazenado é UTC).
 * Campo `null` num indicador = "sem dado" OU "módulo opcional desativado" (o painel nunca quebra, RN-CORE-03).
 */
import { z } from 'zod';
import { MODULOS, PERFIS } from '@macuxi/platform-sdk';
import { ESTADOS_APROVACAO_MOTIVO } from '../../vendedor/contracts';

export { IsoDate } from '@macuxi/core/contracts';

export const Uuid = z.string().uuid();
/** Instante em UTC (`2026-10-31T13:00:00Z`); a exibição usa o fuso do tenant. */
export const InstanteUtc = z.string().datetime();
export const Cents = z.number().int();
export const CentsNaoNeg = z.number().int().nonnegative();
export const ContagemNaoNeg = z.number().int().nonnegative();
export const PctNumero = z.number().finite();
/** Percentual que pode ser `null` quando não há dados ou o módulo de origem está desativado. */
export const PctOuNulo = PctNumero.nullable();

export const PerfilContrato = z.enum(PERFIS);
export const ModuloContrato = z.enum(MODULOS);

/** Perfis que aparecem como pessoa da equipe (RF-GES-01). */
export const PERFIS_DE_CAMPO = ['vendedor', 'promotor'] as const;

/** Estados do pedido (RN-VEN-30; `faturado` vem do ERP como parcial/total, doc 03 §4 e RN-INT-08). */
export const STATUS_PEDIDO = [
  'rascunho',
  'na_fila',
  'recebido',
  'em_aprovacao',
  'aprovado',
  'rejeitado',
  'integrado_erp',
  'faturado_parcial',
  'faturado_total',
  'cancelado',
] as const;
export const StatusPedido = z.enum(STATUS_PEDIDO);
export type StatusPedido = z.infer<typeof StatusPedido>;

/**
 * Níveis, motivos, estados e decisões da aprovação são do Vendedor (dono do ciclo, RN-VEN-10..13, T-0184): o Gestor só os
 * reexporta, sem lista própria.
 */
export { DECISOES_APROVADOR, ESTADOS_APROVACAO_MOTIVO, maiorNivel, MOTIVO_REJEICAO_MIN, MOTIVOS_APROVACAO, MotivoAprovacao, NIVEIS_APROVACAO, NivelAprovacao } from '../../vendedor/contracts';
export const EstadoAprovacaoMotivo = z.enum(ESTADOS_APROVACAO_MOTIVO);
export type EstadoAprovacaoMotivo = z.infer<typeof EstadoAprovacaoMotivo>;

/** As 6 regras da equipe, na ordem da tela (`alerta_regra`); só elas têm ajuste em `alertas/regras` (ADR 0059 §1). */
export const TIPOS_REGRA_EQUIPE = ['cliente_sem_visita', 'ritmo_abaixo_meta', 'pedido_aguardando_aprovacao', 'ruptura_recorrente', 'visita_curta', 'fotos_sem_gps'] as const;
/** T-0180 / D4: tipos de produtividade do dia, um alerta aberto por pessoa (sem regra própria em `alerta_regra`; o liga/desliga vem do parâmetro do core). */
export const TIPOS_ALERTA_PRODUTIVIDADE = ['parado_entre_visitas', 'sem_checkin_inicio'] as const;
export const TIPOS_ALERTA = [...TIPOS_REGRA_EQUIPE, ...TIPOS_ALERTA_PRODUTIVIDADE] as const;
export type TipoRegraEquipe = (typeof TIPOS_REGRA_EQUIPE)[number];
export const TipoAlerta = z.enum(TIPOS_ALERTA);
export type TipoAlerta = z.infer<typeof TipoAlerta>;

/**
 * Alerta que existe só no APARELHO (T-0039 §4.3): vem da notificação do Core, não de regra de servidor; por isso fica
 * fora de `TIPOS_ALERTA` (CHECK de `gestor.alerta`/`alerta_regra`, regras do BKO e dispensa).
 */
export const ALERTA_PENDENCIA_CHECKOUT = 'etapa_pendente_checkout' as const;
export interface AlertaPendenciaCheckout {
  id: string;
  tipo: typeof ALERTA_PENDENCIA_CHECKOUT;
  titulo: string;
  mensagem: string;
  cliente_id: string;
  severidade: 'atencao';
  aberto_em: string;
}

export const SEVERIDADES = ['info', 'atencao', 'critica'] as const;
export const Severidade = z.enum(SEVERIDADES);
export type Severidade = z.infer<typeof Severidade>;
/** Rótulo da severidade nas telas do BKO e do Gestão (um lugar só, RD-1513). */
export const ROTULO_SEVERIDADE: Readonly<Record<Severidade, string>> = { info: 'Informativo', atencao: 'Atenção', critica: 'Crítico' };

/** Período do ranking: dia, semana (segunda a domingo) ou mês civil, no fuso do tenant. */
export const PERIODOS_RANKING = ['diario', 'semanal', 'mensal'] as const;
export const PeriodoRanking = z.enum(PERIODOS_RANKING);
export type PeriodoRanking = z.infer<typeof PeriodoRanking>;
