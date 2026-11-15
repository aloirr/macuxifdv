/**
 * Bloqueio de aparelho (RN-CORE-15): vale para o TENANT inteiro. Aparelho bloqueado (perda, roubo, desligamento)
 * não autentica nenhum usuário do tenant. Bloqueio e desbloqueio no BKO por admin ou analista, com auditoria.
 */
import { z } from 'zod';
export const DispositivoItemSchema = z
    .object({
    id: z.string().uuid(),
    usuario_id: z.string().uuid(),
    usuario_nome: z.string(),
    nome: z.string().nullable(),
    plataforma: z.string().nullable(),
    ultimo_acesso_em: z.string().datetime().nullable(),
    bloqueado_em: z.string().datetime().nullable(),
})
    .strict();
export const DispositivoListaQuerySchema = z.object({ bloqueado: z.enum(['true', 'false']).optional(), q: z.string().trim().max(80).optional() });
export const BloquearDispositivoRequestSchema = z.object({ motivo: z.string().trim().max(200).optional() }).strict();
/** 423 — o app (refresh/login) recebe este código e limpa o aparelho (RN-CORE-15). */
export const CODIGO_DISPOSITIVO_BLOQUEADO = 'DISPOSITIVO_BLOQUEADO';
export const MENSAGEM_APARELHO_BLOQUEADO = 'Este aparelho foi bloqueado pela sua empresa. Os dados deste aparelho foram apagados. Fale com o administrador para liberar o acesso.';
export const AVISO_APARELHO_LIMPO = 'Este aparelho foi bloqueado pela sua empresa. Apagamos os dados guardados nele, inclusive o que ainda não tinha sido enviado. Fale com o administrador para liberar.';
