/**
 * Entidade de sync de produto no app (T-0029): pull do catálogo mestre do tenant (mesma definição da API,
 * `api/sync.ts`). O Novo pedido do Vendedor lê os produtos do aparelho. Puro (sem react-native).
 */
import { definirEntidadeSync } from '@macuxi/platform-sdk';
import { MedidaSyncSchema, ProdutoSyncSchema, ProdutoUnidadeSyncSchema } from '../../contracts';

export const entidadesProduto = [
  definirEntidadeSync({ nome: 'produto', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: ProdutoSyncSchema }),
  // Unidades de venda (UN/CX com fator; RN-VEN-15): pull do tenant, sem custo nem dado de cliente
  definirEntidadeSync({ nome: 'produto_unidade', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: ProdutoUnidadeSyncSchema }),
  // Medidas do tenant (RN-CORE-19): sigla e descrição para mostrar a medida vendida; inativa continua no pull (o produto mantém a sigla)
  definirEntidadeSync({ nome: 'medida', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: MedidaSyncSchema }),
] as const;
