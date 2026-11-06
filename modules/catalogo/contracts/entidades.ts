/** Entidades de sync do Catálogo (só pull; o servidor vence). Usadas pela API e pelo shell do aparelho. */
import { definirEntidadeSync } from '@macuxi/platform-sdk';
import { CatalogoNoSyncSchema, ClienteTabelaPrecoSyncSchema, ProdutoNoSyncSchema, ProdutoRelacaoSyncSchema, TabelaPrecoItemSyncSchema, TabelaPrecoSyncSchema } from './sync';
import { DepositoSyncSchema, EstoqueSaldoSyncSchema, ProdutoAtributoSyncSchema, ProdutoConteudoSyncSchema, ProdutoReferenciaSyncSchema, SinonimoSyncSchema } from './sync-conteudo';

export const entidadeTabelaPreco = definirEntidadeSync({ nome: 'tabela_preco', modulo: 'catalogo', direcao: 'pull', conflito: 'servidor_vence', schema: TabelaPrecoSyncSchema });
export const entidadeTabelaPrecoItem = definirEntidadeSync({ nome: 'tabela_preco_item', modulo: 'catalogo', direcao: 'pull', conflito: 'servidor_vence', schema: TabelaPrecoItemSyncSchema });
export const entidadeClienteTabelaPreco = definirEntidadeSync({ nome: 'cliente_tabela_preco', modulo: 'catalogo', direcao: 'pull', conflito: 'servidor_vence', schema: ClienteTabelaPrecoSyncSchema });
export const ENTIDADES_PRECO = [entidadeTabelaPreco, entidadeTabelaPrecoItem, entidadeClienteTabelaPreco] as const;

// T-0052: conteúdo e estoque para a busca offline e a ficha sem sinal (provedores na API depois da migração 0013)
export const entidadeProdutoAtributo = definirEntidadeSync({ nome: 'produto_atributo', modulo: 'catalogo', direcao: 'pull', conflito: 'servidor_vence', schema: ProdutoAtributoSyncSchema });
export const entidadeSinonimo = definirEntidadeSync({ nome: 'sinonimo', modulo: 'catalogo', direcao: 'pull', conflito: 'servidor_vence', schema: SinonimoSyncSchema });
export const entidadeDeposito = definirEntidadeSync({ nome: 'deposito', modulo: 'catalogo', direcao: 'pull', conflito: 'servidor_vence', schema: DepositoSyncSchema });
export const entidadeEstoqueSaldo = definirEntidadeSync({ nome: 'estoque_saldo', modulo: 'catalogo', direcao: 'pull', conflito: 'servidor_vence', schema: EstoqueSaldoSyncSchema });
export const entidadeProdutoConteudo = definirEntidadeSync({ nome: 'produto_conteudo', modulo: 'catalogo', direcao: 'pull', conflito: 'servidor_vence', schema: ProdutoConteudoSyncSchema });
// T-0085 / RN-CAT-09: referência cruzada (marca do concorrente + código), até 3 por produto
export const entidadeProdutoReferencia = definirEntidadeSync({ nome: 'produto_referencia', modulo: 'catalogo', direcao: 'pull', conflito: 'servidor_vence', schema: ProdutoReferenciaSyncSchema });
export const ENTIDADES_CONTEUDO = [entidadeProdutoAtributo, entidadeSinonimo, entidadeDeposito, entidadeEstoqueSaldo, entidadeProdutoConteudo, entidadeProdutoReferencia] as const;

// T-0061 / RF-CAT-04: árvore do catálogo (níveis e nomes do ERP) para navegar offline
export const entidadeCatalogoNo = definirEntidadeSync({ nome: 'catalogo_no', modulo: 'catalogo', direcao: 'pull', conflito: 'servidor_vence', schema: CatalogoNoSyncSchema });
export const entidadeProdutoNo = definirEntidadeSync({ nome: 'produto_no', modulo: 'catalogo', direcao: 'pull', conflito: 'servidor_vence', schema: ProdutoNoSyncSchema });
export const ENTIDADES_ARVORE = [entidadeCatalogoNo, entidadeProdutoNo] as const;

// T-0071 / RF-CAT-03: relação entre produtos (complementar, superior, substituto) para as sugestões offline
export const entidadeProdutoRelacao = definirEntidadeSync({ nome: 'produto_relacao', modulo: 'catalogo', direcao: 'pull', conflito: 'servidor_vence', schema: ProdutoRelacaoSyncSchema });
