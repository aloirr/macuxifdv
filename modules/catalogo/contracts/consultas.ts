/**
 * Consulta que o Catálogo oferece a outros módulos (ADR 0012; desenho T-0029 §3.5): `catalogo.precos_cliente@1`.
 * Preço na tabela do CLIENTE (RN-CAT-06): item fora da tabela dele = sem preço e não vendável, nunca a tabela padrão.
 * O promotor não recebe preço (RN-CAT-05). Mesmo contrato e mesmo resultado na API e no aparelho.
 */
import { z } from 'zod';
import { definirConsulta } from '@macuxi/platform-sdk';
import { Cents, Id } from '@macuxi/core/contracts';
import { EquivaleA, Referencia, TrechoBusca } from './busca';

export const PrecosClienteEntradaSchema = z.object({
  cliente_id: Id,
  /** Até 500 produtos por chamada. */
  produto_ids: z.array(Id).max(500),
  /** Data do preço (ISO UTC). A consulta limita a 7 dias para trás e nunca no futuro (P-4). */
  em: z.string().datetime(),
});
export type PrecosClienteEntrada = z.infer<typeof PrecosClienteEntradaSchema>;

export const FaixaEscalonadaSchema = z.object({
  medida: z.string().nullable(),
  quantidade_minima: z.number().int().positive(),
  preco_unidade_cents: Cents,
});
export type FaixaEscalonada = z.infer<typeof FaixaEscalonadaSchema>;

export const PrecoClienteItemSchema = z.object({
  produto_id: Id,
  /** Nulo = sem preço (não vendável) ou perfil sem direito a ver preço. */
  preco_cents: Cents.nullable(),
  /** Texto para o usuário quando `preco_cents` é nulo. */
  motivo_sem_preco: z.string().nullable(),
  /**
   * Preço próprio por medida (RN-VEN-15 ANTIGA). Fica no schema, opcional, só para o consumidor antigo ler; desde a T-0089
   * o Catálogo NÃO o preenche mais: a embalagem é sempre unidade base × quantidade da embalagem (RN-VEN-15 nova).
   */
  embalagens: z.array(z.object({ unidade: z.string(), preco_cents: Cents })).optional(),
  /**
   * Tabela escalonada (RN-VEN-23; T-0089, aditivo na mesma versão): só as faixas vigentes em `em` (data civil no fuso do
   * tenant, fechada nas duas pontas), da tabela do cliente ou gerais; na mesma (medida, quantidade_minima) a da tabela do
   * cliente vence a geral. `medida` nula = unidade base; `preco_unidade_cents` é sempre o da UNIDADE BASE (o da medida é
   * × a quantidade da embalagem). Ordenadas por medida (base primeiro) e quantidade mínima. Ausente quando o preço não é
   * visível (RN-CAT-05), o item não tem preço (RN-CAT-06) ou não há faixa vigente. Quem aplica é o Vendedor (faixa mais
   * cara que a tabela não sobe o preço, P4).
   */
  faixas: z.array(FaixaEscalonadaSchema).optional(),
});
export type PrecoClienteItem = z.infer<typeof PrecoClienteItemSchema>;

export const PrecosClienteSaidaSchema = z.object({
  /** Tabela do cliente usada; nula se o cliente não tem tabela ativa ou o perfil não vê preço. */
  tabela_preco_id: Id.nullable(),
  /** Nome da tabela usada (aditivo, T-0061: o PDF interno e o detalhe do BKO mostram o nome, não o id). */
  tabela_preco_nome: z.string().nullable().optional(),
  /**
   * Filial dos preços (aditivo, T-0149, RN-CORE-39): a do cliente, ou a padrão quando a tabela do cliente não tem item nenhum
   * na filial dele (`filial_origem: 'padrao'`, fallback por tabela, nunca por item). Ausente quando não há tabela ou preço visível.
   */
  filial_id: Id.nullable().optional(),
  filial_origem: z.enum(['cliente', 'padrao']).optional(),
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

/**
 * `catalogo.textos_produto@1` (T-0084 C8, T-0085 K13): aplicação e referências cruzadas por produto, para o Vendedor
 * montar a lista, o item, o retrato e os PDFs. Perfil promotor recebe normalmente (RN-CAT-05 só esconde preço e estoque).
 * Referência de marca inativa fica de fora.
 */
export const TextosProdutoEntradaSchema = z.object({ produto_ids: z.array(Id).min(1).max(500) }).strict();
export type TextosProdutoEntrada = z.infer<typeof TextosProdutoEntradaSchema>;

export const TextosProdutoSaidaSchema = z.object({
  itens: z.array(z.object({ produto_id: Id, aplicacao: z.string().nullable(), referencias: z.array(Referencia).max(3) })),
});
export type TextosProdutoSaida = z.infer<typeof TextosProdutoSaidaSchema>;

export const CONSULTA_TEXTOS_PRODUTO = definirConsulta({
  nome: 'catalogo.textos_produto@1',
  entrada: TextosProdutoEntradaSchema,
  saida: TextosProdutoSaidaSchema,
});

/**
 * `catalogo.busca_produtos@1` (T-0084 C9): a busca do seletor do Novo pedido passa a ser a do Catálogo (mesmo ranking,
 * sinônimos e faixa de anos). `produto_ids` restringe aos produtos do seletor. Sem preço: o preço segue em `precos_cliente@1`.
 */
export const BuscaProdutosEntradaSchema = z
  .object({
    q: z.string().trim().min(1).max(200),
    produto_ids: z.array(Id).max(5000).optional(),
    limite: z.number().int().min(1).max(200).default(100),
  })
  .strict();
export type BuscaProdutosEntrada = z.infer<typeof BuscaProdutosEntradaSchema>;

export const BuscaProdutosSaidaSchema = z.object({
  /** Na ordem do ranking. */
  itens: z.array(
    z.object({
      produto_id: Id,
      nota: z.number(),
      so_aplicacao: z.boolean(),
      serve_em: TrechoBusca.nullable(),
      equivale_a: EquivaleA.nullable(),
    }),
  ),
});
export type BuscaProdutosSaida = z.infer<typeof BuscaProdutosSaidaSchema>;

export const CONSULTA_BUSCA_PRODUTOS = definirConsulta({
  nome: 'catalogo.busca_produtos@1',
  entrada: BuscaProdutosEntradaSchema,
  saida: BuscaProdutosSaidaSchema,
});
