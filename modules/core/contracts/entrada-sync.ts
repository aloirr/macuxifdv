/**
 * Etapas nomeadas da carga na tela de entrada do app (T-0172; docs/marca/propostas/2026-11-12-entrada-sync).
 * O motor de sync (`EstadoMotorSync.carga`) diz a entidade em curso; `progressoDaEntrada` (domain) devolve este formato.
 * A tela mostra só o nome da etapa, o percentual do total e a lista (✓ feita, ponto na atual); nada de nome técnico.
 */
import { z } from 'zod';

export const EtapaEntradaId = z.enum([
  // Campo
  'envio',
  'clientes_rota',
  'catalogo_precos',
  'pedidos_metas',
  'fotos_materiais',
  // Gestão
  'equipe',
  'aprovacoes',
  'metas',
  'alertas',
]);
export type EtapaEntradaId = z.infer<typeof EtapaEntradaId>;

export const SituacaoEtapaEntrada = z.enum(['feita', 'atual', 'pendente', 'parou']);
export type SituacaoEtapaEntrada = z.infer<typeof SituacaoEtapaEntrada>;

export const EtapaEntradaSchema = z.object({
  id: EtapaEntradaId,
  nome: z.string(),
  /** Posição na lista do perfil, a partir de 1 (só entram as etapas dos módulos efetivos). */
  numero: z.number().int().min(1),
  situacao: SituacaoEtapaEntrada,
});
export type EtapaEntrada = z.infer<typeof EtapaEntradaSchema>;

export const ProgressoEntradaSchema = z.object({
  etapas: z.array(EtapaEntradaSchema).min(1),
  /** Etapa em curso (ou a que parou); com a carga pronta, a última. */
  atual: EtapaEntradaSchema,
  /** Quantidade de etapas do perfil. */
  total: z.number().int().min(1),
  /** 0..100 do total da carga; 99 no máximo enquanto não termina. */
  percentual: z.number().int().min(0).max(100),
  pronta: z.boolean(),
  /** A carga parou nesta etapa (sem sinal ou erro): vai ao Diagnóstico (`ParadaDiagnostico`). */
  parou_em: EtapaEntradaSchema.nullable(),
});
export type ProgressoEntrada = z.infer<typeof ProgressoEntradaSchema>;

/** Etapa em que a carga parou, para o Diagnóstico (ex.: 3 de 5, "Catálogo e preços"). */
export const ParadaDiagnosticoSchema = z.object({
  numero: z.number().int().min(1),
  total: z.number().int().min(1),
  nome: z.string(),
});
export type ParadaDiagnostico = z.infer<typeof ParadaDiagnosticoSchema>;

/**
 * Entidades do Core que pertencem à etapa "Catálogo e preços" da entrada do Campo (RN-CORE-48), na ordem da carga.
 * O Catálogo usa esta lista em vez de repeti-la.
 */
export const ENTIDADES_CORE_CATALOGO_PRECOS = ['produto', 'produto_unidade', 'medida'] as const;
