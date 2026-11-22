/**
 * Consulta que o Catálogo oferece a outros módulos (ADR 0012; desenho T-0029 §3.5): `catalogo.precos_cliente@1`.
 * Preço na tabela do CLIENTE (RN-CAT-06): item fora da tabela dele = sem preço e não vendável, nunca a tabela padrão.
 * O promotor não recebe preço (RN-CAT-05). Mesmo contrato e mesmo resultado na API e no aparelho.
 */
import { z } from 'zod';
import { definirConsulta } from '@macuxi/platform-sdk';
import { Cents, Id } from '@macuxi/core/contracts';
import { EquivaleA, Referencia, TrechoBusca } from './busca';
import { VeiculoEscolhido } from './veiculo';

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
    /** Vazio só quando vem `veiculo` (RN-CAT-22): a lista é a das peças do veículo. */
    q: z.string().trim().max(200).default(''),
    /** RN-CAT-22 (aditivo): só os produtos que servem no veículo (ano, motor e versão só filtram se escolhidos); soma com `q`. */
    veiculo: VeiculoEscolhido.optional(),
    produto_ids: z.array(Id).max(5000).optional(),
    /** T-0167: no lugar dos até 5.000 `produto_ids`, só os vendáveis na tabela de preço deste cliente (RN-CAT-06), filtrados dentro da consulta. */
    cliente_id: Id.optional(),
    limite: z.number().int().min(1).max(200).default(100),
    /** T-0167: devolve a lista ranqueada inteira (até o teto de 400, ignorando `limite`) para o app paginar de 20 em 20 sem nova consulta. */
    lista_completa: z.boolean().optional(),
  })
  .strict()
  .refine((e) => e.q.length >= 1 || e.veiculo !== undefined, { message: 'Informe o texto da busca ou o veículo.', path: ['q'] });
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
      /** T-0167: Aplicação (descrição 2) do item, na mesma consulta; ausente = consulta antiga (use `textos_produto@1`). */
      aplicacao: z.string().nullable().optional(),
    }),
  ),
  /** T-0167: quantos produtos casaram (até o teto de 400), ainda que `itens` traga só `limite`. */
  total: z.number().int().min(0).max(400).optional(),
  /** T-0167: "Você quis dizer…": termo mais próximo do vocabulário do índice, só quando nada casou. */
  sugestao: z.string().nullable().optional(),
});
export type BuscaProdutosSaida = z.infer<typeof BuscaProdutosSaidaSchema>;

export const CONSULTA_BUSCA_PRODUTOS = definirConsulta({
  nome: 'catalogo.busca_produtos@1',
  entrada: BuscaProdutosEntradaSchema,
  saida: BuscaProdutosSaidaSchema,
});

/**
 * `catalogo.foto_produto@1` (T-0148): o Vendedor mostra o ícone de câmera na busca do Novo pedido só nos produtos que têm foto
 * e abre a foto SÓ ao tocar. Dois usos, a mesma consulta:
 * - `abrir: false` (padrão): só diz quem tem foto (`tem_foto`); lê o `produto_conteudo` local, nunca toca a rede; `uri` vem nulo.
 * - `abrir: true` (ao tocar): baixa sob demanda pelo resolvedor do shell, guarda no cache do aparelho e devolve `uri`
 *   (`file://`, abre offline nas próximas vezes). Sem sinal e sem cache, ou falha no download, `uri` é nulo e `tem_foto` segue
 *   verdadeiro (a tela mostra "Sem sinal para baixar a foto. Tente de novo com internet.").
 * A foto é a principal do produto (miniatura de até 320 px e 30 KB); descrição e demais dados o Vendedor já tem.
 * Na API só responde `tem_foto` (quem baixa é o aparelho). Perfil promotor recebe normalmente (RN-CAT-05 só esconde preço e estoque).
 */
export const FotoProdutoEntradaSchema = z.object({ produto_ids: z.array(Id).min(1).max(200), abrir: z.boolean().default(false) }).strict();
export type FotoProdutoEntrada = z.infer<typeof FotoProdutoEntradaSchema>;

export const FotoProdutoSaidaSchema = z.object({
  itens: z.array(z.object({ produto_id: Id, tem_foto: z.boolean(), uri: z.string().nullable() })),
});
export type FotoProdutoSaida = z.infer<typeof FotoProdutoSaidaSchema>;

export const CONSULTA_FOTO_PRODUTO = definirConsulta({
  nome: 'catalogo.foto_produto@1',
  entrada: FotoProdutoEntradaSchema,
  saida: FotoProdutoSaidaSchema,
});

/**
 * `catalogo.estoque_filial@1` (T-0149; RN-VEN-20, RN-CORE-39): saldo do produto na FILIAL, na unidade base, para a API do
 * Vendedor reservar e recusar o pedido sem estoque. Uso interno da API: sem filtro de perfil (RN-CAT-05 vale para as telas).
 * Regra única em `estoque-filial.ts` (RD-0126): tenant sem depósito ligado a filial, ou `filial_id` ausente, soma todos os
 * depósitos; com filiais, só os da filial (filial sem depósito = 0; saldo só em outra filial = 0). Produto sem nenhuma linha
 * de saldo no tenant não aparece na saída = estoque não controlado.
 */
export const EstoqueFilialEntradaSchema = z.object({ produto_ids: z.array(Id).min(1).max(200), filial_id: Id.nullable().optional() }).strict();
export type EstoqueFilialEntrada = z.infer<typeof EstoqueFilialEntradaSchema>;

export const EstoqueFilialSaidaSchema = z.object({
  itens: z.array(z.object({ produto_id: Id, quantidade_base: z.number().nonnegative() })),
});
export type EstoqueFilialSaida = z.infer<typeof EstoqueFilialSaidaSchema>;

export const CONSULTA_ESTOQUE_FILIAL = definirConsulta({
  nome: 'catalogo.estoque_filial@1',
  entrada: EstoqueFilialEntradaSchema,
  saida: EstoqueFilialSaidaSchema,
});
