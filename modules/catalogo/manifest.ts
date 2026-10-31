import { defineModule } from '@macuxi/platform-sdk';

export const manifest = defineModule({
  id: 'catalogo',
  versao: '0.1.0',
  depende: ['core'],
  perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista'],
  apps: { campo: { abas: ['Catálogo'] }, gestao: { abas: ['Catálogo'] }, web: { menus: ['Catálogo'] } },
  sync: ['produto', 'categoria', 'marca', 'produto_atributo', 'produto_midia', 'produto_conteudo', 'sinonimo', 'tabela_preco', 'tabela_preco_item', 'deposito', 'estoque_saldo'],
  publica: ['catalogo.produto.visualizado@1', 'catalogo.busca.realizada@1'],
  consome: ['integracao.produto.atualizado@1', 'integracao.estoque.atualizado@1', 'integracao.preco.atualizado@1', 'catalogo.busca.realizada@1'],
  ofereceExtensoes: ['produto.acoes'],
});

export default manifest;
