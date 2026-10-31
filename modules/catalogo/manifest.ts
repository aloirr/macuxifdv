import { defineModule } from '@macuxi/platform-sdk';

/**
 * Manifesto do Catálogo (ADR-0005): dono de preço (tabela de preço e itens), estoque (depósito e saldo),
 * conteúdo, mídia, sinônimos e busca. O cadastro base de produto (`produto`) é do Core.
 * `assistente` entra nos perfis porque o Vendedor depende do Catálogo (RN-CORE-03) e o assistente de BKO
 * trabalha com pedidos.
 */
export const manifest = defineModule({
  id: 'catalogo',
  versao: '0.1.0',
  depende: ['core'],
  perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente'],
  apps: { campo: { abas: ['Catálogo'] }, gestao: { abas: ['Catálogo'] }, web: { menus: ['Catálogo'] } },
  sync: [
    // preço
    'tabela_preco',
    'tabela_preco_item',
    // estoque por filial/depósito
    'deposito',
    'estoque_saldo',
    // conteúdo e busca
    'categoria',
    'marca',
    'produto_atributo',
    'produto_midia',
    'produto_conteudo',
    'sinonimo',
  ],
  publica: ['catalogo.produto.visualizado@1', 'catalogo.busca.realizada@1'],
  consome: ['integracao.produto.atualizado@1', 'integracao.estoque.atualizado@1', 'integracao.preco.atualizado@1', 'catalogo.busca.realizada@1'],
  ofereceExtensoes: ['produto.acoes'],
});

export default manifest;
