/**
 * Tipos básicos dos contratos do Treinamento: ids são UUID gerados no aparelho (escrita idempotente),
 * instantes são ISO 8601 em UTC (`...Z`); a exibição usa o fuso do tenant.
 */
import { z } from 'zod';

export { IsoDate } from '@macuxi/core/contracts';

export const Uuid = z.string().uuid();
export const InstanteUtc = z.string().datetime();
/** Percentual 0–100 (nota, adesão, progresso). */
export const Pct0a100 = z.number().min(0).max(100);
export const Pontos = z.number().int().nonnegative();
export const TextoCurto = z.string().trim().min(1).max(200);
