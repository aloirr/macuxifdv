/**
 * Tipos básicos dos contratos da Pesquisa: ids são UUID gerados no aparelho (escrita idempotente),
 * instantes são ISO 8601 em UTC (`...Z`) e datas civis são `AAAA-MM-DD` (exibição no fuso do tenant).
 */
import { z } from 'zod';
export const Uuid = z.string().uuid();
/** Instante em UTC com `Z` (recusa deslocamento tipo `-04:00`). */
export const InstanteUtc = z.string().datetime();
/** Data civil `AAAA-MM-DD` que existe no calendário (recusa 2026-02-30). */
export const DataCivil = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data no formato AAAA-MM-DD.')
    .refine((s) => {
    const d = new Date(`${s}T12:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, 'Essa data não existe no calendário.');
export const Pct0a100 = z.number().min(0).max(100);
export const TextoCurto = z.string().trim().min(1).max(200);
/** Perfis que respondem pesquisa (doc 03 §2: vendedor, promotor e supervisor/gerente). */
export const PERFIS_QUE_RESPONDEM = ['vendedor', 'promotor', 'supervisor', 'gerente'];
export const PerfilQueResponde = z.enum(PERFIS_QUE_RESPONDEM);
