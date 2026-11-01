/**
 * Consulta que o Catálogo oferece a outros módulos (ADR 0012; desenho T-0029 §3.5): `catalogo.precos_cliente@1`.
 * Preço na tabela do CLIENTE (RN-CAT-06): item fora da tabela dele = sem preço e não vendável, nunca a tabela padrão.
 * O promotor não recebe preço (RN-CAT-05). Mesmo contrato e mesmo resultado na API e no aparelho.
 */
import { z } from 'zod';
import { definirConsulta } from '@macuxi/platform-sdk';
import { Cents, Id } from '@macuxi/core/contracts';

export const PrecosClienteEntradaSchema = z.object({
  cliente_id: Id,
  /** Até 500 produtos por chamada. */
  produto_ids: z.array(Id).max(500),
  /** Data do preço (ISO UTC). A consulta limita a 7 dias para trás e nunca no futuro (P-4). */
  em: z.string().datetime(),
});
export type PrecosClienteEntrada = z.infer<typeof PrecosClienteEntradaSchema>;

export const PrecoClienteItemSchema = z.object({
  produto_id: Id,
  /** Nulo = sem preço (não vendável) ou perfil sem direito a ver preço. */
  preco_cents: Cents.nullable(),
  /** Texto para o usuário quando `preco_cents` é nulo. */
  motivo_sem_preco: z.string().nullable(),
});
export type PrecoClienteItem = z.infer<typeof PrecoClienteItemSchema>;

export const PrecosClienteSaidaSchema = z.object({
  /** Tabela do cliente usada; nula se o cliente não tem tabela ativa ou o perfil não vê preço. */
  tabela_preco_id: Id.nullable(),
  /** Mesma ordem de `produto_ids` (sem repetidos). */
  itens: z.array(PrecoClienteItemSchema),
});
export type PrecosClienteSaida = z.infer<typeof PrecosClienteSaidaSchema>;

export const CONSULTA_PRECOS_CLIENTE = definirConsulta({
  nome: 'catalogo.precos_cliente@1',
  entrada: PrecosClienteEntradaSchema,
  saida: PrecosClienteSaidaSchema,
});

/** Quanto a data do preço pode recuar em relação a agora (P-4). */
export const DIAS_RETROATIVO_PRECO = 7;
