import { defineModule } from '@macuxi/platform-sdk';

const PERFIS_PEDIDO = ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente'] as const;

/**
 * Manifesto do Vendedor. RN-PRO-01: o perfil promotor NUNCA entra em `perfis`
 * (promotor não cria/edita/exclui pedido, na UI e na API).
 * ADR-0005: depende do Catálogo (preço e estoque); RN-CORE-03: Catálogo desativado ⇒ Vendedor desativado.
 * T-0029: supervisor e gerente (e admin) entram para ver a equipe e decidir (ADR 0011); o app Gestão ganha a aba Pedidos;
 * o servidor consulta o preço do cliente (Catálogo) e o cadastro (Core) pelas consultas do ADR 0012.
 * T-0054: consome o retorno do ERP e a nota de devolução; publica o faturado@1 (desenho T-0011).
 */
export const manifest = defineModule({
  id: 'vendedor',
  versao: '0.2.0',
  depende: ['core', 'catalogo'],
  perfis: ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'],
  apps: { campo: { abas: ['Pedidos'] }, gestao: { abas: ['Pedidos'] }, web: { menus: ['Pedidos', 'Alçadas'] } },
  sync: ['pedido', 'pedido_item', 'pedido_evento', 'condicao_pagamento', 'cliente_condicao', 'alerta_ruptura'],
  publica: [
    'vendedor.pedido.criado@1',
    'vendedor.pedido.status_alterado@1',
    'vendedor.pedido.aprovacao_solicitada@1',
    'vendedor.pedido.aprovado@1',
    'vendedor.pedido.faturado@1',
  ],
  // T-0054: retorno do ERP (status, faturado@1) e nota de devolução do ERP (RN-VEN-37, proposta)
  consome: ['promotor.ruptura.registrada@1', 'integracao.pedido.retorno_erp@1', 'integracao.nota.atualizado@1'],
  usaConsultas: ['catalogo.precos_cliente@1', 'core.cadastro_resumo@1'],
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
  },
  ofereceExtensoes: ['pedido.criar_em_nome'],
  usaExtensoes: ['produto.acoes', 'cliente.abas', 'cliente.acoes', 'visita.etapas_checkout', 'inicio.cards'],
});

export default manifest;
