/**
 * Entidade de sync de produto no app (T-0029): pull do catálogo mestre do tenant (mesma definição da API,
 * `api/sync.ts`). O Novo pedido do Vendedor lê os produtos do aparelho. Puro (sem react-native).
 */
import { definirEntidadeSync } from '@macuxi/platform-sdk';
import { ClienteFotoSyncSchema, FilialSyncSchema, FotoTipoSyncSchema, MedidaSyncSchema, ProdutoSyncSchema, ProdutoUnidadeSyncSchema } from '../../contracts';

export const entidadesProduto = [
  definirEntidadeSync({ nome: 'produto', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: ProdutoSyncSchema }),
  // Unidades de venda (UN/CX com fator; RN-VEN-15): pull do tenant, sem custo nem dado de cliente
  definirEntidadeSync({ nome: 'produto_unidade', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: ProdutoUnidadeSyncSchema }),
  // Medidas do tenant (RN-CORE-19): sigla e descrição para mostrar a medida vendida; inativa continua no pull (o produto mantém a sigla)
  definirEntidadeSync({ nome: 'medida', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: MedidaSyncSchema }),
  // Filiais do tenant (RN-CORE-39): a ficha mostra a filial do cliente; Catálogo e Vendedor leem pela consulta core.filiais@1 no aparelho
  definirEntidadeSync({ nome: 'filial', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: FilialSyncSchema }),
  // Fotos do PDV (RN-CORE-38): tipos do tenant e a foto vigente de cada tipo por cliente (arquivo_id nulo nos sensíveis)
  definirEntidadeSync({ nome: 'foto_tipo', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: FotoTipoSyncSchema }),
  definirEntidadeSync({ nome: 'cliente_foto', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: ClienteFotoSyncSchema }),
] as const;
