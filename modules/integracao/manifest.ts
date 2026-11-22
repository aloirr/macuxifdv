import { defineModule } from '@macuxi/platform-sdk';

export const manifest = defineModule({
  id: 'integracao',
  versao: '0.8.0',
  depende: ['core'],
  perfis: ['admin', 'analista'],
  apps: { web: { menus: ['Integração ERP', 'Integração'] }, conector: {} },
  publica: [
    'integracao.cliente.atualizado@1',
    'integracao.produto.atualizado@1',
    'integracao.preco.atualizado@1',
    'integracao.estoque.atualizado@1',
    'integracao.vendedor.atualizado@1',
    'integracao.titulo.atualizado@1',
    'integracao.nota.atualizado@1',
    'integracao.rota.atualizado@1',
    // T-0061 (ADR 0016): entidades novas do Hub; donos: catalogo (catalogo_no), core (produto_unidade, cliente_endereco), vendedor (transportadora)
    'integracao.catalogo_no.atualizado@1',
    'integracao.produto_unidade.atualizado@1',
    'integracao.cliente_endereco.atualizado@1',
    'integracao.transportadora.atualizado@1',
    // T-0089: formas e prazos (dono: vendedor), faixa escalonada (dono: catalogo); o cliente ganha prazo_medio_max_dias e formas_pagamento (dono: core)
    'integracao.forma_pagamento.atualizado@1',
    'integracao.prazo_pagamento.atualizado@1',
    'integracao.tabela_escalonada.atualizado@1',
    // T-0149 (RN-CORE-39, ADR 0040): filial do ERP (consumidor: core); cliente, preço, estoque e faixa ganham filial_external_id
    'integracao.filial.atualizado@1',
    'integracao.pedido.retorno_erp@1',
    // T-0114: o ERP recusou o cancelamento devolvido pelo Hub (consumidor previsto: vendedor)
    'integracao.pedido.cancelamento_recusado@1',
    'integracao.lote.concluido@1',
    'integracao.reconciliacao.divergente@1',
    // interno (T-0025): o POST /lotes publica, o próprio módulo consome e aplica o lote em segundo plano (outbox como fila)
    'integracao.lote.recebido@1',
  ],
  // RN-INT-14: o Hub pergunta ao Core se o cadastro do cliente do lote está completo (aviso `cadastro_incompleto`, nunca erro de linha);
  // RN-CORE-19: core.medidas@1 diz quais siglas de medida do lote existem/estão ativas (sigla desconhecida = referencia_ausente)
  // RN-CORE-39: core.filiais@1 confere o filial_external_id do vendedor (inexistente = referencia_ausente reprocessável)
  // T-0173 (RN-INT-16): core.usuarios_com_acao@1 lista quem pode autorizar o reprocessamento (quem tem lote.reprocessar pela permissão efetiva, sem e-mail); core.credencial_conferir@1 confere a senha
  usaConsultas: ['core.cadastro_cliente@1', 'core.medidas@1', 'core.filiais@1', 'core.usuarios_com_acao@1', 'core.credencial_conferir@1'],
  // T-0173: vendedor.formas_pagamento@1 traz os códigos de condição de pagamento do Macuxi para o De-para (Vendedor desligado = lista indisponível)
  usaConsultasOpcionais: ['vendedor.formas_pagamento@1'],
  // T-0114: o Vendedor pergunta se o ERP aceita o cancelamento de pedido já enviado (saída { aceita })
  ofereceConsultas: ['integracao.cancelamento_erp@1'],
  // vendedor.pedido.aprovado@1 traz o pedido pronto para a fila do ERP; status_alterado@1 retira da fila (cancelado/devolvido antes da 1ª entrega)
  consome: ['vendedor.pedido.aprovado@1', 'vendedor.pedido.status_alterado@1', 'vendedor.pedido.cancelado@1', 'integracao.lote.recebido@1', 'catalogo.referencia.marca_desconhecida@1'],
  // T-0025: ações do BKO (ADR 0004). As rotas do Hub para o Conector (`/integracao/v1`) NÃO usam perfil: autenticam por chave de
  // API do Conector (RN-INT-10) e o escopo é fixo `integracao.v1`. P-3 (T-0031): Conector, chave de API e política de versão só
  // admin; confirmar/recusar a inativação em massa admin ou analista, com auditoria. A mesma tabela está em domain/permissoes.ts.
  acoes: {
    'monitor.ver': { perfis: ['admin', 'analista'], descricao: 'Ver conectores, lotes, erros por linha, reconciliações e a fila de pedidos do ERP' },
    'lote.reprocessar': { perfis: ['admin', 'analista'], descricao: 'Reprocessar as linhas reprocessáveis de um lote (referencia_ausente, falha_processamento)' },
    'lote.cancelar': { perfis: ['admin', 'analista'], descricao: 'Cancelar um lote em andamento (RN-INT-15)' },
    'mapeamento.editar': { perfis: ['admin', 'analista'], descricao: 'Editar o de-para de códigos (condição de pagamento, depósito, status)' },
    'conector.gerenciar': { perfis: ['admin'], descricao: 'Cadastrar Conector, gerar/rotacionar/revogar a chave de API e definir a política de versão' },
    'inativacao.decidir': { perfis: ['admin', 'analista'], descricao: 'Confirmar ou recusar a inativação em massa de uma carga completa, com auditoria (RN-INT-06, P-3)' },
  },
});

export default manifest;
