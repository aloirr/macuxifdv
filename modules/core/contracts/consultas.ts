/**
 * Consultas síncronas que o Core oferece a outros módulos (ADR 0012). Leitura apenas, em `core.*`.
 * `core.cadastro_resumo@1` (T-0029): o Vendedor valida cliente/produtos/vendedor no push do pedido e guarda o
 * retrato do documento + as chaves do ERP (`external_id`) para o Hub. Id inexistente ou removido fica de fora.
 */
import { definirConsulta } from '@macuxi/platform-sdk';
import { z } from 'zod';

const Ids = z.array(z.string().uuid()).max(500).default([]);

export const CadastroResumoEntradaSchema = z.object({ cliente_ids: Ids, produto_ids: Ids, usuario_ids: Ids }).strict();
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
    }),
  ),
  produtos: z.array(z.object({ id: z.string().uuid(), sku: z.string(), nome: z.string(), unidade: z.string(), ativo: z.boolean(), external_id: Texto })),
  usuarios: z.array(z.object({ id: z.string().uuid(), nome: z.string(), perfil: z.string(), external_id: Texto })),
});
export type CadastroResumoSaida = z.infer<typeof CadastroResumoSaidaSchema>;

export const CONSULTA_CADASTRO_RESUMO = definirConsulta({ nome: 'core.cadastro_resumo@1', entrada: CadastroResumoEntradaSchema, saida: CadastroResumoSaidaSchema });
