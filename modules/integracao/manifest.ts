import { defineModule } from '@macuxi/platform-sdk';

export const manifest = defineModule({
  id: 'integracao',
  versao: '0.1.0',
  depende: ['core'],
  perfis: ['admin', 'analista'],
  apps: { web: { menus: ['Integração ERP'] }, conector: {} },
  publica: [
    'integracao.cliente.atualizado@1',
    'integracao.produto.atualizado@1',
    'integracao.preco.atualizado@1',
    'integracao.estoque.atualizado@1',
    'integracao.vendedor.atualizado@1',
    'integracao.titulo.atualizado@1',
    'integracao.nota.atualizado@1',
    'integracao.rota.atualizado@1',
    'integracao.pedido.retorno_erp@1',
    'integracao.lote.concluido@1',
    'integracao.reconciliacao.divergente@1',
  ],
  consome: ['vendedor.pedido.status_alterado@1'],
});

export default manifest;
