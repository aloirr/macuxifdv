/**
 * Consultas síncronas que o Core oferece a outros módulos (ADR 0012). Leitura apenas, em `core.*`.
 * `core.cadastro_resumo@1` (T-0029): o Vendedor valida cliente/produtos/vendedor no push do pedido e guarda o
 * retrato do documento + as chaves do ERP (`external_id`) para o Hub. Id inexistente ou removido fica de fora.
 */
import { definirConsulta } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { LimiteDescontoSchema } from './usuarios';
import { ParametrosAlertasProdutividadeSchema } from './alertas-produtividade';
import { MinutoDoDiaSchema } from './jornada';

const Ids = z.array(z.string().uuid()).max(500).default([]);

/** `endereco_ids` (T-0061 §4.1): opcional, padrão []; o principal de cada cliente pedido vem sempre. */
/** `produto_external_ids` (T-0066): opcional, padrão []; acha o produto pelo external_id do ERP (une-se a `produto_ids`, sem duplicar). */
const ExternalIds = z.array(z.string().min(1).max(200)).max(500).default([]);
/** `cliente_external_ids` (T-0120): opcional, padrão []; acha o cliente pelo external_id do ERP (une-se a `cliente_ids`, sem duplicar). */
export const CadastroResumoEntradaSchema = z.object({ cliente_ids: Ids, cliente_external_ids: ExternalIds, produto_ids: Ids, produto_external_ids: ExternalIds, usuario_ids: Ids, endereco_ids: Ids }).strict();
export type CadastroResumoEntrada = z.infer<typeof CadastroResumoEntradaSchema>;

const Texto = z.string().nullable();
export const CadastroResumoSaidaSchema = z.object({
  clientes: z.array(
    z.object({
      id: z.string().uuid(),
      razao_social: z.string(),
      nome_fantasia: Texto,
      documento: Texto,
      logradouro: Texto,
      numero: Texto,
      bairro: Texto,
      cidade: Texto,
      uf: Texto,
      ativo: z.boolean(),
      external_id: Texto,
      /** Cadastro mínimo (T-0060): opcionais, mesma versão (ADR 0012). Só nomes de campo, nunca valores. */
      inscricao_estadual: Texto.optional(),
      cep: Texto.optional(),
      /** T-0115 / RN-PES-05 (aditivo): canal do cliente (texto do ERP); nulo = sem canal. Ausente = emissor antigo. */
      canal: Texto.optional(),
      /** T-0149 / RN-CORE-39 (aditivo): filial EFETIVA do cliente (nunca nula; sem informação, a padrão). Ausente = emissor antigo. */
      filial_id: z.string().uuid().optional(),
      cadastro_incompleto: z.boolean().optional(),
      cadastro_campos_faltantes: z.array(z.string()).optional(),
      /** T-0073 / RN-VEN-13 (aditivo): cliente bloqueado no financeiro (`cliente_financeiro.bloqueado`); só o Vendedor decide o que fazer (pedido vira orçamento). Ausente = não informado. */
      bloqueado: z.boolean().optional(),
      /** T-0089 / RN-VEN-25 (aditivo): prazo médio máximo (nulo = sem teto) e formas permitidas por código (nulo ou vazio = todas). Ausente = emissor antigo. */
      prazo_medio_max_dias: z.number().int().min(0).nullable().optional(),
      formas_pagamento: z.array(z.string()).nullable().optional(),
    }),
  ),
  produtos: z.array(
    z.object({
      id: z.string().uuid(),
      sku: z.string(),
      nome: z.string(),
      unidade: z.string(),
      ativo: z.boolean(),
      external_id: Texto,
      /** T-0119 (aditivo): marca, categoria e EAN do cadastro; ausente = emissor antigo. O Catálogo os usa nos chips e na busca (RN-CAT-01). */
      marca: Texto.optional(),
      categoria: Texto.optional(),
      ean: Texto.optional(),
      /** T-0071 / RN-VEN-11 (aditivo): preço de venda em centavos; null = não informado (sem preço mínimo). Ausente = emissor antigo. */
      preco_venda_cents: z.number().int().nonnegative().nullable().optional(),
      /** T-0071 / RN-VEN-11 (aditivo): desconto máximo EFETIVO em % (próprio ?? parâmetro core.desconto_maximo_produto_pct do tenant ?? 15). */
      desconto_maximo_pct: z.number().min(0).max(100).optional(),
      unidades: z.array(z.object({ unidade: z.string(), fator: z.number().int().positive(), padrao: z.boolean(), ativo: z.boolean(), external_id: Texto })).optional(),
    }),
  ),
  /** T-0168 / RN-VEN-11a (aditivo, mesma versão): funções e limite de desconto; ausentes = emissor antigo, o consumidor completa com `LIMITE_DESCONTO_PADRAO`. */
  usuarios: z.array(z.object({ id: z.string().uuid(), nome: z.string(), perfil: z.string(), external_id: Texto, ...LimiteDescontoSchema.partial().shape })),
  /** Só os pedidos em `endereco_ids` e, sempre, o principal de cada cliente pedido (T-0061 §4.1). */
  enderecos: z
    .array(
      z.object({
        id: z.string().uuid(),
        cliente_id: z.string().uuid(),
        tipo: z.enum(['principal', 'entrega', 'cobranca']),
        logradouro: z.string(),
        numero: Texto,
        complemento: Texto,
        bairro: Texto,
        cidade: z.string(),
        uf: z.string(),
        cep: Texto,
        principal: z.boolean(),
        ativo: z.boolean(),
        external_id: Texto,
      }),
    )
    .optional(),
});
export type CadastroResumoSaida = z.infer<typeof CadastroResumoSaidaSchema>;

export const CONSULTA_CADASTRO_RESUMO = definirConsulta({ nome: 'core.cadastro_resumo@1', entrada: CadastroResumoEntradaSchema, saida: CadastroResumoSaidaSchema });

/**
 * `core.cadastro_cliente@1` (T-0060, RN-INT-14): o Hub pergunta se os dados de cliente do lote formam um cadastro
 * completo, sem gravar nada. Pura: lê só o parâmetro `cliente.campos_obrigatorios` do tenant. A resposta traz só a
 * chave e os NOMES dos campos faltantes, nunca o dado do cliente.
 */
export const CadastroClienteEntradaSchema = z
  .object({
    clientes: z
      .array(
        z.object({
          chave: z.string().max(200), // o external_id do lote (o Hub casa a resposta)
          razao_social: Texto,
          nome_fantasia: Texto,
          documento: Texto,
          inscricao_estadual: Texto,
          telefone: Texto,
          email: Texto,
          logradouro: Texto,
          numero: Texto,
          complemento: Texto,
          bairro: Texto,
          cidade: Texto,
          uf: Texto,
          cep: Texto,
          latitude: z.number().nullable(),
          longitude: z.number().nullable(),
        }),
      )
      .max(500),
  })
  .strict();
export type CadastroClienteEntrada = z.infer<typeof CadastroClienteEntradaSchema>;
export const CadastroClienteSaidaSchema = z.object({
  resultados: z.array(z.object({ chave: z.string(), completo: z.boolean(), campos_faltantes: z.array(z.string()) })),
});
export type CadastroClienteSaida = z.infer<typeof CadastroClienteSaidaSchema>;

export const CONSULTA_CADASTRO_CLIENTE = definirConsulta({ nome: 'core.cadastro_cliente@1', entrada: CadastroClienteEntradaSchema, saida: CadastroClienteSaidaSchema });

/**
 * `core.medidas@1` (T-0063, RN-CORE-19): o Hub pergunta quais das siglas citadas num lote existem no tenant e se estão ativas
 * (sigla não cadastrada ou inativa vira `referencia_ausente`, reprocessável, RN-INT-04). Leitura apenas; devolve só as que existem
 * (ativas e inativas), sem custo nem dado de cliente.
 */
export const MedidasEntradaSchema = z.object({ siglas: z.array(z.string().trim().toUpperCase().max(10)).max(500) }).strict();
export type MedidasEntrada = z.infer<typeof MedidasEntradaSchema>;
export const MedidasSaidaSchema = z.object({ medidas: z.array(z.object({ sigla: z.string(), descricao: z.string(), ativo: z.boolean() })) });
export type MedidasSaida = z.infer<typeof MedidasSaidaSchema>;

export const CONSULTA_MEDIDAS = definirConsulta({ nome: 'core.medidas@1', entrada: MedidasEntradaSchema, saida: MedidasSaidaSchema });

/**
 * `core.usuarios_resumo@1` (T-0058, RN-TRE-07): usuários do tenant (ou só os `usuario_ids`) com perfil, equipe e situação, para o
 * público-alvo e a adesão do Treinamento. Inclui inativos (`ativo=false`); removidos ficam de fora. Só o necessário: nome, sem
 * e-mail, senha nem documento. Teto de 500 por chamada; sem `usuario_ids`, pagina por cursor de id (`apos_id` → `proximo_cursor`).
 * `regional_id`: o schema do Core ainda não tem regional; vai sempre `null` até existir (aditivo, mesma versão).
 */
export const UsuariosResumoEntradaSchema = z
  .object({
    usuario_ids: z.array(z.string().uuid()).max(500).optional(),
    apos_id: z.string().uuid().optional(),
    limite: z.number().int().min(1).max(500).default(500),
  })
  .strict();
export type UsuariosResumoEntrada = z.infer<typeof UsuariosResumoEntradaSchema>;
export const UsuariosResumoSaidaSchema = z.object({
  usuarios: z.array(
    z.object({ id: z.string().uuid(), nome: z.string(), perfil: z.string(), equipe_id: z.string().uuid().nullable(), regional_id: z.string().uuid().nullable(), ativo: z.boolean() }),
  ),
  /** Último id da página quando pode haver mais; `null` na última. */
  proximo_cursor: z.string().uuid().nullable(),
});
export type UsuariosResumoSaida = z.infer<typeof UsuariosResumoSaidaSchema>;

export const CONSULTA_USUARIOS_RESUMO = definirConsulta({ nome: 'core.usuarios_resumo@1', entrada: UsuariosResumoEntradaSchema, saida: UsuariosResumoSaidaSchema });

/**
 * `core.financeiro_cliente@1` (T-0089, RN-VEN-12/13): crédito e títulos vencidos de UM cliente, na API e no aparelho (offline,
 * lendo o `cliente_financeiro` e o `titulo` do pull). O "hoje" é a data no fuso do tenant. `financeiro: null` = cliente sem
 * linha financeira. O disponível (RN-VEN-12, com os pedidos ainda não faturados) é do Vendedor: aqui vai o do ERP, se vier.
 */
export const FinanceiroClienteEntradaSchema = z.object({ cliente_id: z.string().uuid() }).strict();
export type FinanceiroClienteEntrada = z.infer<typeof FinanceiroClienteEntradaSchema>;
export const FinanceiroClienteSaidaSchema = z.object({
  financeiro: z
    .object({
      limite_cents: z.number().int(),
      saldo_aberto_cents: z.number().int(),
      /** Do ERP; nulo = o ERP não mandou (o Vendedor calcula limite − saldo, RN-VEN-12). */
      credito_disponivel_erp_cents: z.number().int().nullable(),
      bloqueado: z.boolean(),
      motivo_bloqueio: z.string().nullable(),
      vencidos_qtd: z.number().int().nonnegative(),
      vencidos_cents: z.number().int().nonnegative(),
      /** Dias de atraso do título vencido mais antigo; 0 sem vencido (RN-VEN-13). */
      maior_atraso_dias: z.number().int().nonnegative(),
      atualizado_erp_em: z.string().datetime().nullable(),
    })
    .nullable(),
});
export type FinanceiroClienteSaida = z.infer<typeof FinanceiroClienteSaidaSchema>;
export const CONSULTA_FINANCEIRO_CLIENTE = definirConsulta({ nome: 'core.financeiro_cliente@1', entrada: FinanceiroClienteEntradaSchema, saida: FinanceiroClienteSaidaSchema });

/**
 * `core.produtos_por_sku@1` (T-0174, R-20261115-074500): o Catálogo casa o nome do arquivo de foto com o produto. Devolve os produtos
 * do tenant não removidos (ativos ou não) cujo `sku` bate exato, sem diferença de maiúsculas, ou cujo `ean` bate exato com algum código.
 * O desempate (exato → sem maiúsculas → EAN → ambíguo) é do Catálogo. Leitura apenas.
 */
export const ProdutosPorSkuEntradaSchema = z.object({ codigos: z.array(z.string().min(1).max(100)).min(1).max(500) }).strict();
export type ProdutosPorSkuEntrada = z.infer<typeof ProdutosPorSkuEntradaSchema>;
export const ProdutosPorSkuSaidaSchema = z.object({ produtos: z.array(z.object({ id: z.string().uuid(), sku: z.string(), ean: z.string().nullable(), ativo: z.boolean() })) });
export type ProdutosPorSkuSaida = z.infer<typeof ProdutosPorSkuSaidaSchema>;
export const CONSULTA_PRODUTOS_POR_SKU = definirConsulta({ nome: 'core.produtos_por_sku@1', entrada: ProdutosPorSkuEntradaSchema, saida: ProdutosPorSkuSaidaSchema });

/**
 * `core.produtividade_equipe@1` (T-0180, ADR 0059 §4; RN-CORE-26, RN-CORE-44): o que o Gestor precisa para abrir os alertas de
 * produtividade, no escopo dos `usuario_ids` pedidos (1 a 500): `inicio.parado_min`, o parâmetro `alertas.produtividade` e, por
 * usuário, o último contato do aparelho e o almoço já resolvido (o próprio ou `jornada.almoco_padrao`). Id inexistente, removido
 * ou de outro tenant some (não é erro). Só leitura, na transação de quem consulta.
 */
export const ProdutividadeEquipeEntradaSchema = z.object({ usuario_ids: z.array(z.string().uuid()).min(1).max(500) }).strict();
export type ProdutividadeEquipeEntrada = z.infer<typeof ProdutividadeEquipeEntradaSchema>;
export const ProdutividadeEquipeSaidaSchema = z
  .object({
    parado_min: z.number().int(),
    alertas: ParametrosAlertasProdutividadeSchema,
    usuarios: z.array(
      z
        .object({
          id: z.string().uuid(),
          /** Último `GET /sync/novidades` ou `POST /sync/push` do usuário (UTC, ISO); nulo = nunca sincronizou. */
          ultimo_contato_em: z.string().datetime().nullable(),
          almoco_inicio_min: MinutoDoDiaSchema,
          almoco_fim_min: MinutoDoDiaSchema,
        })
        .strict(),
    ),
  })
  .strict();
export type ProdutividadeEquipeSaida = z.infer<typeof ProdutividadeEquipeSaidaSchema>;
export const CONSULTA_PRODUTIVIDADE_EQUIPE = definirConsulta({ nome: 'core.produtividade_equipe@1', entrada: ProdutividadeEquipeEntradaSchema, saida: ProdutividadeEquipeSaidaSchema });
