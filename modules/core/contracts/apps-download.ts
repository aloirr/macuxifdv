/**
 * `POST /v1/core/apps/download` (T-0190, RN-CORE-67, ADR 0065): link temporário do último APK do Macuxi Campo ou do Macuxi Gestão,
 * para o portal. A `url` é segredo de curta duração (até 15 min): nunca em log nem em auditoria.
 */
import { LinkPacoteSchema, VARIANTES_APP } from '@macuxi/platform-sdk';
import { z } from 'zod';

/** 404 quando nenhum APK da variante foi publicado. */
export const CODIGO_APP_SEM_PACOTE = 'APP_SEM_PACOTE';
/** 403 quando o tenant não tem módulo que use o app (RN-CORE-67). */
export const CODIGO_APP_SEM_LICENCA = 'APP_SEM_LICENCA';

export const LinkDownloadAppRequestSchema = z.object({ variante: z.enum(VARIANTES_APP) }).strict();
export type LinkDownloadAppRequest = z.infer<typeof LinkDownloadAppRequestSchema>;

export const LinkDownloadAppSchema = LinkPacoteSchema.extend({ variante: z.enum(VARIANTES_APP) }).strip();
export type LinkDownloadApp = z.infer<typeof LinkDownloadAppSchema>;
