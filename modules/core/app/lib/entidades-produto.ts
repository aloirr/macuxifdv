/**
 * Entidade de sync de produto no app (T-0029): pull do catálogo mestre do tenant (mesma definição da API,
 * `api/sync.ts`). O Novo pedido do Vendedor lê os produtos do aparelho. Puro (sem react-native).
 */
import { definirEntidadeSync } from '@macuxi/platform-sdk';
import { ProdutoSyncSchema } from '../../contracts';

export const entidadesProduto = [
  definirEntidadeSync({ nome: 'produto', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: ProdutoSyncSchema }),
] as const;
