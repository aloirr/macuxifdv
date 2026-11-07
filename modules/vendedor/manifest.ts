import { defineModule } from '@macuxi/platform-sdk';

const PERFIS_PEDIDO = ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente'] as const;

/**
 * Manifesto do Vendedor. RN-PRO-01: o perfil promotor NUNCA entra em `perfis`
 * (promotor não cria/edita/exclui pedido, na UI e na API).
 * ADR-0005: depende do Catálogo (preço e estoque); RN-CORE-03: Catálogo desativado ⇒ Vendedor desativado.
 * T-0029: supervisor e gerente (e admin) entram para ver a equipe e decidir (ADR 0011); o app Gestão ganha a aba Pedidos;
 * o servidor consulta o preço do cliente (Catálogo) e o cadastro (Core) pelas consultas do ADR 0012.
 * T-0054: consome o retorno do ERP e a nota de devolução; publica o faturado@1 (desenho T-0011).
 * T-0061: novo pedido de distribuidora (UN/CX, desconto e acréscimo por item e por pedido, frete CIF/FOB, endereço de entrega);
 * entidade de sync `transportadora`, ações `transportadora.ver|gerenciar` (BKO) e menu Transportadoras; promotor fora de tudo isso.
 * T-0053: orçamento (pré-venda, RF-VEN-03/RN-VEN-32) usa as mesmas ações de pedido; consome o retorno do ERP
 * (`integracao.pedido.retorno_erp@1`) e publica `vendedor.pedido.faturado@1` por nota faturada.
 */
export const manifest = defineModule({
  id: 'vendedor',
  versao: '0.5.0',
  depende: ['core', 'catalogo'],
  perfis: ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'],
  apps: { campo: { abas: ['Pedidos'] }, gestao: { abas: ['Pedidos'] }, web: { menus: ['Pedidos', 'Alçadas', 'Transportadoras', 'Formas de pagamento e prazos'] } },
  // T-0089: forma_pagamento e prazo_pagamento (RN-VEN-24); condicao_pagamento e cliente_condicao ficam só para o APK anterior
  sync: ['pedido', 'pedido_item', 'pedido_evento', 'condicao_pagamento', 'cliente_condicao', 'transportadora', 'forma_pagamento', 'prazo_pagamento', 'alerta_ruptura'],
  publica: [
    'vendedor.pedido.criado@1',
    'vendedor.pedido.status_alterado@1',
    'vendedor.pedido.aprovacao_solicitada@1',
    'vendedor.pedido.aprovado@1',
    'vendedor.pedido.faturado@1',
  ],
  // T-0054: retorno do ERP (status, faturado@1) e nota de devolução do ERP (RN-VEN-37, proposta)
  consome: ['promotor.ruptura.registrada@1', 'integracao.pedido.retorno_erp@1', 'integracao.nota.atualizado@1', 'integracao.forma_pagamento.atualizado@1', 'integracao.prazo_pagamento.atualizado@1'],
  // T-0065 B (RN-CORE-21): fatos para o Core apurar a meta pelo tipo
  ofereceConsultas: ['vendedor.pedidos_da_meta@1', 'vendedor.formas_pagamento@1'],
  usaConsultas: ['catalogo.precos_cliente@1', 'catalogo.textos_produto@1', 'catalogo.busca_produtos@1', 'catalogo.sugestoes_pedido@1', 'core.cadastro_resumo@1', 'core.promotor_ve_pedidos@1', 'core.financeiro_cliente@1'],
  acoes: {
    // RN-PRO-01 / O-3: o promotor só LÊ pedidos (carteira). Escrita continua só para PERFIS_PEDIDO.
    // Matriz §2: admin vê pedidos do tenant, não cria nem cancela.
    'pedido.ver': { perfis: [...PERFIS_PEDIDO, 'admin', 'promotor'] },
    'pedido.criar': { perfis: [...PERFIS_PEDIDO] },
    'pedido.editar': { perfis: [...PERFIS_PEDIDO] },
    'pedido.cancelar': { perfis: [...PERFIS_PEDIDO] },
    'pedido.excluir': { perfis: [...PERFIS_PEDIDO] },
    'pedido.aprovar': { perfis: ['supervisor', 'gerente', 'analista'] },
    'pedido.criar_em_nome': { perfis: ['supervisor', 'gerente'] },
    // T-0061 (RN-VEN-16): transportadoras e padrão do frete no BKO
    'transportadora.ver': { perfis: ['admin', 'analista', 'gerente', 'supervisor', 'assistente'] },
    'transportadora.gerenciar': { perfis: ['admin', 'analista', 'gerente'] },
    // T-0089 (RN-VEN-24): formas de pagamento e prazos em Parâmetros; promotor nunca (regra 7)
    'forma_pagamento.ver': { perfis: ['admin', 'analista', 'gerente'] },
    'forma_pagamento.gerenciar': { perfis: ['admin', 'analista', 'gerente'] },
  },
  ofereceExtensoes: ['pedido.criar_em_nome'],
  usaExtensoes: ['produto.acoes', 'cliente.abas', 'cliente.acoes', 'visita.etapas_checkout', 'inicio.cards'],
});

export default manifest;
