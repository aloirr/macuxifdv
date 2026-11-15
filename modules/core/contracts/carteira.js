/** Carteira N:N (cliente × usuário × papel) e lista de clientes (desenho T-0016 §3.1). */
import { z } from 'zod';
const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const CarteiraItemPutSchema = z
    .object({
    cliente_id: z.string().uuid(),
    usuario_id: z.string().uuid(),
    papel: z.enum(['vendedor', 'promotor']),
    inicio: Data.nullable().optional(),
    fim: Data.nullable().optional(),
    frequencia_semanas: z.union([z.literal(1), z.literal(2), z.literal(4)]).nullable().optional(),
    dia_semana: z.number().int().min(1).max(7).nullable().optional(),
})
    .strict()
    .refine((v) => !v.inicio || !v.fim || v.fim >= v.inicio, { message: 'O fim da vigência não pode ser antes do início.', path: ['fim'] });
export const ClienteListaQuerySchema = z.object({
    q: z.string().optional(),
    cidade: z.string().optional(),
    segmento: z.string().optional(),
    bloqueado: z.enum(['true', 'false']).optional(),
    com_vencidos: z.enum(['true', 'false']).optional(),
    limite: z.coerce.number().int().min(1).max(500).optional(),
    cursor: z.string().optional(),
});
/** Item da lista de clientes online (BKO e Gestão). O app lê a lista local (entidade `cliente`). */
export const ClienteListaItemSchema = z
    .object({
    id: z.string().uuid(),
    documento: z.string().nullable(),
    razao_social: z.string(),
    nome_fantasia: z.string().nullable(),
    segmento: z.string().nullable(),
    cidade: z.string().nullable(),
    uf: z.string().nullable(),
    ativo: z.boolean(),
    bloqueado: z.boolean(),
    vencidos_qtd: z.number().int(),
})
    .strict();
/** Paginação por deslocamento opaco (`proximo_cursor` = próximo deslocamento; `null` = acabou). */
export const ClienteListaRespostaSchema = z.object({ itens: z.array(ClienteListaItemSchema), proximo_cursor: z.string().nullable() }).strict();
/**
 * Pagamento permitido ao cliente no BKO (T-0089, RN-VEN-25): `PUT /v1/core/clientes/:id/pagamento`. Os dois campos vêm sempre
 * (a tela envia o estado inteiro). `prazo_medio_max_dias` nulo = sem teto; `formas_pagamento` nulo ou vazio = todas as ativas.
 */
export const ClientePagamentoPutSchema = z
    .object({
    prazo_medio_max_dias: z.number().int().min(0).max(365).nullable(),
    formas_pagamento: z.array(z.string().trim().toUpperCase().min(1).max(20)).max(20).nullable(),
})
    .strict();
