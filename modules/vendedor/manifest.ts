import { defineModule } from '@macuxi/platform-sdk';

const PERFIS_PEDIDO = ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente'] as const;

/**
 * Manifesto do Vendedor. RN-PRO-01: o perfil promotor NUNCA entra em `perfis`
 * (promotor não cria/edita/exclui pedido, na UI e na API).
 * ADR-0005: depende do Catálogo (preço e estoque); RN-CORE-03: Catálogo desativado ⇒ Vendedor desativado.
 */
export const manifest = defineModule({
  id: 'vendedor',
  versao: '0.1.0',
  depende: ['core', 'catalogo'],
  perfis: ['vendedor', 'analista', 'assistente'],
  apps: { campo: { abas: ['Pedidos'] }, web: { menus: ['Pedidos', 'Alçadas'] } },
  sync: ['pedido', 'pedido_item', 'pedido_evento', 'condicao_pagamento', 'cliente_condicao', 'alerta_ruptura'],
  publica: ['vendedor.pedido.criado@1', 'vendedor.pedido.status_alterado@1', 'vendedor.pedido.aprovacao_solicitada@1', 'vendedor.pedido.faturado@1'],
  consome: ['promotor.ruptura.registrada@1', 'integracao.pedido.retorno_erp@1'],
  acoes: {
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
