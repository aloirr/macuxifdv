import { defineModule } from '@macuxi/platform-sdk';

export const manifest = defineModule({
  id: 'integracao',
  versao: '0.2.0',
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
    // interno (T-0025): o POST /lotes publica, o próprio módulo consome e aplica o lote em segundo plano (outbox como fila)
    'integracao.lote.recebido@1',
  ],
  consome: ['vendedor.pedido.status_alterado@1', 'integracao.lote.recebido@1'],
  // T-0025: ações do BKO (ADR 0004). As rotas do Hub para o Conector (`/integracao/v1`) NÃO usam perfil: autenticam por chave de
  // API do Conector (RN-INT-10) e o escopo é fixo `integracao.v1`. Credencial, política de versão e inativação em massa: só admin.
  acoes: {
    'monitor.ver': { perfis: ['admin', 'analista'], descricao: 'Ver conectores, lotes, erros por linha, reconciliações e a fila de pedidos do ERP' },
    'lote.reprocessar': { perfis: ['admin', 'analista'], descricao: 'Reprocessar as linhas reprocessáveis de um lote (referencia_ausente, falha_processamento)' },
    'mapeamento.editar': { perfis: ['admin', 'analista'], descricao: 'Editar o de-para de códigos (condição de pagamento, depósito, status)' },
    'conector.gerenciar': { perfis: ['admin'], descricao: 'Cadastrar Conector, gerar/rotacionar/revogar a chave de API e definir a política de versão' },
    'inativacao.decidir': { perfis: ['admin'], descricao: 'Confirmar ou recusar a inativação em massa de uma carga completa (RN-INT-06)' },
  },
});

export default manifest;
