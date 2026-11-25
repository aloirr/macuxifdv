/**
 * `POST /v1/integracao/conector/download` (T-0098, ADR 0037): link temporário do instalador do Conector, para o portal.
 * Corpo vazio. Os campos são os de `LinkPacote` do SDK, sem `publicado_em`. A `url` é segredo de curta duração: nunca em log.
 */
import { z } from 'zod';
/** 404 quando nenhum instalador foi publicado. */
export const CODIGO_CONECTOR_SEM_PACOTE = 'CONECTOR_SEM_PACOTE';
export const LinkDownloadConectorSchema = z
    .object({
    url: z.string().url(),
    expira_em: z.string().datetime(),
    versao: z.string(),
    arquivo: z.string(),
    tamanho_bytes: z.number().int().positive().optional(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
})
    .strip();
