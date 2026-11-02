/**
 * Consultas síncronas que o Core oferece a outros módulos (ADR 0012). Leitura apenas, em `core.*`.
 * `core.cadastro_resumo@1` (T-0029): o Vendedor valida cliente/produtos/vendedor no push do pedido e guarda o
 * retrato do documento + as chaves do ERP (`external_id`) para o Hub. Id inexistente ou removido fica de fora.
 */
import { definirConsulta } from '@macuxi/platform-sdk';
import { z } from 'zod';

const Ids = z.array(z.string().uuid()).max(500).default([]);

/** `endereco_ids` (T-0061 §4.1): opcional, padrão []; o principal de cada cliente pedido vem sempre. */
export const CadastroResumoEntradaSchema = z.object({ cliente_ids: Ids, produto_ids: Ids, usuario_ids: Ids, endereco_ids: Ids }).strict();
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
      cadastro_incompleto: z.boolean().optional(),
      cadastro_campos_faltantes: z.array(z.string()).optional(),
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
      unidades: z.array(z.object({ unidade: z.string(), fator: z.number().int().positive(), padrao: z.boolean(), ativo: z.boolean(), external_id: Texto })).optional(),
    }),
  ),
  usuarios: z.array(z.object({ id: z.string().uuid(), nome: z.string(), perfil: z.string(), external_id: Texto })),
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
