/**
 * Foto ou avatar do usuário (RN-CORE-42; T-0170; desenho `docs/desenho/inicio-frase-avatar-pedidos.md` §1.2 e §2.2).
 * Tabela `core.usuario_avatar`: uma linha por troca; a viva é a escolha atual. Sem linha viva = iniciais (padrão).
 * Sync `usuario_avatar` (pull com escopo de usuários visíveis; push do próprio usuário, offline). O BKO usa o mesmo corpo em
 * `PUT /v1/core/usuarios/:id/avatar`. A foto segue a ADR 0010 (`plataforma.arquivo`, finalidade `avatar`). Sem evento.
 * A regra da troca (a última vence pelo `alterado_em`) fica no domain (`domain/frase-avatar/avatar.ts`).
 */
import { z } from 'zod';
import { ClienteSyncSchema } from './sync';
/** Os 6 avatares que vêm dentro do app e do BKO: 3 masculinos e 3 femininos. */
export const AVATARES = ['m1', 'm2', 'm3', 'f1', 'f2', 'f3'];
export const TIPOS_AVATAR = ['iniciais', 'avatar', 'foto'];
/** RN-CORE-42: teto da foto do perfil no `PUT /v1/arquivos/:id` (JPEG 480×640, qualidade 80, fica entre 40 e 90 KB). */
export const AVATAR_FOTO_MAX_BYTES = 300 * 1024;
const Campos = z.object({
    id: z.string().uuid(),
    usuario_id: z.string().uuid(),
    tipo: z.enum(TIPOS_AVATAR),
    avatar_codigo: z.enum(AVATARES).nullable(),
    arquivo_id: z.string().uuid().nullable(),
    alterado_em: z.string(),
});
/** RN-CORE-42: `avatar` ⇔ código; `foto` ⇔ arquivo; `iniciais` sem nenhum dos dois. */
function coerente(v, ctx) {
    if ((v.tipo === 'avatar') !== (v.avatar_codigo !== null)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['avatar_codigo'], message: 'Informe o código só quando o tipo for avatar.' });
    }
    if ((v.tipo === 'foto') !== (v.arquivo_id !== null)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['arquivo_id'], message: 'Informe o arquivo só quando o tipo for foto.' });
    }
}
/** Push `usuario_avatar` (comando do aparelho, UUID da troca) e corpo do `PUT /v1/core/usuarios/:id/avatar` do BKO. */
export const UsuarioAvatarPushSchema = Campos.extend({ alterado_em: z.string().datetime() }).strict().superRefine(coerente);
/** Linha do pull `usuario_avatar` (vivas e removidas). */
export const UsuarioAvatarSyncSchema = Campos.extend({
    ...ClienteSyncSchema.pick({ updated_at: true, deleted_at: true, external_id: true }).shape,
    alterado_por: z.string().uuid(),
})
    .strict()
    .superRefine(coerente);
