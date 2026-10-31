/**
 * Pedido em nome do vendedor (RF-GES-05, RN-VEN-35). O MOTOR é do Vendedor: o Gestor só usa a extensão
 * `pedido.criar_em_nome` (oferecida pelo Vendedor, ação `pedido.criar_em_nome` para supervisor e gerente) e passa o
 * contexto abaixo. `vendedor_id` = vendedor (a venda conta para ele, RN-CORE-21); `autor_id` = gestor.
 * Vendedor inativo ⇒ `visivel = false`: a função some, sem erro (RN-CORE-03).
 */
import { z } from 'zod';
import { Uuid } from './base';

export const ContextoPedidoEmNome = z
  .object({
    vendedor_id: Uuid,
    autor_id: Uuid,
    cliente_id: Uuid,
    visita_id: Uuid.nullable().default(null),
  })
  .strict();
export type ContextoPedidoEmNome = z.infer<typeof ContextoPedidoEmNome>;

export const CODIGOS_NEGACAO_EM_NOME = ['MODULO_VENDEDOR_INATIVO', 'PERFIL_SEM_ACESSO', 'FORA_DO_ESCOPO', 'VENDEDOR_INVALIDO'] as const;
export const CodigoNegacaoEmNome = z.enum(CODIGOS_NEGACAO_EM_NOME);
export type CodigoNegacaoEmNome = z.infer<typeof CodigoNegacaoEmNome>;

export const DisponibilidadeEmNome = z
  .object({
    /** `false` = a ação nem aparece (módulo Vendedor inativo ou perfil sem a ação). */
    visivel: z.boolean(),
    permitido: z.boolean(),
    codigo: CodigoNegacaoEmNome.nullable(),
    mensagem: z.string().nullable(),
  })
  .strict();
export type DisponibilidadeEmNome = z.infer<typeof DisponibilidadeEmNome>;
