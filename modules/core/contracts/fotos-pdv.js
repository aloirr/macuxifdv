/**
 * Fotos do PDV (RN-CORE-38; RF-CORE-15; T-0147; ADR 0041). Tipos de foto do tenant (cadastro do admin no BKO: Fachada, CNH do sócio,
 * Contrato social...) e a foto vigente de cada tipo de cada cliente. Os bytes seguem a ADR 0010 (fila de arquivos, JPEG, bucket
 * privado); este contrato só leva os metadados. Tipo sensível: o `arquivo_id` NUNCA chega ao aparelho do vendedor (vem nulo no pull).
 * Rotas BKO: `/v1/core/fotos-tipos` e `GET /v1/core/clientes/:id/fotos`. Sync: `foto_tipo` e `cliente_foto` (sync.ts).
 */
import { z } from 'zod';
const Id = z.string().uuid();
/** Códigos de erro 422 dos tipos de foto (a API devolve `ErroRegraNegocio`). */
export const ERROS_FOTO_PDV = {
    tipoInvalido: 'FOTO_TIPO_INVALIDO',
    tipoDuplicado: 'FOTO_TIPO_DUPLICADO',
    tipoFachada: 'FOTO_TIPO_FACHADA',
    tipoNaoEncontrado: 'FOTO_TIPO_NAO_ENCONTRADO',
    /** Regra do envio (RN-CORE-38): "Esta foto já foi enviada." */
    regra: 'RN-CORE-38',
};
export const FotoTipoSchema = z.object({
    id: Id,
    nome: z.string(),
    obrigatorio: z.boolean(),
    sensivel: z.boolean(),
    fachada: z.boolean(),
    ordem: z.number().int(),
    ativo: z.boolean(),
});
export const FotoTiposListaSchema = z.object({ itens: z.array(FotoTipoSchema) });
/** Criar: o `id` (UUID) nasce no cliente; repetir o mesmo `id` devolve o tipo já criado (escrita idempotente). Só o admin. */
export const FotoTipoCriarSchema = z.object({
    id: Id,
    nome: z.string().max(200),
    obrigatorio: z.boolean().default(false),
    sensivel: z.boolean().default(false),
});
export const FotoTipoEditarSchema = z
    .object({
    nome: z.string().max(200).optional(),
    obrigatorio: z.boolean().optional(),
    sensivel: z.boolean().optional(),
    ativo: z.boolean().optional(),
    ordem: z.number().int().min(0).max(10_000).optional(),
})
    .refine((v) => Object.keys(v).length > 0, { message: 'Informe ao menos um campo do tipo de foto.' });
export const FotoTipoIdParamSchema = z.object({ id: Id });
/** Linha do pull `foto_tipo` (escopo tenant). */
export const FotoTipoSyncSchema = z
    .object({
    id: Id,
    updated_at: z.string(),
    deleted_at: z.string().nullable(),
    external_id: z.string().nullable(),
    nome: z.string(),
    obrigatorio: z.boolean(),
    sensivel: z.boolean(),
    fachada: z.boolean(),
    ordem: z.number().int(),
    ativo: z.boolean(),
})
    .strict();
export const FOTO_ORIGENS = ['camera', 'galeria'];
/** Linha do pull `cliente_foto` (escopo carteira). `arquivo_id` nulo quando o tipo é sensível (o vendedor só sabe que existe). */
export const ClienteFotoSyncSchema = z
    .object({
    id: Id,
    updated_at: z.string(),
    deleted_at: z.string().nullable(),
    external_id: z.string().nullable(),
    cliente_id: Id,
    foto_tipo_id: Id,
    arquivo_id: Id.nullable(),
    origem: z.enum(FOTO_ORIGENS),
    tirada_em: z.string().nullable(),
})
    .strict();
/** Comando de envio do aparelho (push `cliente_foto`): o `id` e o `arquivo_id` nascem no aparelho; o arquivo sobe pela fila de arquivos. */
export const ClienteFotoPushSchema = z
    .object({
    id: Id,
    cliente_id: Id,
    foto_tipo_id: Id,
    arquivo_id: Id,
    origem: z.enum(FOTO_ORIGENS),
    tirada_em: z.string(),
})
    .strict();
/** `GET /v1/core/clientes/:id/fotos`: resumo tem/falta por tipo ativo; `arquivo_id` só nos tipos que o perfil pode abrir. */
export const ResumoFotosClienteSchema = z.object({
    itens: z.array(z.object({
        tipo_id: Id,
        nome: z.string(),
        obrigatorio: z.boolean(),
        sensivel: z.boolean(),
        fachada: z.boolean(),
        situacao: z.enum(['tem', 'falta']),
        arquivo_id: Id.nullable(),
    })),
    faltam_obrigatorias: z.number().int().nonnegative(),
});
