/**
 * T-0053 — pré-venda e envio ao ERP pelo Hub (contratos do Vendedor).
 *
 * O retorno do ERP (`integracao.pedido.retorno_erp@1`) é do Hub: o Vendedor o consome em `api/eventos-consumidos.ts`, com a
 * definição do `contracts` da integração (T-0024).
 */
import { z } from 'zod';

/** Corpo de `POST /v1/vendedor/orcamentos/:id/cancelar` (o vendedor desiste do orçamento; motivo opcional). */
export const CancelarOrcamentoRequest = z.object({ motivo: z.string().max(500).optional() }).default({});
export type CancelarOrcamentoRequest = z.infer<typeof CancelarOrcamentoRequest>;
