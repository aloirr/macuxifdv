/**
 * Formas de pagamento e prazos (T-0089; RN-VEN-24): consulta `vendedor.formas_pagamento@1` (só na API, para a ficha do cliente
 * do BKO do Core, ADR 0019) e os comandos do BKO de Parâmetros → Formas de pagamento e prazos.
 */
import { z } from 'zod';
import { definirConsulta } from '@macuxi/platform-sdk';
import { Id, IsoDateTime } from '@macuxi/core/contracts';

export const FormasPagamentoEntradaSchema = z.object({}).strict();
export const FormasPagamentoSaidaSchema = z.object({
  formas: z.array(z.object({ codigo: z.string(), nome: z.string(), ativo: z.boolean() })).max(200),
});
export type FormasPagamentoSaida = z.infer<typeof FormasPagamentoSaidaSchema>;
export const CONSULTA_FORMAS_PAGAMENTO = definirConsulta({
  nome: 'vendedor.formas_pagamento@1',
  entrada: FormasPagamentoEntradaSchema,
  saida: FormasPagamentoSaidaSchema,
});

const Codigo = z.string().trim().min(1).max(20);
const parcelasSemDecrescer = (p: number[]): boolean => p.every((v, i) => i === 0 || v >= p[i - 1]!);

/** Forma de pagamento para o BKO. */
export const FormaPagamento = z.object({
  id: Id,
  codigo: Codigo,
  nome: z.string().trim().min(1).max(60),
  ativo: z.boolean(),
  ordem: z.number().int(),
  external_id: z.string().nullable(),
  updated_at: IsoDateTime,
});
export type FormaPagamento = z.infer<typeof FormaPagamento>;

export const PrazoPagamento = z.object({
  id: Id,
  forma_pagamento_id: Id,
  codigo: Codigo,
  descricao: z.string().min(1).max(60),
  parcelas_dias: z.array(z.number().int().min(0).max(365)).min(1).max(24),
  prazo_medio_dias: z.number().int().min(0).max(365),
  ativo: z.boolean(),
  ordem: z.number().int(),
  external_id: z.string().nullable(),
  updated_at: IsoDateTime,
});
export type PrazoPagamento = z.infer<typeof PrazoPagamento>;

export const FormasEPrazosResposta = z.object({ formas: z.array(FormaPagamento), prazos: z.array(PrazoPagamento) });
export type FormasEPrazosResposta = z.infer<typeof FormasEPrazosResposta>;

/** `id` vem do BKO (UUID gerado no cliente, regra 4): a escrita é idempotente. */
export const SalvarFormaRequest = z.object({
  id: Id,
  codigo: Codigo,
  nome: z.string().trim().min(1, 'Informe o nome da forma.').max(60),
  ativo: z.boolean().default(true),
  ordem: z.number().int().min(0).max(9999).default(0),
});
export type SalvarFormaRequest = z.infer<typeof SalvarFormaRequest>;

/** O prazo médio e a descrição são calculados no servidor (`prazoMedioDias`, `descricaoPrazo`); a descrição digitada é opcional. */
export const SalvarPrazoRequest = z.object({
  id: Id,
  forma_pagamento_id: Id,
  codigo: Codigo,
  descricao: z.string().trim().min(1).max(60).optional(),
  parcelas_dias: z
    .array(z.number().int().min(0, 'Os dias vão de 0 a 365.').max(365, 'Os dias vão de 0 a 365.'))
    .min(1, 'Informe ao menos uma parcela.')
    .max(24)
    .refine(parcelasSemDecrescer, 'Os dias das parcelas não podem diminuir.'),
  ativo: z.boolean().default(true),
  ordem: z.number().int().min(0).max(9999).default(0),
});
export type SalvarPrazoRequest = z.infer<typeof SalvarPrazoRequest>;
