/** Carteira N:N (cliente × usuário × papel) e lista de clientes (desenho T-0016 §3.1). */
import { z } from 'zod';
import { CodigoFdvClienteSchema } from './cliente-pre-cadastro';
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
    /** v1.0.30 (ADR 0069 item 10, aditivos): os dois códigos do cliente, Código FDV e Código ERP (`external_id`, nulo antes do vínculo). */
    codigo_fdv: CodigoFdvClienteSchema.nullish(),
    external_id: z.string().nullish(),
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
/**
 * Item de `GET /v1/core/usuarios/:id/clientes` (BKO: Carteira do usuário e "adicionar da carteira" do editor de rota): só os vínculos
 * vigentes. Sem `.strict()`: a rota é anterior ao contrato e os campos novos entram sem quebrar quem lê.
 */
export const CarteiraDoUsuarioItemSchema = z.object({
    id: z.string().uuid(),
    nome: z.string(),
    razao_social: z.string(),
    /** Código ERP; nulo antes do vínculo com o ERP. */
    external_id: z.string().nullish(),
    /** v1.0.30 (ADR 0069 item 10, aditivo): Código FDV do cliente. */
    codigo_fdv: CodigoFdvClienteSchema.nullish(),
    documento: z.string().nullish(),
    cidade: z.string().nullable(),
    bairro: z.string().nullable(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    ultima_compra_em: Data.nullable(),
    carteira_id: z.string().uuid().optional(),
    papel: z.enum(['vendedor', 'promotor']).optional(),
    frequencia_semanas: z.number().int().nullable(),
    dia_semana: z.number().int().nullable(),
    /** RN-CORE-16: cliente sem os campos mínimos do tenant (pedido só como orçamento). */
    cadastro_incompleto: z.boolean().optional(),
});
export const CarteiraDoUsuarioRespostaSchema = z.object({ itens: z.array(CarteiraDoUsuarioItemSchema) });
