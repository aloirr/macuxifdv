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
  /**
   * Preço próprio por medida (`tabela_preco_item.unidade` não nula, vigente em `em`; RN-VEN-15). Aditivo na mesma versão:
   * o consumidor antigo ignora. Ausente = a embalagem vale UN × fator.
   */
  embalagens: z.array(z.object({ unidade: z.string(), preco_cents: Cents })).optional(),
});
export type PrecoClienteItem = z.infer<typeof PrecoClienteItemSchema>;

export const PrecosClienteSaidaSchema = z.object({
  /** Tabela do cliente usada; nula se o cliente não tem tabela ativa ou o perfil não vê preço. */
  tabela_preco_id: Id.nullable(),
  /** Nome da tabela usada (aditivo, T-0061: o PDF interno e o detalhe do BKO mostram o nome, não o id). */
  tabela_preco_nome: z.string().nullable().optional(),
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

/**
 * `catalogo.sugestoes_pedido@1` (T-0071 §4.2; RF-CAT-03): complementares ("combina com o pedido") e superiores ("leve
 * mais") dos produtos do pedido, só da tabela do cliente e com estoque. Perfil sem preço (RN-CAT-05): saída vazia.
 */
export const SugestoesPedidoEntradaSchema = z
  .object({
    cliente_id: Id,
    /** Produtos já no pedido, na ordem das linhas. */
    produto_ids: z.array(Id).min(1).max(200),
    /** Data do preço (ISO UTC; P-4, como em `precos_cliente@1`). */
    em: z.string().datetime(),
    limite: z.number().int().min(1).max(5).default(5),
  })
  .strict();
export type SugestoesPedidoEntrada = z.infer<typeof SugestoesPedidoEntradaSchema>;

export const SugestaoProdutoSchema = z.object({
  produto_id: Id,
  tipo: z.enum(['complementar', 'superior']),
  /** Item do pedido que gerou a sugestão. */
  origem_produto_id: Id,
  /** Tabela do cliente, unidade base. */
  preco_cents: Cents,
});
export type SugestaoProduto = z.infer<typeof SugestaoProdutoSchema>;

export const SugestoesPedidoSaidaSchema = z.object({
  complementares: z.array(SugestaoProdutoSchema).max(5),
  superiores: z.array(SugestaoProdutoSchema).max(5),
});
export type SugestoesPedidoSaida = z.infer<typeof SugestoesPedidoSaidaSchema>;

export const CONSULTA_SUGESTOES_PEDIDO = definirConsulta({
  nome: 'catalogo.sugestoes_pedido@1',
  entrada: SugestoesPedidoEntradaSchema,
  saida: SugestoesPedidoSaidaSchema,
});
