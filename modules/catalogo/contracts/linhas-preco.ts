/**
 * Forma das linhas de sync de preço do Catálogo (`tabela_preco_item` e promoção). Contrato do módulo; o domínio
 * (`../domain/preco.ts`) importa os tipos daqui (regra 3: tipos só de `contracts`).
 */
import { z } from 'zod';
import { Cents, Id } from '@macuxi/core/contracts';

/** Linha de `tabela_preco_item`. `price_table_id` nulo = tabela padrão do tenant. */
export const ItemTabelaPreco = z.object({
  price_table_id: Id.nullable(),
  product_id: Id,
  price_cents: Cents,
  /** Início da vigência (inclusivo), ISO UTC; nulo = desde sempre. */
  valid_from: z.string().datetime().nullable().optional(),
  /** Fim da vigência (exclusivo), ISO UTC; nulo = sem fim. */
  valid_to: z.string().datetime().nullable().optional(),
  /** Preço próprio da embalagem (RN-VEN-15): 'CX' etc.; nulo/ausente = unidade base. */
  unit: z.string().nullable().optional(),
  /** Filial do item (T-0149, RN-CORE-39). Ausente = chamador sem filial. */
  filial_id: Id.optional(),
});
export type ItemTabelaPreco = z.infer<typeof ItemTabelaPreco>;

export const Promocao = z.object({
  id: Id,
  product_id: Id,
  /** Tabela a que a promoção se aplica; nulo = qualquer tabela (inclusive a padrão). */
  price_table_id: Id.nullable(),
  tipo: z.enum(['preco_fixo', 'desconto_pct']),
  /** `preco_fixo`: centavos; `desconto_pct`: percentual (até 2 casas). */
  valor: z.number().nonnegative(),
  /** Início (inclusivo) e fim (exclusivo), ISO UTC. */
  valid_from: z.string().datetime(),
  valid_to: z.string().datetime(),
});
export type Promocao = z.infer<typeof Promocao>;
