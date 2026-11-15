/**
 * Valores dos parâmetros do tenant que ficam DENTRO das regras de alerta da equipe (Parâmetros › Alertas, T-0180):
 * tolerância, sem frequência e carência do cliente (RN-GES-01/02), prazo da aprovação (RN-GES-03) e permanência mínima
 * (RN-PRO-07). Um valor, um lugar: são as mesmas chaves do tenant (`plataforma.parametro`, módulo `gestor`) que o avaliador
 * e a fila de aprovação já leem. `GET|PUT /v1/gestor/parametros/alertas` (ação `alerta_regra.gerenciar`).
 */
import { z } from 'zod';

export const ParametrosAlertasEquipe = z
  .object({
    pct_tolerancia_frequencia: z.number().int().min(0).max(500),
    dias_sem_visita_padrao: z.number().int().min(1).max(365),
    dias_carencia_cliente_novo: z.number().int().min(0).max(365),
    prazo_aprovacao_dias_uteis: z.number().int().min(1).max(30),
    permanencia_min_min: z.number().int().min(1).max(180),
  })
  .strict();
export type ParametrosAlertasEquipe = z.infer<typeof ParametrosAlertasEquipe>;

export const CHAVES_PARAMETROS_ALERTAS = ['pct_tolerancia_frequencia', 'dias_sem_visita_padrao', 'dias_carencia_cliente_novo', 'prazo_aprovacao_dias_uteis', 'permanencia_min_min'] as const;
export type ChaveParametroAlerta = (typeof CHAVES_PARAMETROS_ALERTAS)[number];
