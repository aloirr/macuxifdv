/** Entidades de sync de preço do Catálogo (só pull; o servidor vence). Usadas pela API e pelo shell do aparelho. */
import { definirEntidadeSync } from '@macuxi/platform-sdk';
import { ClienteTabelaPrecoSyncSchema, TabelaPrecoItemSyncSchema, TabelaPrecoSyncSchema } from './sync';

export const entidadeTabelaPreco = definirEntidadeSync({ nome: 'tabela_preco', modulo: 'catalogo', direcao: 'pull', conflito: 'servidor_vence', schema: TabelaPrecoSyncSchema });
export const entidadeTabelaPrecoItem = definirEntidadeSync({ nome: 'tabela_preco_item', modulo: 'catalogo', direcao: 'pull', conflito: 'servidor_vence', schema: TabelaPrecoItemSyncSchema });
export const entidadeClienteTabelaPreco = definirEntidadeSync({ nome: 'cliente_tabela_preco', modulo: 'catalogo', direcao: 'pull', conflito: 'servidor_vence', schema: ClienteTabelaPrecoSyncSchema });
export const ENTIDADES_PRECO = [entidadeTabelaPreco, entidadeTabelaPrecoItem, entidadeClienteTabelaPreco] as const;
