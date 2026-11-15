/**
 * Linhas do pull de preço do Catálogo (T-0029; docs/banco/catalogo.md): `tabela_preco`, `tabela_preco_item` e
 * `cliente_tabela_preco`. Colunas do banco em snake_case, dinheiro em centavos, instantes ISO UTC com microssegundos,
 * `deleted_at` preenchido quando removida.
 */
import { z } from 'zod';
const Base = {
    id: z.string().uuid(),
    updated_at: z.string(),
    deleted_at: z.string().nullable(),
    external_id: z.string().nullable(),
};
export const TabelaPrecoSyncSchema = z.object({ ...Base, codigo: z.string(), nome: z.string(), ativo: z.boolean() });
export const TabelaPrecoItemSyncSchema = z.object({
    ...Base,
    tabela_preco_id: z.string().uuid(),
    produto_id: z.string().uuid(),
    preco_cents: z.number().int().positive(),
    vigencia_inicio: z.string().nullable(),
    vigencia_fim: z.string().nullable(),
    /** Preço próprio da embalagem (CX) — fila de corte da T-0061; ausente/null = unidade base. */
    unidade: z.string().nullable().optional(),
    /** Filial do preço (T-0149, RN-CORE-39; aditivo, opcional no aparelho antigo). O pull manda só as filiais da carteira + a padrão. */
    filial_id: z.string().uuid().optional(),
});
/**
 * Faixa de preço por quantidade (RN-VEN-23; T-0089, migração 0037). `preco_unidade_cents` é o preço da UNIDADE BASE (P3);
 * `medida` nula = unidade base; vigência em data civil AAAA-MM-DD do fuso do tenant, fechada nas duas pontas; fim nulo =
 * aberta; `tabela_preco_id` nulo = vale para todas as tabelas. Escopo tenant; quem não vê preço (RN-CAT-05) não a recebe.
 */
export const TabelaEscalonadaSyncSchema = z.object({
    ...Base,
    produto_id: z.string().uuid(),
    medida: z.string().nullable(),
    quantidade_minima: z.number().int().positive(),
    preco_unidade_cents: z.number().int().positive(),
    vigencia_inicio: z.string(),
    vigencia_fim: z.string().nullable(),
    tabela_preco_id: z.string().uuid().nullable(),
    ativo: z.boolean(),
    /** Filial da faixa (T-0149, RN-CORE-39; aditivo); nulo ou ausente = todas as filiais. */
    filial_id: z.string().uuid().nullable().optional(),
});
export const ClienteTabelaPrecoSyncSchema = z.object({ ...Base, cliente_id: z.string().uuid(), tabela_preco_id: z.string().uuid() });
/** Árvore do catálogo do ERP (RF-CAT-04; T-0061 §4.2). pai nulo = raiz (nível 1). Escopo tenant. */
export const CatalogoNoSyncSchema = z.object({
    ...Base,
    pai_id: z.string().uuid().nullable(),
    nivel: z.number().int().min(1).max(8),
    codigo: z.string(),
    nome: z.string(),
    ordem: z.number().int(),
    ativo: z.boolean(),
});
export const ProdutoNoSyncSchema = z.object({ ...Base, produto_id: z.string().uuid(), no_id: z.string().uuid() });
/**
 * Relação entre produtos (RF-CAT-03; desenho T-0071 §4.2/§5): complementar ("combina com"), superior ("leve mais") e
 * substituto (ficha e ruptura). Escopo tenant. `produto_id`/`relacionado_id` sem FK no banco (outro schema).
 */
export const TIPOS_RELACAO_PRODUTO = ['complementar', 'superior', 'substituto'];
export const ProdutoRelacaoSyncSchema = z.object({
    ...Base,
    produto_id: z.string().uuid(),
    relacionado_id: z.string().uuid(),
    tipo: z.enum(TIPOS_RELACAO_PRODUTO),
    ordem: z.number().int(),
    ativo: z.boolean(),
});
