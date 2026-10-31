/**
 * Alertas do gestor (RF-GES-07): regra parametrizável (`alerta_regra`) + alerta gerado (`alerta`).
 * Chave de deduplicação = `<tipo>:<alvo_id>` (um alerta aberto por chave); encerra sozinho quando a condição deixa de valer.
 */
import { z } from 'zod';
import { InstanteUtc, Severidade, TipoAlerta, Uuid } from './base';

export const RegraAlerta = z
  .object({
    tipo: TipoAlerta,
    ativa: z.boolean(),
    /** Limite da regra (dias, horas, %, ocorrências — a unidade depende do tipo); `null` quando o tipo não usa. */
    limiar: z.number().nonnegative().nullable(),
    /** Janela de observação em dias; `null` quando o tipo não usa. */
    janela_dias: z.number().int().positive().nullable(),
    /** Amostra mínima (dias úteis decorridos, nº de fotos…) para a regra valer; `null` quando não usa. */
    amostra_min: z.number().int().nonnegative().nullable(),
    severidade: Severidade,
  })
  .strict();
export type RegraAlerta = z.infer<typeof RegraAlerta>;

export const ALVOS_ALERTA = ['cliente', 'usuario', 'pedido', 'visita_loja'] as const;
export const AlvoAlerta = z.enum(ALVOS_ALERTA);
export type AlvoAlerta = z.infer<typeof AlvoAlerta>;

export const STATUS_ALERTA = ['aberto', 'dispensado', 'encerrado'] as const;
export const StatusAlerta = z.enum(STATUS_ALERTA);
export type StatusAlerta = z.infer<typeof StatusAlerta>;

export const MOTIVOS_ENCERRAMENTO = ['condicao_normalizada', 'regra_inativa', 'duplicado'] as const;
export const MotivoEncerramento = z.enum(MOTIVOS_ENCERRAMENTO);
export type MotivoEncerramento = z.infer<typeof MotivoEncerramento>;

/** Condição detectada numa avaliação (ainda sem estado). */
export const CondicaoAlerta = z
  .object({
    chave: z.string().min(3),
    tipo: TipoAlerta,
    alvo_tipo: AlvoAlerta,
    alvo_id: Uuid,
    /** Quem responde pelo alvo (vendedor da carteira, promotor, vendedor do pedido): define o escopo (RN-CORE-04). */
    responsavel_id: Uuid.nullable(),
    /** Valor medido (dias sem visita, % de ritmo, horas de espera…); `null` quando a condição é "nunca aconteceu". */
    valor: z.number().nullable(),
    limiar: z.number().nullable(),
    severidade: Severidade,
    mensagem: z.string().min(1),
  })
  .strict();
export type CondicaoAlerta = z.infer<typeof CondicaoAlerta>;

export const Alerta = CondicaoAlerta.extend({
  id: Uuid,
  status: StatusAlerta,
  aberto_em: InstanteUtc,
  encerrado_em: InstanteUtc.nullable(),
  motivo_encerramento: MotivoEncerramento.nullable(),
}).strict();
export type Alerta = z.infer<typeof Alerta>;
